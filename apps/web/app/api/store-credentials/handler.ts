// SPDX-License-Identifier: Apache-2.0
import { jsonError } from "@web/lib/api-error-response.server.js";
import { isRecord } from "@web/lib/json-guards.js";
import {
  assertCredentialsOutsideProject,
  sharedStoreCredentialStore,
  StoreCredentialError,
  type StoreCredentialStore,
  validateAppleCredentials,
} from "@web/lib/store-credentials.server.js";

export interface StoreCredentialRouteDependencies {
  credentials?: StoreCredentialStore;
}

/** A service-account JSON or a `.p8` key is a few KiB; anything larger is not a key. */
const MAX_BODY_BYTES = 64 * 1024;

async function statusResponse(credentials: StoreCredentialStore, status = 200): Promise<Response> {
  return Response.json({ stores: await credentials.status() }, { status, headers: { "cache-control": "no-store" } });
}

export function handleStoreCredentialsGet(
  { credentials = sharedStoreCredentialStore() }: StoreCredentialRouteDependencies = {},
): Promise<Response> {
  return statusResponse(credentials);
}

/** Saves one store's key. The response is the status only; key material is never echoed back. */
export async function handleStoreCredentialsPost(
  req: Request,
  projectDirectory: string,
  { credentials = sharedStoreCredentialStore() }: StoreCredentialRouteDependencies = {},
): Promise<Response> {
  const text = await req.text().catch(() => "");
  if (text.length > MAX_BODY_BYTES) return jsonError(413, "The key is larger than any store key");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return jsonError(400, "request body must be a JSON object with a store and its key");
  }
  if (!isRecord(body)) return jsonError(400, "request body must be a JSON object with a store and its key");
  try {
    await assertCredentialsOutsideProject(credentials, projectDirectory);
    if (body.store === "google" && typeof body.serviceAccount === "string") {
      await credentials.setGoogle(body.serviceAccount);
    } else if (body.store === "apple") {
      await credentials.setApple(validateAppleCredentials({ keyId: body.keyId, issuerId: body.issuerId, privateKey: body.privateKey }));
    } else {
      return jsonError(400, "store must be google with a serviceAccount, or apple with keyId, issuerId and privateKey");
    }
  } catch (error) {
    if (error instanceof StoreCredentialError) return jsonError(422, error.message);
    return jsonError(500, "The store key could not be saved");
  }
  return statusResponse(credentials);
}

export async function handleStoreCredentialsDelete(
  req: Request,
  { credentials = sharedStoreCredentialStore() }: StoreCredentialRouteDependencies = {},
): Promise<Response> {
  const store = new URL(req.url).searchParams.get("store");
  if (store !== "google" && store !== "apple") return jsonError(400, "store must be google or apple");
  await credentials.clear(store);
  return statusResponse(credentials);
}
