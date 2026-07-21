// SPDX-License-Identifier: Apache-2.0
import { handleStoreSpecsGet } from "@web/app/api/store-specs/handler.js";

/**
 * Serves parsed store-specs.json to the editor client so the Inspector can list target presets
 * without duplicating the sizes into the client bundle. Same data the CLI/export path reads.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return handleStoreSpecsGet();
}
