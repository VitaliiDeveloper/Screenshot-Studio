// SPDX-License-Identifier: Apache-2.0
import {
  CaptureImportConfirmationError,
  CaptureImportCancelledError,
  DEFAULT_CAPTURE_IMPORT_LIMITS,
  discoverCaptureImport,
  planCaptureImport,
  type CaptureImportDiscovery,
  type CaptureImportInputFile,
  type CaptureImportPlan,
} from "@screenshot-studio/core/capture-import";
import { ProjectScaffoldInput, type ProjectScaffoldInput as ScaffoldInput } from "@screenshot-studio/core/scaffold";
import {
  ProjectRevisionConflictError,
  readIdentifiedProjectSnapshot,
} from "@screenshot-studio/core/storage";
import {
  applyCaptureImportToProject,
  preflightCaptureImportPlanResources,
  SafeFileConflictError,
} from "@screenshot-studio/cli/capture-import-transaction";
import {
  createManagedProjectFromCaptureImport,
  previewManagedProjectCaptureImport,
} from "@web/lib/managed-capture-import.server.js";
import { resolveManagedProjectStorageConfig } from "@web/lib/managed-project-config.server.js";
import {
  ManagedProjectCreationError,
  ManagedProjectCreationService,
} from "@web/lib/managed-project-creation.server.js";
import { ManagedProjectRepository } from "@web/lib/managed-project-repository.server.js";
import {
  projectRevisionConflictResponse,
  withProjectMutationRequest,
  withProjectVersionedReadRequest,
} from "@web/lib/project-request-fence.server.js";
import {
  projectSessionRegistry,
  type ProjectSessionRegistry,
} from "@web/lib/project-session.server.js";
import {
  recentProjectsStore,
  type RecentProjectsStore,
} from "@web/lib/recent-projects.server.js";
import { projectSessionResponseHeaders } from "@web/app/api/project-session/handler.js";

class CaptureUploadLimitError extends Error {}
class CaptureRequestError extends Error {}

type CurrentDestination = { kind: "current-project"; layoutId: string };
type NewDestination = { kind: "new-project"; scaffoldInput: ScaffoldInput };
type CaptureDestination = CurrentDestination | NewDestination;

interface ParsedCaptureRequest {
  destination: CaptureDestination;
  discovery: CaptureImportDiscovery;
  confirmationFingerprint?: string;
}

export interface CaptureImportRouteDependencies {
  repository?: ManagedProjectRepository;
  creationService?: ManagedProjectCreationService;
  registry?: ProjectSessionRegistry;
  applyCurrent?: typeof applyCaptureImportToProject;
  recentProjects?: Pick<RecentProjectsStore, "record">;
}

const COMMON_FIELDS = new Set(["destinationKind", "paths", "files"]);
const CURRENT_FIELDS = new Set([...COMMON_FIELDS, "layoutId", "confirmationFingerprint"]);
const NEW_FIELDS = new Set([
  ...COMMON_FIELDS,
  "name",
  "platform",
  "device",
  "layoutMode",
  "templateId",
  "confirmationFingerprint",
]);

function errorResponse(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function quotedRevision(revision: string): string {
  return `"${revision}"`;
}

function isUpload(value: FormDataEntryValue): value is File {
  return typeof value !== "string"
    && typeof value.arrayBuffer === "function"
    && typeof value.size === "number";
}

function oneString(form: FormData, name: string): string | undefined {
  const values = form.getAll(name);
  if (values.length === 0) return undefined;
  if (values.length !== 1 || typeof values[0] !== "string") {
    throw new CaptureRequestError(`Capture import field "${name}" is invalid`);
  }
  return values[0];
}

function parseDestination(form: FormData): CaptureDestination {
  const kind = oneString(form, "destinationKind");
  const allowed = kind === "current-project" ? CURRENT_FIELDS
    : kind === "new-project" ? NEW_FIELDS
      : undefined;
  if (!allowed) throw new CaptureRequestError("Capture import destination is invalid");
  for (const key of form.keys()) {
    if (!allowed.has(key)) throw new CaptureRequestError(`Unexpected capture import field "${key}"`);
  }
  if (kind === "current-project") {
    const layoutId = oneString(form, "layoutId")?.trim();
    if (!layoutId) throw new CaptureRequestError("Capture import layout is required");
    return { kind: "current-project", layoutId };
  }
  if (kind !== "new-project") {
    throw new CaptureRequestError("Capture import destination is invalid");
  }
  const templateId = oneString(form, "templateId");
  if (templateId === undefined) {
    throw new CaptureRequestError("Capture import template choice is required");
  }
  const scaffold = ProjectScaffoldInput.safeParse({
    name: oneString(form, "name"),
    platform: oneString(form, "platform"),
    device: oneString(form, "device"),
    layoutMode: oneString(form, "layoutMode"),
    templateId: templateId || null,
  });
  if (!scaffold.success) throw new CaptureRequestError("Capture import project fields are invalid");
  return { kind: "new-project", scaffoldInput: scaffold.data };
}

async function boundedFormData(request: Request, maxBytes: number): Promise<FormData> {
  if (!request.body) throw new CaptureRequestError("Capture import request body is missing");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (!Number.isSafeInteger(total) || total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new CaptureUploadLimitError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: bytes,
    signal: request.signal,
  }).formData();
}

