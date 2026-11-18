// SPDX-License-Identifier: Apache-2.0
import { claudeCodeAdapter } from "./claude-code-adapter.server.js";
import { codexAdapter } from "./codex-adapter.server.js";
import { copilotAdapter } from "./copilot-adapter.server.js";
import { opencodeAdapter } from "./opencode-adapter.server.js";
import type { AgentAdapter } from "./agent-session.server.js";

const ADAPTERS: ReadonlyMap<string, AgentAdapter> = new Map(
  [claudeCodeAdapter, codexAdapter, copilotAdapter, opencodeAdapter].map((adapter) => [adapter.agentId, adapter]),
);

/** The adapter that runs an agent from the editor; undefined for agents that are only listed. */
export function agentAdapter(agentId: string): AgentAdapter | undefined {
  return ADAPTERS.get(agentId);
}
