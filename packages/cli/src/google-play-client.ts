// SPDX-License-Identifier: Apache-2.0
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { GooglePlayImageType, RemoteImage } from "./store-upload-plan.js";

/** Production endpoints are fixed in code; only tests inject others, never the environment. */
export interface GooglePlayEndpoints {
  apiRoot: string;
  tokenUrl: string;
}

export const GOOGLE_PLAY_ENDPOINTS: GooglePlayEndpoints = {
  apiRoot: "https://androidpublisher.googleapis.com",
  tokenUrl: "https://oauth2.googleapis.com/token",
};

const ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
/** A stalled request must not hold an edit open forever; an abort is reported as no response. */
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export interface GooglePlayServiceAccount {
  clientEmail: string;
  privateKey: KeyObject;
}

/** Reads a service-account JSON key; errors never echo the file content. */
export async function readGooglePlayServiceAccount(path: string): Promise<GooglePlayServiceAccount> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Cannot read the Google Play service account file: ${(error as NodeJS.ErrnoException).code}`, { cause: error });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // No cause: a JSON.parse message quotes the file, which holds the private key.
    throw new Error("The Google Play service account file is not valid JSON");
  }
  const { client_email: clientEmail, private_key: privateKey } = (raw ?? {}) as Record<string, unknown>;
  if (typeof clientEmail !== "string" || typeof privateKey !== "string") {
    throw new Error("The Google Play service account file needs client_email and private_key");
  }
  try {
    return { clientEmail, privateKey: createPrivateKey(privateKey) };
  } catch {
    throw new Error("The Google Play service account private_key is not a valid PEM key");
  }
}

/** `responded` is false when no HTTP response arrived, so the request may or may not have taken effect. */
export class GooglePlayRequestError extends Error {
  constructor(message: string, readonly responded: boolean) {
    super(message);
  }
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

async function failure(operation: string, response: Response): Promise<GooglePlayRequestError> {
  let detail = "";
  try {
    const body = await response.json() as { error?: { message?: unknown } | string; error_description?: unknown };
    const message = typeof body.error === "object" ? body.error.message : body.error_description ?? body.error;
    if (typeof message === "string") detail = ` ${message.slice(0, 500)}`;
  } catch {
    // A non-JSON error body adds nothing the status does not already say.
  }
  return new GooglePlayRequestError(`Google Play ${operation} failed: ${response.status}${detail}`, true);
}

/** A body that cannot be read or parsed leaves the outcome unknown, like a request without a response. */
async function readJson<T>(operation: string, response: Response): Promise<T> {
  try {
    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  } catch (error) {
    // A JSON.parse message quotes the body, so only the kind of failure is reported.
    const name = (error as Error).name;
    const reason = name === "TimeoutError" || name === "AbortError" ? "network error (timeout)" : "unreadable response";
    throw new GooglePlayRequestError(`Google Play ${operation} failed: ${reason}`, false);
  }
}

async function send(
  fetchImpl: typeof fetch,
  operation: string,
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    // Node's fetch cause carries the host; only the operation and the reason are reported.
    const reason = (error as Error).name === "TimeoutError"
      ? "timeout"
      : (error as { cause?: { code?: unknown } }).cause?.code;
    throw new GooglePlayRequestError(
      `Google Play ${operation} failed: network error${typeof reason === "string" ? ` (${reason})` : ""}`,
      false,
    );
  }
}

/** OAuth 2.0 service-account flow: an RS256-signed JWT exchanged for a one-hour access token. */
export async function googlePlayAccessToken(
  account: GooglePlayServiceAccount,
  options: { tokenUrl: string; fetch: typeof fetch; now?: () => number; timeoutMs?: number },
): Promise<string> {
  const issuedAt = Math.floor((options.now ?? Date.now)() / 1000);
  const unsigned = [
    base64url(JSON.stringify({ alg: "RS256", typ: "JWT" })),
    base64url(JSON.stringify({
      iss: account.clientEmail,
      scope: ANDROID_PUBLISHER_SCOPE,
      aud: options.tokenUrl,
      iat: issuedAt,
      exp: issuedAt + 3600,
    })),
  ].join(".");
  const assertion = `${unsigned}.${base64url(sign("RSA-SHA256", Buffer.from(unsigned), account.privateKey))}`;
  const response = await send(options.fetch, "token exchange", options.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  }, options.timeoutMs);
  if (!response.ok) throw await failure("token exchange", response);
  const { access_token: token } = await readJson<{ access_token?: unknown }>("token exchange", response);
  if (typeof token !== "string" || token.length === 0) throw new Error("Google Play token exchange returned no access token");
  return token;
}

export type GooglePlayClient = ReturnType<typeof createGooglePlayClient>;

/** The androidpublisher v3 edit calls `screenshots upload` needs, and nothing else. */
export function createGooglePlayClient(options: {
  apiRoot: string;
  packageName: string;
  token: string;
  fetch: typeof fetch;
  timeoutMs?: number;
}) {
  const app = `androidpublisher/v3/applications/${encodeURIComponent(options.packageName)}`;
  const slot = (editId: string, language: string, imageType: GooglePlayImageType) =>
    `${app}/edits/${encodeURIComponent(editId)}/listings/${encodeURIComponent(language)}/${imageType}`;
  const call = async <T>(operation: string, method: string, path: string, body?: Buffer): Promise<T> => {
    const response = await send(options.fetch, operation, `${options.apiRoot}/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${options.token}`,
        ...(body ? { "content-type": "image/png" } : {}),
      },
      ...(body ? { body: new Uint8Array(body) } : {}),
    }, options.timeoutMs);
    if (!response.ok) throw await failure(operation, response);
    return readJson<T>(operation, response);
  };

  return {
    async insertEdit(): Promise<string> {
      const { id } = await call<{ id?: unknown }>("edits.insert", "POST", `${app}/edits`);
      if (typeof id !== "string") throw new Error("Google Play edits.insert returned no edit id");
      return id;
    },
    async listListingLanguages(editId: string): Promise<string[]> {
      const { listings = [] } = await call<{ listings?: Array<{ language: string }> }>(
        "edits.listings.list", "GET", `${app}/edits/${encodeURIComponent(editId)}/listings`);
      return listings.map(({ language }) => language);
    },
    async listImages(editId: string, language: string, imageType: GooglePlayImageType): Promise<RemoteImage[]> {
      const { images = [] } = await call<{ images?: Array<{ id: string }> }>(
        "edits.images.list", "GET", slot(editId, language, imageType));
      return images.map(({ id }) => ({ id }));
    },
    async deleteAllImages(editId: string, language: string, imageType: GooglePlayImageType): Promise<void> {
      await call("edits.images.deleteall", "DELETE", slot(editId, language, imageType));
    },
    async uploadImage(editId: string, language: string, imageType: GooglePlayImageType, png: Buffer): Promise<void> {
      await call("edits.images.upload", "POST", `upload/${slot(editId, language, imageType)}?uploadType=media`, png);
    },
    /** `changesNotSentForReview` is required by apps whose changes Play will not send for review automatically. */
    async commitEdit(editId: string, changesNotSentForReview = false): Promise<void> {
      const query = changesNotSentForReview ? "?changesNotSentForReview=true" : "";
      await call("edits.commit", "POST", `${app}/edits/${encodeURIComponent(editId)}:commit${query}`);
    },
    async deleteEdit(editId: string): Promise<void> {
      await call("edits.delete", "DELETE", `${app}/edits/${encodeURIComponent(editId)}`);
    },
  };
}
