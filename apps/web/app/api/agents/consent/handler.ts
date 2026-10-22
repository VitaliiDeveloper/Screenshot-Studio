// SPDX-License-Identifier: Apache-2.0
import { sharedAgentConsentStore, type AgentConsentStore } from "@web/lib/agents/agent-consent.server.js";
import { AGENT_DEFINITIONS } from "@web/lib/agents/agents.server.js";
import { jsonError } from "@web/lib/api-error-response.server.js";
import { isRecord } from "@web/lib/json-guards.js";

/** Grants or revokes consent for one `at-own-risk` agent; every other level has nothing to consent to. */
export async function handleAgentConsentPost(
  req: Request,
  { consent = sharedAgentConsentStore() }: { consent?: AgentConsentStore } = {},
): Promise<Response> {
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body) || typeof body.agentId !== "string" || (body.action !== "grant" && body.action !== "revoke")) {
    return jsonError(400, "request body must be a JSON object with an agentId and an action of grant or revoke");
  }
  const definition = AGENT_DEFINITIONS.find(({ id }) => id === body.agentId);
  if (!definition) return jsonError(404, `Unknown agent: ${body.agentId}`, "unknown-agent");
  if (definition.policy.level !== "at-own-risk") {
    return jsonError(409, `${definition.name} does not need consent`, "consent-not-applicable");
  }
  if (body.action === "grant") await consent.grant(definition);
  else await consent.revoke(definition.id);
  return Response.json({ agentId: definition.id, consented: body.action === "grant" }, { headers: { "cache-control": "no-store" } });
}
