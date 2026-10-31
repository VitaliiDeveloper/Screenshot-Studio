// SPDX-License-Identifier: Apache-2.0
import { createHash, createPrivateKey, sign, type KeyObject } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AppStoreDisplayType } from "@screenshot-studio/core/export";
import type { AppStorePlatform, RemoteImage } from "./store-upload-plan.js";

/** The production API root is fixed in code; only tests inject another, never the environment. */
export const APP_STORE_CONNECT_API_ROOT = "https://api.appstoreconnect.apple.com";

/** A stalled request must not hang the upload; an abort is reported as no response. */
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
/** Apple rejects tokens that expire more than 20 minutes after issue. */
const TOKEN_LIFETIME_SECONDS = 15 * 60;
const TOKEN_REISSUE_MARGIN_SECONDS = 60;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_PROCESSING_TIMEOUT_MS = 5 * 60_000;

/** Version states whose screenshots App Store Connect lets a developer replace. */
export const EDITABLE_VERSION_STATES = [
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "WAITING_FOR_REVIEW",
  "INVALID_BINARY",
] as const;

export interface AppStoreConnectKey {
  keyId: string;
  issuerId: string;
  privateKey: KeyObject;
}

/** Reads an App Store Connect API `.p8` key; errors never echo the file content. */
export async function readAppStoreConnectKey(path: string, keyId: string, issuerId: string): Promise<AppStoreConnectKey> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Cannot read the App Store Connect API key file: ${(error as NodeJS.ErrnoException).code}`, { cause: error });
  }
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(text);
  } catch {
    throw new Error("The App Store Connect API key file is not a valid PEM key");
  }
  if (privateKey.asymmetricKeyType !== "ec" || privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("The App Store Connect API key file is not a P-256 EC key (.p8 from App Store Connect)");
  }
  return { keyId, issuerId, privateKey };
}

/** `responded` is false when no HTTP response arrived, so the request may or may not have taken effect. */
export class AppStoreConnectRequestError extends Error {
  constructor(message: string, readonly responded: boolean) {
    super(message);
  }
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

/** An ES256 JWT for the App Store Connect API, signed in the raw r‖s form JWS requires. */
export function appStoreConnectToken(key: AppStoreConnectKey, issuedAt: number): string {
  const unsigned = [
    base64url(JSON.stringify({ alg: "ES256", kid: key.keyId, typ: "JWT" })),
    base64url(JSON.stringify({
      iss: key.issuerId,
      iat: issuedAt,
      exp: issuedAt + TOKEN_LIFETIME_SECONDS,
      aud: "appstoreconnect-v1",
    })),
  ].join(".");
  const signature = sign("sha256", Buffer.from(unsigned), { key: key.privateKey, dsaEncoding: "ieee-p1363" });
  return `${unsigned}.${base64url(signature)}`;
}

async function failure(operation: string, response: Response): Promise<AppStoreConnectRequestError> {
  let detail = "";
  try {
    const body = await response.json() as { errors?: Array<{ detail?: unknown; title?: unknown }> };
    const first = body.errors?.[0];
    const message = typeof first?.detail === "string" ? first.detail : first?.title;
    if (typeof message === "string") detail = ` ${message.slice(0, 500)}`;
  } catch {
    // A non-JSON error body adds nothing the status does not already say.
  }
  return new AppStoreConnectRequestError(`App Store Connect ${operation} failed: ${response.status}${detail}`, true);
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
    throw new AppStoreConnectRequestError(
      `App Store Connect ${operation} failed: network error${typeof reason === "string" ? ` (${reason})` : ""}`,
      false,
    );
  }
}

export interface AppStoreVersion {
  id: string;
  versionString: string;
  state: string;
}

interface UploadOperation {
  method: string;
  url: string;
  offset: number;
  length: number;
  requestHeaders?: Array<{ name: string; value: string }>;
}

interface Resource<T> {
  id: string;
  attributes?: T;
}

export type AppStoreConnectClient = ReturnType<typeof createAppStoreConnectClient>;

/** The App Store Connect API v1 calls `screenshots upload --store apple` needs, and nothing else. */
export function createAppStoreConnectClient(options: {
  apiRoot: string;
  key: AppStoreConnectKey;
  fetch: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  pollIntervalMs?: number;
  processingTimeoutMs?: number;
}) {
  const now = options.now ?? Date.now;
  let token: { value: string; expiresAt: number } | undefined;
  const bearer = () => {
    const seconds = Math.floor(now() / 1000);
    if (!token || seconds >= token.expiresAt - TOKEN_REISSUE_MARGIN_SECONDS) {
      token = { value: appStoreConnectToken(options.key, seconds), expiresAt: seconds + TOKEN_LIFETIME_SECONDS };
    }
    return token.value;
  };
  const call = async <T>(operation: string, method: string, path: string, body?: unknown): Promise<T> => {
    const response = await send(options.fetch, operation, `${options.apiRoot}/v1/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${bearer()}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }, options.timeoutMs);
    if (!response.ok) throw await failure(operation, response);
    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  };
  const list = async <T>(operation: string, path: string): Promise<Array<Resource<T>>> =>
    (await call<{ data?: Array<Resource<T>> }>(operation, "GET", path)).data ?? [];

  return {
    // shortcut: one page of 200 is read, ample for versions, localizations and sets; follow links.next if that changes.
    async listEditableVersions(appId: string, platform: AppStorePlatform): Promise<AppStoreVersion[]> {
      const query = new URLSearchParams({
        "filter[platform]": platform,
        "filter[appVersionState]": EDITABLE_VERSION_STATES.join(","),
        limit: "200",
      });
      const versions = await list<{ versionString?: string; appVersionState?: string }>(
        "appStoreVersions list", `apps/${encodeURIComponent(appId)}/appStoreVersions?${query}`);
      return versions.map(({ id, attributes }) => ({
        id,
        versionString: attributes?.versionString ?? "",
        state: attributes?.appVersionState ?? "",
      }));
    },
    async listLocalizations(versionId: string): Promise<Array<{ id: string; locale: string }>> {
      const localizations = await list<{ locale?: string }>(
        "appStoreVersionLocalizations list", `appStoreVersions/${encodeURIComponent(versionId)}/appStoreVersionLocalizations?limit=200`);
      return localizations.map(({ id, attributes }) => ({ id, locale: attributes?.locale ?? "" }));
    },
    async listScreenshotSets(localizationId: string): Promise<Array<{ id: string; displayType: string }>> {
      const sets = await list<{ screenshotDisplayType?: string }>(
        "appScreenshotSets list", `appStoreVersionLocalizations/${encodeURIComponent(localizationId)}/appScreenshotSets?limit=200`);
      return sets.map(({ id, attributes }) => ({ id, displayType: attributes?.screenshotDisplayType ?? "" }));
    },
    async createScreenshotSet(localizationId: string, displayType: AppStoreDisplayType): Promise<string> {
      const { data } = await call<{ data?: { id?: unknown } }>("appScreenshotSets create", "POST", "appScreenshotSets", {
        data: {
          type: "appScreenshotSets",
          attributes: { screenshotDisplayType: displayType },
          relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: localizationId } } },
        },
      });
      if (typeof data?.id !== "string") throw new Error("App Store Connect appScreenshotSets create returned no id");
      return data.id;
    },
    async listScreenshots(setId: string): Promise<RemoteImage[]> {
      const screenshots = await list("appScreenshots list", `appScreenshotSets/${encodeURIComponent(setId)}/appScreenshots?limit=200`);
      return screenshots.map(({ id }) => ({ id }));
    },
    async deleteScreenshot(id: string): Promise<void> {
      await call("appScreenshots delete", "DELETE", `appScreenshots/${encodeURIComponent(id)}`);
    },
    /** Reserve, upload every part, and commit; returns the screenshot id once App Store Connect has the bytes. */
    async uploadScreenshot(setId: string, fileName: string, png: Buffer): Promise<string> {
      const { data } = await call<{ data?: Resource<{ uploadOperations?: UploadOperation[] }> }>(
        "appScreenshots reserve", "POST", "appScreenshots", {
          data: {
            type: "appScreenshots",
            attributes: { fileName, fileSize: png.length },
            relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: setId } } },
          },
        });
      const operations = data?.attributes?.uploadOperations;
      if (typeof data?.id !== "string" || !Array.isArray(operations)) {
        throw new Error("App Store Connect appScreenshots reserve returned no upload operations");
      }
      for (const operation of operations) {
        // Presigned asset-host URLs: only Apple's own headers go there, never the API token.
        const response = await send(options.fetch, "screenshot upload", operation.url, {
          method: operation.method,
          headers: Object.fromEntries((operation.requestHeaders ?? []).map(({ name, value }) => [name, value])),
          body: new Uint8Array(png.subarray(operation.offset, operation.offset + operation.length)),
        }, options.timeoutMs);
        // The asset host answers in its own format, so only the status is reported.
        if (!response.ok) throw new AppStoreConnectRequestError(`App Store Connect screenshot upload failed: ${response.status}`, true);
      }
      await call("appScreenshots commit", "PATCH", `appScreenshots/${encodeURIComponent(data.id)}`, {
        data: {
          type: "appScreenshots",
          id: data.id,
          attributes: { uploaded: true, sourceFileChecksum: createHash("md5").update(png).digest("hex") },
        },
      });
      return data.id;
    },
    /** Polls `assetDeliveryState` until App Store Connect finishes processing, within a bounded wait. */
    async waitForProcessing(id: string): Promise<void> {
      const deadline = now() + (options.processingTimeoutMs ?? DEFAULT_PROCESSING_TIMEOUT_MS);
      for (;;) {
        const { data } = await call<{ data?: Resource<{
          assetDeliveryState?: { state?: string; errors?: Array<{ code?: string; description?: string }> };
        }> }>("appScreenshots read", "GET", `appScreenshots/${encodeURIComponent(id)}`);
        const delivery = data?.attributes?.assetDeliveryState;
        if (delivery?.state === "COMPLETE") return;
        if (delivery?.state === "FAILED") {
          const reasons = (delivery.errors ?? []).map(({ code, description }) => description ?? code).filter(Boolean).join("; ");
          throw new AppStoreConnectRequestError(
            `App Store Connect could not process a screenshot${reasons ? `: ${reasons.slice(0, 500)}` : ""}`, true);
        }
        if (now() >= deadline) {
          throw new AppStoreConnectRequestError("App Store Connect did not finish processing a screenshot in time", true);
        }
        await new Promise((done) => setTimeout(done, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS));
      }
    },
  };
}
