// SPDX-License-Identifier: Apache-2.0
import { readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve, relative, isAbsolute, extname, sep } from "node:path";
import { withActiveProjectSession } from "../../../lib/project-session.server.js";

/**
 * Serves the project's asset files over HTTP so /editor and the headless /render resolve the SAME
 * URL for a given screenshot assetUrl — parity by construction, and same-origin so images never
 * taint the canvas (spec §3). Dev-only, local, self-hosted (same model as /render, /api/project).
 * `project` (optional) lets the headless render pass its own project path; interactive requests use
 * the active project session.
 */
export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const rel = url.searchParams.get("path");
  if (!rel) return Response.json({ error: "missing path" }, { status: 400 });

  if (isAbsolute(rel)) return Response.json({ error: "path outside project" }, { status: 400 });

  const explicitProjectPath = url.searchParams.get("project");
  if (explicitProjectPath) return serveProjectAsset(explicitProjectPath, rel);
  return withActiveProjectSession(req, ({ projectPath }) => serveProjectAsset(projectPath, rel));
}

async function serveProjectAsset(projectPath: string, rel: string): Promise<Response> {
  let baseDir: string;
  try {
    baseDir = dirname(await realpath(resolve(projectPath)));
  } catch {
    return Response.json({ error: "project not found" }, { status: 404 });
  }
  const target = resolve(join(baseDir, rel));
  const lexical = relative(baseDir, target);
  if (lexical === ".." || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) {
    return Response.json({ error: "path outside project" }, { status: 400 });
  }

  try {
    const canonical = await realpath(target);
    const within = relative(baseDir, canonical);
    if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) {
      return Response.json({ error: "path outside project" }, { status: 400 });
    }
    const bytes = await readFile(canonical);
    const type = CONTENT_TYPES[extname(canonical).toLowerCase()] ?? "application/octet-stream";
    return new Response(bytes, { status: 200, headers: { "content-type": type } });
  } catch {
    return Response.json({ error: "not found" }, { status: 404 });
  }
}
