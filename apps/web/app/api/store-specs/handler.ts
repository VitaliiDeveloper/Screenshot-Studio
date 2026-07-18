// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import { parseStoreSpecs } from "@screenshot-studio/core/export";
import { resolveStoreSpecsPath } from "@web/lib/store-specs-path.js";

export interface StoreSpecsRouteDependencies {
  resolvePath?: () => string;
  readTextFile?: (path: string) => Promise<string>;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

export async function handleStoreSpecsGet(
  dependencies: StoreSpecsRouteDependencies = {},
): Promise<Response> {
  const resolvePath = dependencies.resolvePath ?? resolveStoreSpecsPath;
  const readTextFile = dependencies.readTextFile ?? ((path) => readFile(path, "utf8"));
  let source: string;
  try {
    source = await readTextFile(resolvePath());
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return Response.json({ error: "Store specs file was not found" }, { status: 404 });
    }
    return Response.json({ error: errorText(error) }, { status: 500 });
  }

  try {
    return Response.json(parseStoreSpecs(JSON.parse(source)));
  } catch (error) {
    return Response.json({ error: errorText(error) }, { status: 422 });
  }
}
