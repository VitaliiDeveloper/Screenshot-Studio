// SPDX-License-Identifier: Apache-2.0
import { handleAgentsGet } from "./handler.js";

/**
 * Lists the agent CLIs of the first release with their install, version, sign-in state and policy.
 * Detection only runs the CLIs' own version and status commands; credential files are never read.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return handleAgentsGet();
}
