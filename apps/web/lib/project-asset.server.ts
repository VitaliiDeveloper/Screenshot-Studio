// SPDX-License-Identifier: Apache-2.0
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ProjectAssetExtension } from "@screenshot-studio/core/model";
import { jsonError } from "./api-error-response.server.js";

const ASSET_CACHE_CONTROL = "private, no-store";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
} satisfies Record<ProjectAssetExtension, string>;

export function withPrivateAssetPolicy(response: Response, varyByCookie: boolean): Response {
  response.headers.set("cache-control", ASSET_CACHE_CONTROL);
  if (varyByCookie) {
    const vary = response.headers.get("vary");
    if (!vary) response.headers.set("vary", "Cookie");
    else if (!vary.split(",").some((value) => value.trim().toLowerCase() === "cookie")) {
      response.headers.set("vary", `${vary}, Cookie`);
    }
  }
  return response;
}

export async function serveProjectAssetPath(
  projectPath: string,
  relativePath: string,
): Promise<Response> {
  if (isAbsolute(relativePath)) {
    return jsonError(400, "path outside project");
  }
  let baseDir: string;
  try {
    baseDir = dirname(await realpath(resolve(projectPath)));
  } catch {
    return jsonError(404, "project not found");
  }
  const target = resolve(join(baseDir, relativePath));
  const lexical = relative(baseDir, target);
  if (lexical === ".." || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) {
    return jsonError(400, "path outside project");
  }
  try {
    const canonical = await realpath(target);
    const within = relative(baseDir, canonical);
    if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) {
      return jsonError(400, "path outside project");
    }
    const type = CONTENT_TYPES[extname(canonical).toLowerCase()];
    if (!type || !(await stat(canonical)).isFile()) return jsonError(404, "not found");
    const bytes = await readFile(canonical);
    return new Response(bytes, { status: 200, headers: { "content-type": type } });
  } catch {
    return jsonError(404, "not found");
  }
}
