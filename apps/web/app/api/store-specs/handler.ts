// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import { parseStoreSpecs } from "@screenshot-studio/core/export";
import { errorCode, errorText } from "@screenshot-studio/core/storage";
import { resolveStoreSpecsPath } from "@web/lib/store-specs-path.js";
import { jsonError } from "@web/lib/api-error-response.server.js";

export interface StoreSpecsRouteDependencies {
  resolvePath?: () => string;
  readTextFile?: (path: string) => Promise<string>;
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
      return jsonError(404, "Store specs file was not found");
    }
    return jsonError(500, errorText(error));
  }

  try {
    return Response.json(parseStoreSpecs(JSON.parse(source)));
  } catch (error) {
    return jsonError(422, errorText(error));
  }
}
