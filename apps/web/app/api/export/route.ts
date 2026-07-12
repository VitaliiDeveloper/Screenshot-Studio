// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertProjectFontsResolved, parseProjectJson } from "@screenshot-studio/core/model";
import {
  buildBundleEntries,
  parseStoreSpecs,
  validateBundleArtboards,
  type BundleFilters,
} from "@screenshot-studio/core/export";
import { exportBundle } from "@screenshot-studio/cli/export";
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

export async function POST(req: Request): Promise<Response> {
  const projectPath = resolveProjectPath();
  // Missing/invalid JSON coalesces to an empty body → an unfiltered ("all") export.
  const body = (await req.json().catch(() => ({}))) as ExportRequest;
  const filters: BundleFilters = { platform: body.platform, device: body.device, locale: body.locale };

  // Load + validate + build + artboard-check BEFORE launching a browser (fail fast → 422).
  let entries;
  try {
    const project = parseProjectJson(await readFile(projectPath, "utf8"));
    assertProjectFontsResolved(project);
    const specs = parseStoreSpecs(JSON.parse(await readFile(resolveStoreSpecsPath(), "utf8")));
    entries = buildBundleEntries(project, specs, filters);
    validateBundleArtboards(entries);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 422 });
  }

  const outDir = join(dirname(projectPath), "export");
  const baseUrl = new URL(req.url).origin;
  // Launch inside the try so a chromium-launch failure returns the same structured 500 as a
  // render failure; `session?.close()` in finally tolerates a launch that never resolved.
  let session: Awaited<ReturnType<typeof createRenderBrowserSession>> | undefined;
  try {
    session = await createRenderBrowserSession();
    const zipPath = await exportBundle({ baseUrl, projectPath, outDir, entries, renderSession: session });
    const zip = await readFile(zipPath);
    return new Response(new Uint8Array(zip), {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": 'attachment; filename="app-store-screenshots-bundle.zip"',
        "x-export-dir": outDir,
      },
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    await session?.close();
  }
}
