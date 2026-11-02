// SPDX-License-Identifier: Apache-2.0
import { errorText } from "@screenshot-studio/core/storage";
import { sharedAgentConsentStore, type AgentConsentStore } from "@web/lib/agents/agent-consent.server.js";
import { agentAdapter } from "@web/lib/agents/agent-adapters.server.js";
import { AGENT_DEFINITIONS, type AgentDefinition } from "@web/lib/agents/agents.server.js";
import { jsonError } from "@web/lib/api-error-response.server.js";
import { isRecord } from "@web/lib/json-guards.js";

/** Grants or revokes consent for one `at-own-risk` agent; every other level has nothing to consent to. */
export async function handleAgentConsentPost(
  req: Request,
  { consent = sharedAgentConsentStore(), definitions = AGENT_DEFINITIONS }: {
    consent?: AgentConsentStore;
    definitions?: readonly AgentDefinition[];
  } = {},
): Promise<Response> {
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body) || typeof body.agentId !== "string" || (body.action !== "grant" && body.action !== "revoke")) {
    return jsonError(400, "request body must be a JSON object with an agentId and an action of grant or revoke");
  }
  const definition = definitions.find(({ id }) => id === body.agentId);
  if (!definition) return jsonError(404, `Unknown agent: ${body.agentId}`, "unknown-agent");
  if (definition.policy.level !== "at-own-risk") {
    return jsonError(409, `${definition.name} does not need consent`, "consent-not-applicable");
  }
  // Consent for an agent the editor cannot run would outlive an adapter added later without a new policy check.
  if (body.action === "grant" && !agentAdapter(definition.id)) {
    return jsonError(409, `${definition.name} cannot run from the editor yet`, "no-adapter");
  }
  try {
    if (body.action === "grant") await consent.grant(definition);
    else await consent.revoke(definition.id);
  } catch (error) {
    return jsonError(500, errorText(error));
  }
  return Response.json({ agentId: definition.id, consented: body.action === "grant" }, { headers: { "cache-control": "no-store" } });
}
