// SPDX-License-Identifier: Apache-2.0
import { projectRequestHeaders } from "@web/lib/clients/save-project";
import { readJsonBody, readJsonResponse, responseErrorMessage } from "@web/lib/json-response";
import type {
  CredentialStoreId,
  StoreCredentialStatus,
  UploadPlanResponse,
  UploadReport,
  UploadStoreId,
} from "@web/lib/store-upload";

export type StoreCredentialStatuses = Record<CredentialStoreId, StoreCredentialStatus>;

export type StoreCredentialInput =
  | { store: "google"; serviceAccount: string }
  | { store: "apple"; keyId: string; issuerId: string; privateKey: string };

/** A refused request with the route's `code`, so the UI can point at what is missing. */
export class StoreUploadRequestError extends Error {
  constructor(message: string, readonly code: string | undefined) {
    super(message);
  }
}

async function credentialsResponse(response: Response): Promise<StoreCredentialStatuses> {
  const body = await readJsonResponse(response, `Store keys request failed (${response.status})`);
  return body.stores as StoreCredentialStatuses;
}

export async function fetchStoreCredentials(): Promise<StoreCredentialStatuses> {
  return credentialsResponse(await fetch("/api/store-credentials", { headers: projectRequestHeaders(), cache: "no-store" }));
}

export async function saveStoreCredentials(input: StoreCredentialInput): Promise<StoreCredentialStatuses> {
  return credentialsResponse(await fetch("/api/store-credentials", {
    method: "POST",
    headers: projectRequestHeaders({ headers: { "content-type": "application/json" } }),
    body: JSON.stringify(input),
  }));
}

export async function clearStoreCredentials(store: CredentialStoreId): Promise<StoreCredentialStatuses> {
  return credentialsResponse(await fetch(`/api/store-credentials?store=${store}`, {
    method: "DELETE",
    headers: projectRequestHeaders(),
  }));
}

async function uploadRequest(path: string, body: unknown, conditional: boolean): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    method: "POST",
    headers: projectRequestHeaders({ conditional, headers: { "content-type": "application/json" } }),
    body: JSON.stringify(body),
  });
  const parsed = await readJsonBody(response);
  if (!response.ok) {
    throw new StoreUploadRequestError(
      responseErrorMessage(parsed, `Upload request failed (${response.status})`),
      typeof parsed.code === "string" ? parsed.code : undefined,
    );
  }
  return parsed;
}

export async function requestUploadPlan(store: UploadStoreId, layout: string): Promise<UploadPlanResponse> {
  return await uploadRequest("/api/upload/plan", { store, layout }, false) as unknown as UploadPlanResponse;
}

export async function startStoreUpload(
  plan: Pick<UploadPlanResponse, "store" | "layoutId" | "planHash">,
  operationId: string,
): Promise<{ report: UploadReport; warnings: string[] }> {
  return await uploadRequest("/api/upload", {
    store: plan.store,
    layout: plan.layoutId,
    planHash: plan.planHash,
    operationId,
  }, true) as unknown as { report: UploadReport; warnings: string[] };
}
