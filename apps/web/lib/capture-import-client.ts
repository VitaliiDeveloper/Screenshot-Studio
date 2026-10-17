// SPDX-License-Identifier: Apache-2.0
import type { ProjectScaffoldInput } from "@screenshot-studio/core/scaffold";
import type { ActiveProjectDescriptor } from "./project-session.js";
import { isStrongQuotedETag } from "./http-etag.js";
import { readJsonBody, responseErrorMessage } from "./json-response.js";

export interface CaptureImportCurrentDestination {
  kind: "current-project";
  projectId: string;
  revision: string;
  projectName: string;
  layoutId: string;
}

export type CaptureImportNewDestination = ProjectScaffoldInput & {
  kind: "new-project";
  templateId: null;
};

export type CaptureImportDestination =
  | CaptureImportCurrentDestination
  | CaptureImportNewDestination;

export interface CaptureImportRequest {
  files: readonly File[];
  destination: CaptureImportDestination;
}

export interface CaptureImportCount {
  id: string;
  count: number;
}

export interface CaptureImportPreview {
  receiving: {
    kind: CaptureImportDestination["kind"];
    projectName: string;
    layoutId: string;
    layoutName: string;
  };
  summary: {
    screenCount: number;
    assetCount: number;
    platforms: CaptureImportCount[];
    devices: CaptureImportCount[];
    locales: CaptureImportCount[];
  };
  screens: Array<{
    sourcePath: string;
    screenId: string;
    elementId: string;
    resourcePath: string;
    platform: string;
    device: string;
    locale: string;
    width: number;
    height: number;
  }>;
  resources: Array<{
    sourcePath: string;
    destinationPath: string;
    digest: string;
  }>;
  warnings: Array<{ code: string; path: string; message: string }>;
  invalidEntries: Array<{ code: string; path: string; message: string }>;
  canApply: boolean;
  confirmationFingerprint: string;
}

export interface CaptureImportApplyResult {
  projectId: string;
  project: ActiveProjectDescriptor;
  imported: number;
  receiving?: CaptureImportPreview["receiving"];
  revision?: string;
}

export interface CaptureImportTransportInit {
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export type CaptureImportTransport = (
  endpoint: "/api/capture-import/preview" | "/api/capture-import/apply",
  form: FormData,
  init: CaptureImportTransportInit,
) => Promise<Response>;

export interface CaptureImportClientOptions {
  signal?: AbortSignal;
  transport?: CaptureImportTransport;
}

export class CaptureImportClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CaptureImportClientError";
  }
}

function browserRelativePath(file: File): string {
  return file.webkitRelativePath || file.name;
}

export function buildCaptureImportForm(
  request: CaptureImportRequest,
  confirmationFingerprint?: string,
): FormData {
  if (request.files.length === 0) throw new TypeError("Capture import requires a selected folder");
  const form = new FormData();
  form.set("destinationKind", request.destination.kind);
  if (request.destination.kind === "current-project") {
    form.set("layoutId", request.destination.layoutId);
  } else {
    form.set("name", request.destination.name);
    form.set("platform", request.destination.platform);
    form.set("device", request.destination.device);
    form.set("layoutMode", request.destination.layoutMode);
    form.set("templateId", "");
  }
  for (const file of request.files) {
    form.append("paths", browserRelativePath(file));
    form.append("files", file, file.name);
  }
  if (confirmationFingerprint !== undefined) {
    form.set("confirmationFingerprint", confirmationFingerprint);
  }
  return form;
}

function requestHeaders(destination: CaptureImportDestination): Record<string, string> | undefined {
  if (destination.kind !== "current-project") return undefined;
  const projectId = destination.projectId.trim();
  if (!projectId) throw new TypeError("Capture import target project identity is missing");
  if (!isStrongQuotedETag(destination.revision)) {
    throw new TypeError("Capture import target revision is invalid");
  }
  return { "x-project-id": projectId, "if-match": destination.revision };
}

const fetchCaptureImport: CaptureImportTransport = (endpoint, form, init) => fetch(endpoint, {
  method: "POST",
  body: form,
  signal: init.signal,
  headers: init.headers,
});

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function countList(value: unknown): value is CaptureImportCount[] {
  return Array.isArray(value) && value.every((entry) => {
    const item = record(entry);
    return item !== null && typeof item.id === "string"
      && Number.isSafeInteger(item.count) && Number(item.count) >= 0;
  });
}

function issueList(value: unknown): value is CaptureImportPreview["warnings"] {
  return Array.isArray(value) && value.every((entry) => {
    const item = record(entry);
    return item !== null && typeof item.code === "string"
      && typeof item.path === "string" && typeof item.message === "string";
  });
}

