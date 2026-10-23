// SPDX-License-Identifier: Apache-2.0
import { sharedAgentConsentStore, type AgentConsentStore } from "@web/lib/agents/agent-consent.server.js";
import { listAgentStatuses, type AgentRegistryOptions } from "@web/lib/agents/agent-registry.server.js";
import { AGENT_DEFINITIONS } from "@web/lib/agents/agents.server.js";

export interface AgentsDependencies extends AgentRegistryOptions {
  consent?: AgentConsentStore;
}

export async function handleAgentsGet({ consent = sharedAgentConsentStore(), ...options }: AgentsDependencies = {}): Promise<Response> {
  // Consent is read outside the registry's short-lived cache, so a grant or revoke shows at once.
  const agents = await Promise.all((await listAgentStatuses(options)).map(async (status) => {
    const definition = AGENT_DEFINITIONS.find(({ id }) => id === status.id);
    return definition?.policy.level === "at-own-risk"
      ? { ...status, consented: await consent.isGranted(definition) }
      : status;
  }));
  return Response.json({ agents }, { headers: { "cache-control": "no-store" } });
}
