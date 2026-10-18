// SPDX-License-Identifier: Apache-2.0
import { dirname } from "node:path";
import { errorText } from "@screenshot-studio/core/storage";
import { jsonError } from "@web/lib/api-error-response.server.js";
import {
  AgentRunError,
  keepAgentOutcome,
  pendingAgentOutcome,
  undoAgentOutcome,
} from "@web/lib/agents/agent-session.server.js";
import { isRecord } from "@web/lib/json-guards.js";

const NO_STORE = { "cache-control": "no-store" };

/** The last accepted run that can still be undone, or null (mockup 7b: Keep / Undo run). */
export async function handleAgentOutcomeGet(projectPath: string): Promise<Response> {
  return Response.json({ outcome: await pendingAgentOutcome(dirname(projectPath)) }, { headers: NO_STORE });
}

/** `keep` drops the snapshot; `undo` restores it as one project write and the editor must reload. */
export async function handleAgentOutcomePost(projectPath: string, req: Request): Promise<Response> {
  const body: unknown = await req.json().catch(() => null);
  const action = isRecord(body) ? body.action : undefined;
  if (action !== "keep" && action !== "undo") {
    return jsonError(400, 'request body must be a JSON object with action "keep" or "undo"');
  }
  const projectDir = dirname(projectPath);
  try {
    if (action === "keep") {
      return (await keepAgentOutcome(projectDir))
        ? new Response(null, { status: 204, headers: NO_STORE })
        : jsonError(404, "No agent run to keep in this project", "no-outcome");
    }
    const outcome = await undoAgentOutcome(projectDir);
    return Response.json({ restored: true, outcome }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof AgentRunError) return jsonError(error.status, error.message, error.code);
    return jsonError(500, errorText(error));
  }
}
