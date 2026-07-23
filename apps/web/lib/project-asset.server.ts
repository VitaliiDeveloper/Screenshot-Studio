// SPDX-License-Identifier: Apache-2.0
import { readFile, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

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
};

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
    return Response.json({ error: "path outside project" }, { status: 400 });
  }
  let baseDir: string;
  try {
    baseDir = dirname(await realpath(resolve(projectPath)));
  } catch {
    return Response.json({ error: "project not found" }, { status: 404 });
  }
  const target = resolve(join(baseDir, relativePath));
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
