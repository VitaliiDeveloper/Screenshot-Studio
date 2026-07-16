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

/**
 * UI export writes the same lead-size roots plus opt-in exact variants that the CLI writes, from the same
 * on-disk project JSON, through the same headless /render path — but reuses THIS Next host as the
 * render host (decision 4): one browser session, `baseUrl` = request origin, no spawned server.
 * All pre-render validation runs before the browser launches, so bad input fails fast as 422.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ExportRequest {
  platform?: BundleFilters["platform"];
  device?: BundleFilters["device"];
  locale?: string;
}

export interface ExportRouteDependencies {
  createRenderBrowserSession?: typeof createRenderBrowserSession;
  exportBundle?: typeof exportBundle;
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

export async function handleExportPost(
  req: Request,
  dependencies: ExportRouteDependencies = {},
): Promise<Response> {
  const createSession = dependencies.createRenderBrowserSession ?? createRenderBrowserSession;
  const exportBundleOutputs = dependencies.exportBundle ?? exportBundle;
  const projectPath = resolveProjectPath();
  // Missing/invalid JSON coalesces to an empty body → an unfiltered ("all") export.
  const body = (await req.json().catch(() => ({}))) as ExportRequest;
  const filters: BundleFilters = { platform: body.platform, device: body.device, locale: body.locale };

  // Load + validate + build + artboard-check BEFORE launching a browser (fail fast → 422).
  let specs: ReturnType<typeof parseStoreSpecs>;
  try {
    const project = (await readProjectSnapshot(
      await resolveExistingProjectPath(projectPath),
    )).project;
    assertProjectFontsResolved(project);
    specs = parseStoreSpecs(JSON.parse(await readFile(resolveStoreSpecsPath(), "utf8")));
    validateBundleArtboards(buildBundleEntries(project, specs, filters));
  } catch (err) {
    return Response.json({ error: errorText(err) }, { status: 422 });
  }

  const baseUrl = new URL(req.url).origin;
  // Launch inside the try so a chromium-launch failure returns the same structured 500 as a
  // render failure; an explicit close phase keeps cleanup errors structured without replacing the
  // original export failure or an already-prepared success response.
  let session: Awaited<ReturnType<typeof createRenderBrowserSession>> | undefined;
  let result: { zip: Buffer; outDir: string } | undefined;
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
      return { zip: await readFile(zipPath), outDir };
    });
  } catch (err) {
    operationError = err;
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

  return new Response(new Uint8Array(result!.zip), {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": 'attachment; filename="app-store-screenshots-bundle.zip"',
      "x-export-dir": result!.outDir,
    },
  });
}

export async function POST(req: Request): Promise<Response> {
  return handleExportPost(req);
}