function validPreview(value: unknown): value is CaptureImportPreview {
  const candidate = record(value);
  const receiving = record(candidate?.receiving);
  const summary = record(candidate?.summary);
  return candidate !== null && receiving !== null && summary !== null
    && ["current-project", "new-project"].includes(String(receiving.kind))
    && typeof receiving.projectName === "string"
    && typeof receiving.layoutId === "string"
    && typeof receiving.layoutName === "string"
    && Number.isSafeInteger(summary.screenCount) && Number(summary.screenCount) >= 0
    && Number.isSafeInteger(summary.assetCount) && Number(summary.assetCount) >= 0
    && countList(summary.platforms) && countList(summary.devices) && countList(summary.locales)
    && Array.isArray(candidate.screens) && candidate.screens.every((entry) => {
      const screen = record(entry);
      return screen !== null
        && ["sourcePath", "screenId", "elementId", "resourcePath", "platform", "device", "locale"]
          .every((key) => typeof screen[key] === "string")
        && Number.isSafeInteger(screen.width) && Number(screen.width) > 0
        && Number.isSafeInteger(screen.height) && Number(screen.height) > 0;
    })
    && Array.isArray(candidate.resources) && candidate.resources.every((entry) => {
      const resource = record(entry);
      return resource !== null && typeof resource.sourcePath === "string"
        && typeof resource.destinationPath === "string"
        && typeof resource.digest === "string" && /^[0-9a-f]{64}$/u.test(resource.digest);
    })
    && issueList(candidate.warnings) && issueList(candidate.invalidEntries)
    && typeof candidate.canApply === "boolean"
    && typeof candidate.confirmationFingerprint === "string"
    && /^[0-9a-f]{64}$/u.test(candidate.confirmationFingerprint);
}

async function throwResponseError(response: Response, body: Record<string, unknown>): Promise<never> {
  throw new CaptureImportClientError(
    responseErrorMessage(body, `Capture import failed (${response.status})`),
    typeof body.code === "string" ? body.code : "request-failed",
    response.status,
  );
}

export async function previewCaptureImport(
  request: CaptureImportRequest,
  options: CaptureImportClientOptions = {},
): Promise<CaptureImportPreview> {
  const response = await (options.transport ?? fetchCaptureImport)(
    "/api/capture-import/preview",
    buildCaptureImportForm(request),
    { signal: options.signal, headers: requestHeaders(request.destination) },
  );
  const body = await readJsonBody(response);
  if (!response.ok) return throwResponseError(response, body);
  if (!validPreview(body.preview)) {
    throw new CaptureImportClientError(
      "Capture import preview returned an invalid response",
      "invalid-response",
      response.status,
    );
  }
  return body.preview;
}

function validProjectDescriptor(value: unknown): value is ActiveProjectDescriptor {
  const project = record(value);
  return project !== null && typeof project.sessionId === "string"
    && typeof project.name === "string" && typeof project.sourceKind === "string"
    && record(project.capabilities) !== null;
}

export async function applyCaptureImport(
  request: CaptureImportRequest,
  confirmationFingerprint: string,
  options: CaptureImportClientOptions = {},
): Promise<CaptureImportApplyResult> {
  if (!/^[0-9a-f]{64}$/u.test(confirmationFingerprint)) {
    throw new TypeError("Capture import confirmation fingerprint is invalid");
  }
  const response = await (options.transport ?? fetchCaptureImport)(
    "/api/capture-import/apply",
    buildCaptureImportForm(request, confirmationFingerprint),
    { signal: options.signal, headers: requestHeaders(request.destination) },
  );
  const body = await readJsonBody(response);
  if (!response.ok) return throwResponseError(response, body);
  const projectId = response.headers.get("x-project-id")?.trim();
  const validProjectId = request.destination.kind === "new-project"
    ? /^project_[0-9a-f]{32}$/u.test(projectId ?? "")
    : /^(?:project_[0-9a-f]{32}|[0-9a-f]{64})$/u.test(projectId ?? "");
  if (!validProjectDescriptor(body.project)
    || !projectId || !validProjectId
    || !Number.isSafeInteger(body.imported) || Number(body.imported) < 0) {
    throw new CaptureImportClientError(
      "Capture import apply returned an invalid response",
      "invalid-response",
      response.status,
    );
  }
  return {
    projectId,
    project: body.project,
    imported: Number(body.imported),
    ...(record(body.receiving) === null ? {} : {
      receiving: body.receiving as CaptureImportPreview["receiving"],
    }),
    ...(response.headers.get("etag") ? { revision: response.headers.get("etag")! } : {}),
  };
}
