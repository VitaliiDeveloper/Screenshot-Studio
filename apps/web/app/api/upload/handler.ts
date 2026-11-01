// SPDX-License-Identifier: Apache-2.0
import {
  APP_STORE_CONNECT_API_ROOT,
  AppStoreConnectRequestError,
  createAppStoreConnectClient,
  readAppStoreConnectKey,
} from "@screenshot-studio/cli/app-store-connect-client";
import {
  APP_STORE_CONNECT_ISSUER_ID_ENV,
  APP_STORE_CONNECT_KEY_ID_ENV,
  runAppStoreUploadCommand,
} from "@screenshot-studio/cli/app-store-upload";
import { exportBundle, type ExportBundleProgress } from "@screenshot-studio/cli/export";
import { createRenderBrowserSession } from "@screenshot-studio/cli/render-driver";
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
  UnknownStoreVersionError,
  uploadPlanRegistry,
  type AppStorePlanOptions,
  type UploadPlanRegistry,
} from "@web/lib/store-upload.server.js";

export interface UploadRouteDependencies {
  credentials?: StoreCredentialStore;
  plans?: UploadPlanRegistry;
  runUploadCommand?: typeof runUploadCommand;
  runAppStoreUploadCommand?: typeof runAppStoreUploadCommand;
  /** Tests point App Store Connect at a loopback mock; production always uses Apple's API root. */
  appStoreApiRoot?: string;
  exportBundle?: typeof exportBundle;
  progressRegistry?: Pick<ExportProgressRegistry, "begin" | "update" | "finish">;
  env?: NodeJS.ProcessEnv;
}

interface UploadRequest {
  store?: unknown;
  layout?: unknown;
  planHash?: unknown;
  operationId?: unknown;
  version?: unknown;
}

class StalePlanError extends Error {}

async function requestBody(req: Request): Promise<UploadRequest | Response> {
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body)) return jsonError(400, "request body must be a JSON object");
  if (!isUploadStore(body.store)) return jsonError(422, "Unsupported store; use google or apple");
  if (body.layout !== undefined && typeof body.layout !== "string") return jsonError(422, "layout must be a layout id");
  if (body.version !== undefined && typeof body.version !== "string") return jsonError(422, "version must be a version string");
  return body;
}

/** Reads editable versions with the key from the key store; the key never leaves the server. */
async function appStorePlanOptions(
  credentials: StoreCredentialStore,
  body: UploadRequest,
  apiRoot: string,
): Promise<AppStorePlanOptions> {
  const version = body.version as string | undefined;
  const apple = await credentials.appleCredentials();
  if (!apple) return { version };
  const client = createAppStoreConnectClient({
    apiRoot,
    key: await readAppStoreConnectKey(apple.keyPath, apple.keyId, apple.issuerId),
    fetch,
  });
  return { version, listEditableVersions: (appId, platform) => client.listEditableVersions(appId, platform) };
}

async function plan(
  session: LocalProjectSession,
  body: UploadRequest,
  credentials: StoreCredentialStore,
  appStoreApiRoot: string,
): Promise<UploadPlanResponse | Response> {
  const store = body.store as UploadPlanResponse["store"];
  try {
    return await computeUploadPlan(
      session.projectPath,
      session.projectId,
      store,
      body.layout as string | undefined,
      (await credentials.status())[store].configured,
      store === "apple" ? await appStorePlanOptions(credentials, body, appStoreApiRoot) : undefined,
    );
  } catch (error) {
    if (error instanceof MissingStoreIdentifierError) return jsonError(409, error.message, "missing-identifier");
    if (error instanceof AppStoreConnectRequestError) return jsonError(502, errorText(error));
    if (error instanceof UnknownStoreVersionError) return jsonError(422, error.message, "unknown-version");
    return jsonError(422, errorText(error));
  }
}

/**
 * Plan for review; the returned `planHash` is what `/api/upload` must be confirmed with. A Google plan
 * is offline; an Apple plan also reads the editable versions with the stored key.
 */
