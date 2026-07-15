// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertProjectFontsResolved } from "@screenshot-studio/core/model";
import {
  buildBundleEntries,
  parseStoreSpecs,
  validateBundleArtboards,
  type BundleFilters,
} from "@screenshot-studio/core/export";
import {
  readProjectSnapshot,
  resolveExistingProjectPath,
} from "@screenshot-studio/core/storage";
import { exportBundle, withStableProjectExport } from "@screenshot-studio/cli/export";
import { createRenderBrowserSession } from "@screenshot-studio/cli/render-driver";
import { resolveProjectPath } from "../../../lib/project-path.js";
import { resolveStoreSpecsPath } from "../../../lib/store-specs-path.js";
import { stageExportArtifact as stageExportArtifactDefault } from "../../../lib/export-artifacts.server.js";

interface ExportRequest {
  platform?: BundleFilters["platform"];
  device?: BundleFilters["device"];
  locale?: string;
}

export interface ExportRouteDependencies {
  createRenderBrowserSession?: typeof createRenderBrowserSession;
  exportBundle?: typeof exportBundle;
  stageExportArtifact?: typeof stageExportArtifactDefault;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withBrowserCleanupError(primary: unknown, cleanup: unknown): AggregateError {
  return new AggregateError(
    [primary, cleanup],
    `${errorText(primary)}; browser cleanup failed: ${errorText(cleanup)}`,
    { cause: primary },
  );
}

/**
 * UI export writes the same lead-size roots plus opt-in exact variants that the CLI writes, from the
 * same on-disk project JSON and shared headless render path, while reusing this Next host.
 */
export async function handleExportPost(
  req: Request,
  dependencies: ExportRouteDependencies = {},
): Promise<Response> {
  const createSession = dependencies.createRenderBrowserSession ?? createRenderBrowserSession;
  const exportBundleOutputs = dependencies.exportBundle ?? exportBundle;
  const stageExportArtifact = dependencies.stageExportArtifact ?? stageExportArtifactDefault;
  const projectPath = resolveProjectPath();
  // Missing/invalid JSON coalesces to an empty body, meaning an unfiltered export.
  const rawBody: unknown = await req.json().catch(() => ({}));
  const body = typeof rawBody === "object" && rawBody !== null && !Array.isArray(rawBody)
    ? rawBody as ExportRequest
    : {};
  const filters: BundleFilters = { platform: body.platform, device: body.device, locale: body.locale };

  // Validate before launching a browser so bad input fails fast.
  let specs: ReturnType<typeof parseStoreSpecs>;
  try {
    const project = (await readProjectSnapshot(
      await resolveExistingProjectPath(projectPath),
    )).project;
    assertProjectFontsResolved(project);
    specs = parseStoreSpecs(JSON.parse(await readFile(resolveStoreSpecsPath(), "utf8")));
    validateBundleArtboards(buildBundleEntries(project, specs, filters));
  } catch (error) {
    return Response.json({ error: errorText(error) }, { status: 422 });
  }

  const baseUrl = new URL(req.url).origin;
  let session: Awaited<ReturnType<typeof createRenderBrowserSession>> | undefined;
  let result: Awaited<ReturnType<typeof stageExportArtifactDefault>> | undefined;
  let operationError: unknown;
  let hasOperationError = false;
  try {
    session = await createSession();
    result = await withStableProjectExport(projectPath, async (context) => {
      assertProjectFontsResolved(context.project);
      const entries = buildBundleEntries(context.project, specs, filters);
      validateBundleArtboards(entries);
      const outDir = join(dirname(context.projectPath), "export");
      const zipPath = await exportBundleOutputs({
        baseUrl,
        projectPath: context.projectPath,
        projectRevision: context.revision,
        outDir,
        entries,
        renderSession: session!,
        publicationGuard: context.publish,
      });
      // The bundle filename is reusable. Copy it into its private immutable artifact while the
      // stable project/export lease still prevents another export from replacing that pathname.
      return stageExportArtifact(zipPath, outDir);
    });
  } catch (error) {
    operationError = error;
    hasOperationError = true;
  }

  let cleanupError: unknown;
  let hasCleanupError = false;
  if (session) {
    try {
      await session.close();
    } catch (error) {
      cleanupError = error;
      hasCleanupError = true;
    }
  }

  if (hasOperationError || hasCleanupError) {
    const error = hasOperationError && hasCleanupError
      ? withBrowserCleanupError(operationError, cleanupError)
      : hasOperationError ? operationError : cleanupError;
    return Response.json({ error: errorText(error) }, { status: 500 });
  }

  return Response.json(result!, {
    status: 201,
    headers: { "cache-control": "no-store" },
  });
}
