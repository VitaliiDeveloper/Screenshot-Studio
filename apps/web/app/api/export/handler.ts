// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { assertProjectFontsResolved, getLayout } from "@screenshot-studio/core/model";
import {
  buildBundleEntries,
  bundlePreflightWarnings,
  parseExportProfile,
  parseStoreSpecs,
  validateBundleArtboards,
  type BundleEntry,
  type BundleFilters,
} from "@screenshot-studio/core/export";
import {
  ProjectRevisionConflictError,
  errorText,
  readProjectSnapshot,
  resolveExistingProjectPath,
} from "@screenshot-studio/core/storage";
import {
  exportBundle,
  withStableProjectExport,
  type ExportBundleRendering,
} from "@screenshot-studio/cli/export";
import { createRenderBrowserSession } from "@screenshot-studio/cli/render-driver";
import { resolveStoreSpecsPath } from "@web/lib/store-specs-path.js";
import { stageExportArtifact as stageExportArtifactDefault } from "@web/lib/export-artifacts.server.js";
import { EXPORT_OPERATION_ID_PATTERN } from "@web/lib/export-progress.js";
import {
  parseExportSelection,
  selectExportEntries,
  type ExportFileFailure,
  type ExportSelection,
} from "@web/lib/export-selection.js";
import { exportProgressRegistry, type ExportProgressRegistry } from "@web/lib/export-progress.server.js";
import { projectRevisionConflictResponse } from "@web/lib/session/project-request-fence.server.js";
import { jsonError } from "@web/lib/api-error-response.server.js";

interface ExportRequest {
  layoutId?: string;
  platform?: BundleFilters["platform"];
  device?: BundleFilters["device"];
  locale?: string;
  sizes?: unknown;
  locales?: unknown;
  profile?: string;
  operationId?: string;
}


export interface ExportRouteDependencies {
  createRenderBrowserSession?: typeof createRenderBrowserSession;
  exportBundle?: typeof exportBundle;
  stageExportArtifact?: typeof stageExportArtifactDefault;
  progressRegistry?: Pick<ExportProgressRegistry, "begin" | "update" | "finish" | "stopRequested">;
}

function withExportCleanupErrors(
  primary: unknown,
  cleanupFailures: Array<{ label: string; error: unknown }>,
): AggregateError {
  return new AggregateError(
    [primary, ...cleanupFailures.map(({ error }) => error)],
    [
      errorText(primary),
      ...cleanupFailures.map(({ label, error }) => `${label} cleanup failed: ${errorText(error)}`),
    ].join("; "),
    { cause: primary },
  );
}

/**
 * UI export renders the same lead-size roots plus opt-in exact variants that the CLI writes, from the
 * same on-disk project JSON and shared headless render path. Unlike the CLI, its published result is
 * a browser download, so unpacked outputs live only in a request-owned staging directory.
 */
