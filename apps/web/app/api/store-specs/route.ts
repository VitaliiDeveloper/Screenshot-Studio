import { readFile } from "node:fs/promises";
import { parseStoreSpecs } from "@screenshot-studio/core/export";
import { resolveStoreSpecsPath } from "../../../lib/store-specs-path.js";

/**
 * Serves parsed store-specs.json to the editor client so the Inspector can list target presets
 * without duplicating the sizes into the client bundle. Same data the CLI/export path reads.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const specs = parseStoreSpecs(JSON.parse(await readFile(resolveStoreSpecsPath(), "utf8")));
    return Response.json(specs);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
