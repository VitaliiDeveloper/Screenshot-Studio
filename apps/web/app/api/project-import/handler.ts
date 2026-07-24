// SPDX-License-Identifier: Apache-2.0
import {
  ManagedProjectImportError,
  ManagedProjectImportService,
  type ManagedProjectImportKind,
  type ProjectImportFile,
} from "@web/lib/managed-project-import.server.js";
import { resolveManagedProjectStorageConfig } from "@web/lib/managed-project-config.server.js";
import { ManagedProjectRepository } from "@web/lib/managed-project-repository.server.js";
import {
  projectSessionRegistry,
  type ProjectSessionRegistry,
} from "@web/lib/project-session.server.js";
import {
  recentProjectsStore,
  type RecentProjectsStore,
} from "@web/lib/recent-projects.server.js";
import { ProjectZipError, readProjectZipFiles } from "@web/lib/project-zip.server.js";
import { projectSessionResponseHeaders } from "@web/app/api/project-session/handler.js";

export interface ProjectImportRouteDependencies {
  repository?: ManagedProjectRepository;
  registry?: ProjectSessionRegistry;
  recentProjects?: Pick<RecentProjectsStore, "record">;
}

class UploadLimitError extends Error {}

function errorResponse(
  status: number,
  error: string,
  code: string,
  missingResources: readonly string[] = [],
): Response {
  return Response.json({
    error,
    code,
    ...(missingResources.length === 0 ? {} : { missingResources }),
  }, { status, headers: { "cache-control": "no-store" } });
}

function isUpload(value: FormDataEntryValue): value is File {
  return typeof value !== "string" && typeof value.stream === "function"
    && typeof value.size === "number";
}

function uploadFile(path: string, file: File): ProjectImportFile {
  return {
    relativePath: path,
    declaredSize: file.size,
    async *open() {
      const reader = file.stream().getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return;
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}

function asImportKind(value: FormDataEntryValue | null): ManagedProjectImportKind | null {
  return value === "folder" || value === "archive" || value === "json" ? value : null;
}

function statusForImportError(error: ManagedProjectImportError): number {
  if (error.code === "cancelled") return 499;
  if (error.code === "limit") return 413;
  if (error.code === "invalid-project" || error.code === "missing-resources") return 422;
  return 400;
}

function publicImportErrorMessage(error: ManagedProjectImportError): string {
  return error.code === "invalid-project"
    ? "Project document failed strict validation"
    : error.message;
}

async function boundedFormData(request: Request, maxBytes: number): Promise<FormData> {
  if (!request.body) throw new TypeError("Project import request body is missing");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  let exceeded = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        exceeded = true;
      } else if (!exceeded) {
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (exceeded) throw new UploadLimitError("Project import upload exceeds the configured byte limit");
  const boundedBody = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    boundedBody.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const boundedRequest = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: boundedBody,
    signal: request.signal,
  });
  return boundedRequest.formData();
}

export async function handleProjectImportPost(
  request: Request,
  dependencies: ProjectImportRouteDependencies = {},
): Promise<Response> {
  const repository = dependencies.repository
    ?? new ManagedProjectRepository(resolveManagedProjectStorageConfig());
  const registry = dependencies.registry ?? projectSessionRegistry;
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    return errorResponse(415, "Project import requires multipart form data", "unsupported-media-type");
  }
  const declaredRequestBytes = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredRequestBytes)
    && declaredRequestBytes > repository.config.maxImportUploadBytes) {
    return errorResponse(413, "Project import upload exceeds the configured byte limit", "limit");
  }
  if (request.signal.aborted) {
    return errorResponse(499, "Project import was cancelled", "cancelled");
  }

  let form: FormData;
  try {
    form = await boundedFormData(request, repository.config.maxImportUploadBytes);
  } catch (error) {
    if (request.signal.aborted) return errorResponse(499, "Project import was cancelled", "cancelled");
    if (error instanceof UploadLimitError
      || (error instanceof Error && error.cause instanceof UploadLimitError)) {
      return errorResponse(413, "Project import upload exceeds the configured byte limit", "limit");
    }
    return errorResponse(400, `Project import form data is invalid: ${error instanceof Error ? error.message : String(error)}`, "invalid-request");
  }
  const kind = asImportKind(form.get("kind"));
  const fileValues = form.getAll("files");
  const pathValues = form.getAll("paths");
  if (!kind || fileValues.some((value) => !isUpload(value))
    || pathValues.some((value) => typeof value !== "string")) {
    return errorResponse(400, "Project import fields are invalid", "invalid-request");
  }
  const files = fileValues as File[];
  const paths = pathValues as string[];
  if (files.length === 0 || paths.length !== files.length
    || (kind !== "folder" && files.length !== 1)) {
    return errorResponse(400, "Project import files and paths must be aligned", "invalid-request");
  }
  const uploadBytes = files.reduce((total, file) => total + file.size, 0);
  if (!Number.isSafeInteger(uploadBytes) || uploadBytes > repository.config.maxImportUploadBytes) {
    return errorResponse(413, "Project import upload exceeds the configured byte limit", "limit");
  }

  try {
    const normalizedFiles = kind === "archive"
      ? await readProjectZipFiles(new Uint8Array(await files[0]!.arrayBuffer()), {
          maxFiles: repository.config.maxProjectFiles,
          maxBytes: repository.config.maxProjectBytes,
        })
      : files.map((file, index) => uploadFile(paths[index]!, file));
    if (request.signal.aborted) {
      throw new ManagedProjectImportError("Project import was cancelled", "cancelled");
    }
    const record = await new ManagedProjectImportService(repository).import({
      kind,
      files: normalizedFiles,
      signal: request.signal,
    });
    const session = registry.openManagedRecord(record);
    await (dependencies.recentProjects ?? recentProjectsStore).record(session).catch(() => undefined);
    const headers = projectSessionResponseHeaders(session, request);
    headers.set("x-project-id", session.projectId);
    return Response.json({ project: session.descriptor }, {
      status: 201,
      headers,
    });
  } catch (error) {
    if (error instanceof ManagedProjectImportError) {
      return errorResponse(
        statusForImportError(error),
        publicImportErrorMessage(error),
        error.code,
        error.missingResources,
      );
    }
    if (error instanceof ProjectZipError) {
      return errorResponse(error.code === "limit" ? 413 : 400, error.message, error.code);
    }
    return errorResponse(500, "Project import failed", "internal");
  }
}