async function parseCaptureRequest(
  request: Request,
  repository: ManagedProjectRepository,
  requireConfirmation: boolean,
): Promise<ParsedCaptureRequest> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw new CaptureRequestError("Capture import requires multipart form data");
  }
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const bytes = Number(declared);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new CaptureRequestError("Capture import content length is invalid");
    }
    if (bytes > repository.config.maxImportUploadBytes) {
      await request.body?.cancel().catch(() => undefined);
      throw new CaptureUploadLimitError();
    }
  }
  if (request.signal.aborted) throw new DOMException("Capture import was cancelled", "AbortError");
  let form: FormData;
  try {
    form = await boundedFormData(request, repository.config.maxImportUploadBytes);
  } catch (error) {
    if (error instanceof CaptureUploadLimitError) throw error;
    if (request.signal.aborted) {
      throw new DOMException("Capture import was cancelled", "AbortError");
    }
    throw new CaptureRequestError("Capture import form data is invalid");
  }
  const destination = parseDestination(form);
  const fileValues = form.getAll("files");
  const pathValues = form.getAll("paths");
  if (fileValues.length === 0 || fileValues.length !== pathValues.length
    || fileValues.some((value) => !isUpload(value))
    || pathValues.some((value) => typeof value !== "string")) {
    throw new CaptureRequestError("Capture import files and paths must be aligned");
  }
  const files = fileValues as File[];
  const paths = pathValues as string[];
  const maxFiles = Math.min(
    DEFAULT_CAPTURE_IMPORT_LIMITS.maxFiles,
    repository.config.maxProjectFiles,
  );
  if (files.length > maxFiles) throw new CaptureUploadLimitError();
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (!Number.isSafeInteger(totalBytes) || totalBytes > repository.config.maxImportUploadBytes) {
    throw new CaptureUploadLimitError();
  }
  const inputFiles: CaptureImportInputFile[] = await Promise.all(files.map(async (file, index) => ({
    relativePath: paths[index]!,
    bytes: new Uint8Array(await file.arrayBuffer()),
  })));
  if (request.signal.aborted) throw new DOMException("Capture import was cancelled", "AbortError");
  const discovery = discoverCaptureImport({
    files: inputFiles,
    limits: {
      maxFiles,
      maxBytes: Math.min(
        DEFAULT_CAPTURE_IMPORT_LIMITS.maxBytes,
        repository.config.maxProjectBytes,
        repository.config.maxImportUploadBytes,
      ),
    },
  });
  const confirmationFingerprint = oneString(form, "confirmationFingerprint")?.trim();
  if (requireConfirmation && !/^[0-9a-f]{64}$/u.test(confirmationFingerprint ?? "")) {
    throw new CaptureRequestError("Capture import confirmation is required");
  }
  if (!requireConfirmation && confirmationFingerprint !== undefined) {
    throw new CaptureRequestError("Capture import preview cannot include a confirmation");
  }
  return {
    destination,
    discovery,
    ...(confirmationFingerprint === undefined ? {} : { confirmationFingerprint }),
  };
}

function publicPlan(plan: CaptureImportPlan) {
  return {
    receiving: plan.receiving,
    summary: plan.summary,
    screens: plan.screens,
    resources: plan.resources.map(({ sourcePath, destinationPath, digest }) => ({
      sourcePath,
      destinationPath,
      digest,
    })),
    warnings: plan.warnings,
    invalidEntries: plan.invalidEntries,
    canApply: plan.canApply,
    confirmationFingerprint: plan.confirmationFingerprint,
  };
}

function routeError(error: unknown): Response {
  const revisionConflict = projectRevisionConflictResponse(error);
  if (revisionConflict) return revisionConflict;
  if (error instanceof CaptureUploadLimitError
    || (error instanceof Error && /configured (?:file|byte) limit/iu.test(error.message))) {
    return errorResponse(413, "Capture import exceeds the configured limit", "limit");
  }
  if (error instanceof CaptureRequestError) {
    const media = error.message.includes("multipart form data");
    return errorResponse(media ? 415 : 400, error.message, media ? "unsupported-media-type" : "invalid-request");
  }
  if (error instanceof CaptureImportConfirmationError) {
    return errorResponse(409, error.message, "preview-changed");
  }
  if (error instanceof SafeFileConflictError) {
    return errorResponse(
      409,
      "Capture import preview changed; preview again before applying",
      "preview-changed",
    );
  }
  if (error instanceof CaptureImportCancelledError) {
    return errorResponse(499, error.message, "cancelled");
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return errorResponse(499, "Capture import was cancelled", "cancelled");
  }
  if (error instanceof ManagedProjectCreationError) {
    if (error.code === "cancelled") return errorResponse(499, "Capture import was cancelled", "cancelled");
    if (error.code === "limit") return errorResponse(413, "Capture import exceeds the configured limit", "limit");
    if (error.code === "invalid-scaffold") {
      return errorResponse(422, "Capture import project fields are incompatible", "invalid-scaffold");
    }
  }
  if (error instanceof Error && /invalid entries|cannot be applied|layout/iu.test(error.message)) {
    return errorResponse(422, "Capture import preview is invalid", "invalid-preview");
  }
  return errorResponse(500, "Capture import failed", "internal");
}

