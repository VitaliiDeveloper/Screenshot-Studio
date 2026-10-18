// SPDX-License-Identifier: Apache-2.0
import { dirname } from "node:path";
import { jsonError } from "@web/lib/api-error-response.server.js";
import { agentRunActive } from "./agent-session.server.js";

/**
 * While an agent edits a project through the `screenshots` CLI, the editor's own writes are refused
 * instead of racing it (docs/project-mutation-locking.md). The CLI child still takes the regular
 * mutation lock for each write; this guard only fences the editor's HTTP writers.
 */
export async function agentRunBlockResponse(projectPath: string): Promise<Response | undefined> {
  if (!(await agentRunActive(dirname(projectPath)))) return undefined;
  return jsonError(423, "An agent is editing this project; wait for the run to finish or stop it", "agent-running");
}
