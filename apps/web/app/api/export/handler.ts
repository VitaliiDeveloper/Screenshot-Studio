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
  type BundleFilters,
} from "@screenshot-studio/core/export";
import {
  ProjectRevisionConflictError,
  readProjectSnapshot,
  resolveExistingProjectPath,
} from "@screenshot-studio/core/storage";
import { exportBundle, withStableProjectExport } from "@screenshot-studio/cli/export";
import { createRenderBrowserSession } from "@screenshot-studio/cli/render-driver";
import { resolveStoreSpecsPath } from "@web/lib/store-specs-path.js";
import { stageExportArtifact as stageExportArtifactDefault } from "@web/lib/export-artifacts.server.js";
import { projectRevisionConflictResponse } from "@web/lib/project-request-fence.server.js";

interface ExportRequest {
  layoutId?: string;
  platform?: BundleFilters["platform"];
  device?: BundleFilters["device"];
  locale?: string;
  profile?: string;
}

export interface ExportRouteDependencies {
  createRenderBrowserSession?: typeof createRenderBrowserSession;
  exportBundle?: typeof exportBundle;
  stageExportArtifact?: typeof stageExportArtifactDefault;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  // Missing/invalid JSON coalesces to an empty body, meaning an unfiltered export.
  const rawBody: unknown = await req.json().catch(() => ({}));
  const body = typeof rawBody === "object" && rawBody !== null && !Array.isArray(rawBody)
    ? rawBody as ExportRequest
    : {};
  const filters: BundleFilters = { platform: body.platform, device: body.device, locale: body.locale };
  let profile: ReturnType<typeof parseExportProfile>;
  try {
    profile = parseExportProfile(body.profile);
  } catch (error) {
    return Response.json({ error: errorText(error) }, { status: 422 });
  }

  // Validate before launching a browser so bad input fails fast.
  let specs: ReturnType<typeof parseStoreSpecs>;
  let layoutId: string;
  let warnings: ReturnType<typeof bundlePreflightWarnings>;
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
    const entries = buildBundleEntries(project, layoutId, specs, filters);
    validateBundleArtboards(entries);
    warnings = bundlePreflightWarnings(entries);
  } catch (error) {
    return Response.json({ error: errorText(error) }, { status: 422 });
  }

  const baseUrl = new URL(req.url).origin;
  let session: Awaited<ReturnType<typeof createRenderBrowserSession>> | undefined;
  let result: Awaited<ReturnType<typeof stageExportArtifactDefault>> | undefined;
  let stagingDir: string | undefined;
  let operationError: unknown;
  let hasOperationError = false;
  try {
    stagingDir = await mkdtemp(join(tmpdir(), "screenshot-studio-web-export-"));
    session = await createSession();
    result = await withStableProjectExport(projectPath, async (context) => {
      if (expectedRevision !== undefined && expectedRevision !== context.revision) {
        throw new ProjectRevisionConflictError(expectedRevision, context.revision);
      }
      getLayout(context.project, layoutId);
      assertProjectFontsResolved(context.project, layoutId);
      const entries = buildBundleEntries(context.project, layoutId, specs, filters);
      validateBundleArtboards(entries);
      // Return warnings for the exact revision being rendered, not for the earlier fail-fast
      // snapshot. This also keeps un-fenced API callers consistent if the project changes between
      // preflight and the stable export lease.
      warnings = bundlePreflightWarnings(entries);
      const zipPath = await exportBundleOutputs({
        baseUrl,
        projectPath: context.projectPath,
        projectRevision: context.revision,
        layoutId,
        outDir: stagingDir!,
        entries,
        renderSession: session!,
        publicationGuard: context.publish,
        profile,
        project: context.project,
      });
      // The bundle filename is reusable. Copy it into its private immutable artifact while the
      // stable project/export lease still prevents another export from replacing that pathname.
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
    return Response.json({ error: errorText(error) }, { status: 500 });
  }

  return Response.json({ ...result!, warnings }, {
    status: 201,
    headers: { "cache-control": "no-store" },
  });
}