function resolveDependencies(dependencies: CaptureImportRouteDependencies) {
  const repository = dependencies.repository
    ?? new ManagedProjectRepository(resolveManagedProjectStorageConfig());
  return {
    repository,
    creationService: dependencies.creationService ?? new ManagedProjectCreationService(repository),
    registry: dependencies.registry ?? projectSessionRegistry,
    applyCurrent: dependencies.applyCurrent ?? applyCaptureImportToProject,
    recentProjects: dependencies.recentProjects ?? recentProjectsStore,
  };
}

export async function handleCaptureImportPreviewPost(
  request: Request,
  dependencies: CaptureImportRouteDependencies = {},
): Promise<Response> {
  const resolved = resolveDependencies(dependencies);
  let parsed: ParsedCaptureRequest;
  try {
    parsed = await parseCaptureRequest(request, resolved.repository, false);
  } catch (error) {
    return routeError(error);
  }
  if (parsed.destination.kind === "new-project") {
    try {
      const plan = await previewManagedProjectCaptureImport({
        scaffoldInput: parsed.destination.scaffoldInput,
        discovery: parsed.discovery,
        creationService: resolved.creationService,
        signal: request.signal,
      });
      return Response.json({ preview: publicPlan(plan) }, {
        headers: { "cache-control": "no-store" },
      });
    } catch (error) {
      return routeError(error);
    }
  }
  const destination = parsed.destination;
  return withProjectVersionedReadRequest(request, async (session, expectedRevision) => {
    try {
      const snapshot = await readIdentifiedProjectSnapshot(session.projectPath);
      if (snapshot.revision !== expectedRevision) {
        throw new ProjectRevisionConflictError(expectedRevision, snapshot.revision);
      }
      const plan = await preflightCaptureImportPlanResources(session.projectPath, planCaptureImport({
        project: snapshot.project,
        layoutId: destination.layoutId,
        destinationKind: "current-project",
        discovery: parsed.discovery,
      }));
      return Response.json({
        preview: publicPlan(plan),
      }, {
        headers: {
          "cache-control": "no-store",
          etag: quotedRevision(snapshot.revision),
          "x-project-id": session.projectId,
        },
      });
    } catch (error) {
      return routeError(error);
    }
  }, {
    registry: resolved.registry,
    managedStorageConfig: resolved.repository.config,
  });
}

export async function handleCaptureImportApplyPost(
  request: Request,
  dependencies: CaptureImportRouteDependencies = {},
): Promise<Response> {
  const resolved = resolveDependencies(dependencies);
  let parsed: ParsedCaptureRequest;
  try {
    parsed = await parseCaptureRequest(request, resolved.repository, true);
  } catch (error) {
    return routeError(error);
  }
  if (parsed.destination.kind === "new-project") {
    let reservedSessionId: string;
    try {
      reservedSessionId = resolved.registry.reserveSessionId();
    } catch {
      return errorResponse(500, "Capture import failed", "internal");
    }
    try {
      const record = await createManagedProjectFromCaptureImport({
        scaffoldInput: parsed.destination.scaffoldInput,
        discovery: parsed.discovery,
        confirmationFingerprint: parsed.confirmationFingerprint,
        creationService: resolved.creationService,
        signal: request.signal,
      });
      const session = resolved.registry.openManagedRecord(record, reservedSessionId);
      await resolved.recentProjects.record(session).catch(() => undefined);
      const headers = projectSessionResponseHeaders(session, request);
      headers.set("x-project-id", session.projectId);
      return Response.json({ project: session.descriptor, imported: parsed.discovery.summary.screenCount }, {
        status: 201,
        headers,
      });
    } catch (error) {
      resolved.registry.releaseReservedSessionId(reservedSessionId);
      return routeError(error);
    }
  }
  const destination = parsed.destination;
  return withProjectMutationRequest(request, async (session, expectedRevision) => {
    try {
      const result = await resolved.applyCurrent({
        projectPath: session.projectPath,
        expectedRevision,
        layoutId: destination.layoutId,
        discovery: parsed.discovery,
        confirmationFingerprint: parsed.confirmationFingerprint,
        signal: request.signal,
      });
      return Response.json({
        project: session.descriptor,
        imported: result.imported,
        receiving: result.plan.receiving,
      }, {
        headers: {
          "cache-control": "no-store",
          etag: quotedRevision(result.revision),
          "x-project-id": session.projectId,
        },
      });
    } catch (error) {
      return routeError(error);
    }
  }, {
    registry: resolved.registry,
    managedStorageConfig: resolved.repository.config,
  });
}
