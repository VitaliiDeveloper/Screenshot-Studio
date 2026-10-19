// SPDX-License-Identifier: Apache-2.0
import { listAgentStatuses, type AgentRegistryOptions } from "@web/lib/agents/agent-registry.server.js";

export async function handleAgentsGet(options: AgentRegistryOptions = {}): Promise<Response> {
  return Response.json(
    { agents: await listAgentStatuses(options) },
    { headers: { "cache-control": "no-store" } },
  );
}
