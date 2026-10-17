// SPDX-License-Identifier: Apache-2.0
import type {
  ActiveProjectDescriptor,
  ActiveProjectSelection,
} from "./project-session.js";
import { readJsonBody, responseErrorMessage } from "./json-response.js";

const MANAGED_PROJECT_ID_PATTERN = /^project_[0-9a-f]{32}$/;

export type BrowserProjectImportSource =
  | { kind: "folder"; files: readonly File[] }
  | { kind: "archive" | "json"; file: File };

export interface ProjectImportTransportOptions {
  signal?: AbortSignal;
  onUploadComplete?(): void;
}

export type ProjectImportTransport = (
  form: FormData,
  options: ProjectImportTransportOptions,
) => Promise<Response>;

export interface ImportProjectOptions extends ProjectImportTransportOptions {
  transport?: ProjectImportTransport;
}

export class ProjectImportClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly missingResources: readonly string[] = [],
  ) {
    super(message);
    this.name = "ProjectImportClientError";
  }
}

function appendFile(form: FormData, path: string, file: File): void {
  form.append("paths", path);
  form.append("files", file, file.name);
}

export function buildProjectImportForm(source: BrowserProjectImportSource): FormData {
  const form = new FormData();
  form.set("kind", source.kind);
  if (source.kind === "folder") {
    if (source.files.length === 0) throw new TypeError("Folder import requires at least one file");
    for (const file of source.files) {
      const relativePath = file.webkitRelativePath;
      if (!relativePath) throw new TypeError("Folder import requires browser relative paths");
      appendFile(form, relativePath, file);
    }
    return form;
  }
  if (!source.file || typeof source.file.name !== "string") {
    throw new TypeError(`${source.kind === "archive" ? "ZIP" : "JSON"} import requires exactly one file`);
  }
  appendFile(form, source.file.name, source.file);
  return form;
}

function abortError(): DOMException {
  return new DOMException("Project import was cancelled", "AbortError");
}

export const xhrProjectImportTransport: ProjectImportTransport = (form, options) => (
  new Promise<Response>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError());
      return;
    }
    const xhr = new XMLHttpRequest();
    let settled = false;
    const cleanup = () => options.signal?.removeEventListener("abort", abort);
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      operation();
    };
    const abort = () => xhr.abort();
    xhr.open("POST", "/api/project-import");
    xhr.upload.addEventListener("load", () => options.onUploadComplete?.(), { once: true });
    xhr.addEventListener("load", () => finish(() => resolve(new Response(xhr.responseText, {
      status: xhr.status,
      headers: {
        "content-type": xhr.getResponseHeader("content-type") ?? "application/json",
        "x-project-id": xhr.getResponseHeader("x-project-id") ?? "",
      },
    }))));
    xhr.addEventListener("error", () => finish(() => reject(new Error("Project import request failed"))));
    xhr.addEventListener("abort", () => finish(() => reject(abortError())));
    options.signal?.addEventListener("abort", abort, { once: true });
    xhr.send(form);
  })
);

export async function importProject(
  source: BrowserProjectImportSource,
  options: ImportProjectOptions = {},
): Promise<ActiveProjectSelection> {
  const response = await (options.transport ?? xhrProjectImportTransport)(
    buildProjectImportForm(source),
    options,
  );
  const body = await readJsonBody(response) as {
    project?: ActiveProjectDescriptor;
    error?: unknown;
    code?: unknown;
    missingResources?: unknown;
  };
  if (!response.ok) {
    throw new ProjectImportClientError(
      responseErrorMessage(body, `Project import failed (${response.status})`),
      typeof body.code === "string" ? body.code : "request-failed",
      Array.isArray(body.missingResources)
        ? body.missingResources.filter((value): value is string => typeof value === "string")
        : [],
    );
  }
  if (!body.project || typeof body.project.name !== "string"
    || typeof body.project.sessionId !== "string"
    || body.project.sourceKind !== "managed-project"
    || typeof body.project.capabilities !== "object"
    || body.project.capabilities === null) {
    throw new ProjectImportClientError("Project import returned an invalid response", "invalid-response");
  }
  const projectId = response.headers.get("x-project-id")?.trim();
  if (!projectId || !MANAGED_PROJECT_ID_PATTERN.test(projectId)) {
    throw new ProjectImportClientError(
      "Project import response is missing its project identity",
      "invalid-response",
    );
  }
  return { ...body.project, projectId };
}