export async function handleUploadPlanPost(
  session: LocalProjectSession,
  req: Request,
  {
    credentials = sharedStoreCredentialStore(),
    plans = uploadPlanRegistry,
    appStoreApiRoot = APP_STORE_CONNECT_API_ROOT,
  }: UploadRouteDependencies = {},
): Promise<Response> {
  const body = await requestBody(req);
  if (body instanceof Response) return body;
  const result = await plan(session, body, credentials, appStoreApiRoot);
  if (result instanceof Response) return result;
  plans.issue(session.projectId, result.planHash);
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}

/**
 * Runs `screenshots upload` for a plan the user reviewed. The hash must be one issued for this project
 * and must still match a plan recomputed under the mutation guard (for Apple, with the versions read
 * again); rendering then checks it renders the same revision. The CLI owns rendering, the store
 * calls, and its report.
 */
export async function handleUploadPost(
  session: LocalProjectSession,
  req: Request,
  expectedRevision: string,
  {
    credentials = sharedStoreCredentialStore(),
    plans = uploadPlanRegistry,
    runUploadCommand: runUpload = runUploadCommand,
    runAppStoreUploadCommand: runAppStoreUpload = runAppStoreUploadCommand,
    appStoreApiRoot = APP_STORE_CONNECT_API_ROOT,
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

  if (typeof body.planHash !== "string" || !plans.take(session.projectId, body.planHash)) {
    return jsonError(409, "Review the upload plan and confirm it before uploading", "plan-not-confirmed");
  }
  const current = await plan(session, body, credentials, appStoreApiRoot);
  if (current instanceof Response) return current;
  if (current.revision !== expectedRevision) {
    return projectRevisionConflictResponse(new ProjectRevisionConflictError(expectedRevision, current.revision))!;
  }
  if (current.planHash !== body.planHash) {
    return jsonError(409, "The project or the store changed after the plan was reviewed; review it again", "plan-stale");
  }
  let flags: Record<string, string>;
  let uploadEnv = env;
  if (current.store === "google") {
    const accountPath = await credentials.googleServiceAccountPath();
    if (!accountPath) return jsonError(409, "Google Play is not configured; add its service account key in Stores", "not-configured");
    flags = { "service-account": accountPath };
  } else {
    const apple = await credentials.appleCredentials();
    if (!apple || current.versions === null) {
      return jsonError(409, "App Store Connect is not configured; add its API key in Stores", "not-configured");
    }
    if (current.blocked) return jsonError(409, current.blocked, "version-unavailable");
    if (current.versions.some(({ selected }) => selected === null)) {
      return jsonError(409, "Pick the App Store version to upload to", "version-required");
    }
    flags = { "key-path": apple.keyPath, ...(current.version === null ? {} : { version: current.version }) };
    // Handed to the command only, never to process.env, which editor-started agents inherit.
    uploadEnv = { ...env, [APP_STORE_CONNECT_KEY_ID_ENV]: apple.keyId, [APP_STORE_CONNECT_ISSUER_ID_ENV]: apple.issuerId };
  }

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
  const dependencies = {
    env: uploadEnv,
    // Renders through this Next host, like /api/export, instead of spawning a second server.
    startWebServer: async () => ({ url: origin, exited: new Promise<Error>(() => undefined), stop: async () => undefined }),
    exportBundle: async (options: Parameters<typeof exportBundle>[0]) => {
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
    // Ignores SCREENSHOTS_BROWSER, so uploads render with the same pinned Chromium as /api/export.
    createRenderBrowserSession: () => createRenderBrowserSession(),
    warn: (message: string) => { warnings.push(message); },
  };
  try {
    const commandFlags = { project: session.projectPath, store: current.store, layout: current.layoutId, ...flags, json: "true" };
    // An Apple run that stops part-way still returns its per-set report, so it is a result, not an error.
    const { output, exitCode } = current.store === "google"
      ? { output: await runUpload(commandFlags, resolveStoreSpecsPath(), dependencies), exitCode: 0 }
      : await runAppStoreUpload(commandFlags, resolveStoreSpecsPath(), { ...dependencies, apiRoot: appStoreApiRoot });
    if (operationId) progressRegistry.finish(operationId, exitCode === 0 ? "ready" : "failed");
    return Response.json({ report: JSON.parse(output), warnings }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (operationId) progressRegistry.finish(operationId, "failed");
    if (error instanceof StalePlanError) return jsonError(409, error.message, "plan-stale");
    return projectRevisionConflictResponse(error) ?? jsonError(502, errorText(error));
  }
}