export async function handleExportPost(
  projectPath: string,
  req: Request,
  dependencies: ExportRouteDependencies = {},
  expectedRevision?: string,
): Promise<Response> {
  const createSession = dependencies.createRenderBrowserSession ?? createRenderBrowserSession;
  const exportBundleOutputs = dependencies.exportBundle ?? exportBundle;
  const stageExportArtifact = dependencies.stageExportArtifact ?? stageExportArtifactDefault;
  const progressRegistry = dependencies.progressRegistry ?? exportProgressRegistry;
  // Missing/invalid JSON coalesces to an empty body, meaning an unfiltered export.
  const rawBody: unknown = await req.json().catch(() => ({}));
  const body = typeof rawBody === "object" && rawBody !== null && !Array.isArray(rawBody)
    ? rawBody as ExportRequest
    : {};
  if (body.operationId !== undefined && (
    typeof body.operationId !== "string" || !EXPORT_OPERATION_ID_PATTERN.test(body.operationId)
  )) {
    return jsonError(422, "Invalid export operation id");
  }
  const operationId = body.operationId;
  const filters: BundleFilters = { platform: body.platform, device: body.device, locale: body.locale };
  let profile: ReturnType<typeof parseExportProfile>;
  let selection: ExportSelection;
  try {
    profile = parseExportProfile(body.profile);
    selection = parseExportSelection(body);
  } catch (error) {
    return jsonError(422, errorText(error));
  }
  const selectedEntries = (entries: BundleEntry[]): BundleEntry[] => {
    const selected = selectExportEntries(entries, selection);
    if (selected.length === 0) throw new Error("No files match the export selection");
    return selected;
  };

  // Validate before launching a browser so bad input fails fast.
  let specs: ReturnType<typeof parseStoreSpecs>;
  let layoutId: string;
  let warnings: ReturnType<typeof bundlePreflightWarnings>;
  let entryCount = 0;
  try {
    const snapshot = await readProjectSnapshot(
      await resolveExistingProjectPath(projectPath),
    );
    if (expectedRevision !== undefined && expectedRevision !== snapshot.revision) {
      return projectRevisionConflictResponse(new ProjectRevisionConflictError(
        expectedRevision,
        snapshot.revision,
      ))!;
    }
    const project = snapshot.project;
    layoutId = getLayout(project, body.layoutId ?? project.preferredExportLayoutId).id;
    assertProjectFontsResolved(project, layoutId);
    specs = parseStoreSpecs(JSON.parse(await readFile(resolveStoreSpecsPath(), "utf8")));
    const entries = selectedEntries(buildBundleEntries(project, layoutId, specs, filters));
    validateBundleArtboards(entries, specs);
    entryCount = entries.length;
    warnings = bundlePreflightWarnings(entries, specs);
  } catch (error) {
    return jsonError(422, errorText(error));
  }

  if (operationId) {
    try {
      progressRegistry.begin(operationId, entryCount);
    } catch (error) {
      return jsonError(409, errorText(error));
    }
  }

  const baseUrl = new URL(req.url).origin;
  let session: Awaited<ReturnType<typeof createRenderBrowserSession>> | undefined;
  let result: Awaited<ReturnType<typeof stageExportArtifactDefault>> | undefined;
  let stagingDir: string | undefined;
  let operationError: unknown;
  let hasOperationError = false;
  const failures: ExportFileFailure[] = [];
  let rendering: ExportBundleRendering | undefined;
  try {
    stagingDir = await mkdtemp(join(tmpdir(), "screenshot-studio-web-export-"));
    session = await createSession();
    result = await withStableProjectExport(projectPath, async (context) => {
      if (expectedRevision !== undefined && expectedRevision !== context.revision) {
        throw new ProjectRevisionConflictError(expectedRevision, context.revision);
      }
      getLayout(context.project, layoutId);
      assertProjectFontsResolved(context.project, layoutId);
      const entries = selectedEntries(buildBundleEntries(context.project, layoutId, specs, filters));
      validateBundleArtboards(entries, specs);
      entryCount = entries.length;
      // Return warnings for the exact revision being rendered, not for the earlier fail-fast
      // snapshot. This also keeps un-fenced API callers consistent if the project changes between
      // preflight and the stable export lease.
      warnings = bundlePreflightWarnings(entries, specs);
      const zipPath = await exportBundleOutputs({
        baseUrl,
        projectPath: context.projectPath,
        projectRevision: context.revision,
        layoutId,
        outDir: stagingDir!,
        entries,
        renderSession: session!,
        publicationGuard: context.publish,
        onProgress: operationId
          ? (progress) => progressRegistry.update(
            operationId,
            progress.phase,
            progress.completed,
            progress.total,
          )
          : undefined,
        onEntryError: (entry, message) => {
          failures.push({ screenId: entry.screen.id, relativePath: entry.relativePath, message });
        },
        shouldStop: operationId ? () => progressRegistry.stopRequested(operationId) : undefined,
        onRendered: (result) => { rendering = result; },
        profile,
        project: context.project,
      }).catch((error: unknown) => {
        // Stopped before any file rendered: a result with nothing to download, not a failure.
        if (rendering?.stopped && rendering.written === 0) return null;
        throw error;
      });
      if (zipPath === null) return undefined;
      // The bundle filename is reusable. Copy it into its private immutable artifact while the
      // stable project/export lease still prevents another export from replacing that pathname.
      if (operationId) progressRegistry.update(operationId, "finalizing", entryCount, entryCount);
      return stageExportArtifact(zipPath, basename(zipPath));
    });
  } catch (error) {
    operationError = error;
    hasOperationError = true;
  }

  const cleanupFailures: Array<{ label: string; error: unknown }> = [];
  if (session) {
    try {
      await session.close();
    } catch (error) {
      cleanupFailures.push({ label: "browser", error });
    }
  }
  if (stagingDir) {
    try {
      await rm(stagingDir, { recursive: true, force: true });
    } catch (error) {
      cleanupFailures.push({ label: "export staging", error });
    }
  }

  if (hasOperationError || cleanupFailures.length > 0) {
    if (operationId) progressRegistry.finish(operationId, "failed");
    if (hasOperationError && cleanupFailures.length === 0) {
      const revisionConflict = projectRevisionConflictResponse(operationError);
      if (revisionConflict) return revisionConflict;
    }
    const error = hasOperationError && cleanupFailures.length > 0
      ? withExportCleanupErrors(operationError, cleanupFailures)
      : hasOperationError
        ? operationError
        : new Error(
          cleanupFailures.map(({ label, error: cleanupError }) => (
            `${label} cleanup failed: ${errorText(cleanupError)}`
          )).join("; "),
          { cause: cleanupFailures[0]?.error },
        );
    return jsonError(500, errorText(error), undefined, failures.length > 0 ? { failures } : {});
  }

  if (operationId) progressRegistry.finish(operationId, "ready");
  const written = rendering?.written ?? entryCount - failures.length;
  const stopped = rendering?.stopped ?? false;

  return Response.json({ ...result, warnings, written, total: entryCount, failures, stopped }, {
    status: 201,
    headers: { "cache-control": "no-store" },
  });
}
