// SPDX-License-Identifier: Apache-2.0
import { exportBundle, type ExportBundleProgress } from "@screenshot-studio/cli/export";
import { runUploadCommand } from "@screenshot-studio/cli/upload";
import { errorText, ProjectRevisionConflictError } from "@screenshot-studio/core/storage";
import { jsonError } from "@web/lib/api-error-response.server.js";
import { EXPORT_OPERATION_ID_PATTERN } from "@web/lib/export-progress.js";
import { exportProgressRegistry, type ExportProgressRegistry } from "@web/lib/export-progress.server.js";
import { isRecord } from "@web/lib/json-guards.js";
import { projectRevisionConflictResponse } from "@web/lib/session/project-request-fence.server.js";
import type { LocalProjectSession } from "@web/lib/session/project-session.server.js";
import { sharedStoreCredentialStore, type StoreCredentialStore } from "@web/lib/store-credentials.server.js";
import { resolveStoreSpecsPath } from "@web/lib/store-specs-path.js";
import { isUploadStore, uploadImageCount, type UploadPlanResponse } from "@web/lib/store-upload.js";
import {
  computeUploadPlan,
  MissingStoreIdentifierError,
  uploadPlanRegistry,
  type UploadPlanRegistry,
} from "@web/lib/store-upload.server.js";

export interface UploadRouteDependencies {
  credentials?: StoreCredentialStore;
  plans?: UploadPlanRegistry;
  runUploadCommand?: typeof runUploadCommand;
  exportBundle?: typeof exportBundle;
  progressRegistry?: Pick<ExportProgressRegistry, "begin" | "update" | "finish">;
  env?: NodeJS.ProcessEnv;
}

interface UploadRequest {
  store?: unknown;
  layout?: unknown;
  planHash?: unknown;
  operationId?: unknown;
}

class StalePlanError extends Error {}

async function requestBody(req: Request): Promise<UploadRequest | Response> {
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body)) return jsonError(400, "request body must be a JSON object");
  if (!isUploadStore(body.store)) return jsonError(422, "Unsupported store; only google uploads are available");
  if (body.layout !== undefined && typeof body.layout !== "string") return jsonError(422, "layout must be a layout id");
  return body;
}

async function plan(
  session: LocalProjectSession,
  body: UploadRequest,
  credentials: StoreCredentialStore,
): Promise<UploadPlanResponse | Response> {
  const store = body.store as UploadPlanResponse["store"];
  try {
    return await computeUploadPlan(
      session.projectPath,
      session.projectId,
      store,
      body.layout as string | undefined,
      (await credentials.status())[store].configured,
    );
  } catch (error) {
    if (error instanceof MissingStoreIdentifierError) return jsonError(409, error.message, "missing-identifier");
    return jsonError(422, errorText(error));
  }
}

/** Offline plan for review; the returned `planHash` is what `/api/upload` must be confirmed with. */
export async function handleUploadPlanPost(
  session: LocalProjectSession,
  req: Request,
  { credentials = sharedStoreCredentialStore(), plans = uploadPlanRegistry }: UploadRouteDependencies = {},
): Promise<Response> {
  const body = await requestBody(req);
  if (body instanceof Response) return body;
  const result = await plan(session, body, credentials);
  if (result instanceof Response) return result;
  plans.issue(session.projectId, result.planHash);
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}

/**
 * Runs `screenshots upload` for a plan the user reviewed. The hash must be the one last issued for this
 * project and must still match a plan recomputed under the mutation guard; rendering then checks it
 * renders the same revision. The CLI owns rendering, the Play edit lifecycle, and its report.
 */
export async function handleUploadPost(
  session: LocalProjectSession,
  req: Request,
  expectedRevision: string,
  {
    credentials = sharedStoreCredentialStore(),
    plans = uploadPlanRegistry,
    runUploadCommand: runUpload = runUploadCommand,
    exportBundle: exportBundleOutputs = exportBundle,
    progressRegistry = exportProgressRegistry,
    env = process.env,
  }: UploadRouteDependencies = {},
): Promise<Response> {
  const body = await requestBody(req);
  if (body instanceof Response) return body;
  if (body.operationId !== undefined && (
    typeof body.operationId !== "string" || !EXPORT_OPERATION_ID_PATTERN.test(body.operationId)
  )) return jsonError(422, "Invalid upload operation id");
  const operationId = body.operationId as string | undefined;

  const issued = plans.take(session.projectId);
  if (typeof body.planHash !== "string" || issued !== body.planHash) {
    return jsonError(409, "Review the upload plan and confirm it before uploading", "plan-not-confirmed");
  }
  const current = await plan(session, body, credentials);
  if (current instanceof Response) return current;
  if (current.revision !== expectedRevision) {
    return projectRevisionConflictResponse(new ProjectRevisionConflictError(expectedRevision, current.revision))!;
  }
  if (current.planHash !== body.planHash) {
    return jsonError(409, "The project changed after the plan was reviewed; review it again", "plan-stale");
  }
  const accountPath = await credentials.googleServiceAccountPath();
  if (!accountPath) return jsonError(409, "Google Play is not configured; add its service account key in Stores", "not-configured");

  const total = uploadImageCount(current.plan);
  if (operationId) {
    try {
      progressRegistry.begin(operationId, total);
    } catch (error) {
      return jsonError(409, errorText(error));
    }
  }
  const origin = new URL(req.url).origin;
  const warnings: string[] = [];
  try {
    const output = await runUpload({
      project: session.projectPath,
      store: current.store,
      layout: current.layoutId,
      "service-account": accountPath,
      json: "true",
    }, resolveStoreSpecsPath(), {
      env,
      // Renders through this Next host, like /api/export, instead of spawning a second server.
      startWebServer: async () => ({ url: origin, exited: new Promise<Error>(() => undefined), stop: async () => undefined }),
      exportBundle: async (options) => {
        if (options.projectRevision !== current.revision) {
          throw new StalePlanError("The project changed after the plan was reviewed; review it again");
        }
        const zipPath = await exportBundleOutputs({
          ...options,
          onProgress: operationId
            ? (progress: ExportBundleProgress) => progressRegistry.update(operationId, progress.phase, progress.completed, progress.total)
            : undefined,
        });
        if (operationId) progressRegistry.update(operationId, "uploading", total, total);
        return zipPath;
      },
      warn: (message) => { warnings.push(message); },
    });
    if (operationId) progressRegistry.finish(operationId, "ready");
    return Response.json({ report: JSON.parse(output), warnings }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (operationId) progressRegistry.finish(operationId, "failed");
    if (error instanceof StalePlanError) return jsonError(409, error.message, "plan-stale");
    return projectRevisionConflictResponse(error) ?? jsonError(502, errorText(error));
  }
}
