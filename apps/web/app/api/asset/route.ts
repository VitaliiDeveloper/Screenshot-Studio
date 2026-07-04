import { readFile } from "node:fs/promises";
import { dirname, join, resolve, relative, isAbsolute, extname } from "node:path";
import { resolveProjectPath } from "../../../lib/project-path.js";

/**
 * Serves the project's asset files over HTTP so /editor and the headless /render resolve the SAME
 * URL for a given screenshot assetUrl — parity by construction, and same-origin so images never
 * taint the canvas (spec §3). Dev-only, local, self-hosted (same model as /render, /api/project).
 * `project` (optional) lets the headless render pass its own project path; else PROJECT_PATH.
 */
export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const rel = url.searchParams.get("path");
  if (!rel) return Response.json({ error: "missing path" }, { status: 400 });

  const projectPath = url.searchParams.get("project") ?? resolveProjectPath();
  const baseDir = dirname(resolve(projectPath));
  const target = resolve(join(baseDir, rel));

  // Traversal guard: the resolved target must stay within the base dir.
  const within = relative(baseDir, target);
  if (within.startsWith("..") || isAbsolute(within)) {
    return Response.json({ error: "path outside project" }, { status: 400 });
  }

  try {
    const bytes = await readFile(target);
    const type = CONTENT_TYPES[extname(target).toLowerCase()] ?? "application/octet-stream";
    return new Response(bytes, { status: 200, headers: { "content-type": type } });
  } catch {
    return Response.json({ error: "not found" }, { status: 404 });
  }
}
