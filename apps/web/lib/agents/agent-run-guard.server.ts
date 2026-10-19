// SPDX-License-Identifier: Apache-2.0
import { dirname } from "node:path";
import { jsonError } from "@web/lib/api-error-response.server.js";
import { beginEditorWrite } from "./agent-session.server.js";

/**
 * While an agent edits a project through the `screenshots` CLI, the editor's own writes are refused
 * instead of racing it (docs/project-mutation-locking.md). The admission is held for the whole
 * operation, so a write that started before a run finishes before that run takes its snapshot. The
 * CLI child still takes the regular mutation lock for each of its writes.
 */
export async function withAgentRunFence(
  projectPath: string,
  operation: () => Promise<Response>,
): Promise<Response> {
  const release = await beginEditorWrite(dirname(projectPath));
  if (!release) {
    return jsonError(423, "An agent is editing this project; wait for the run to finish or stop it", "agent-running");
  }
  try {
    return await operation();
  } finally {
    release();
  }
}
