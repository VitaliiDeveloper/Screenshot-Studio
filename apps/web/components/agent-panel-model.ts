// SPDX-License-Identifier: Apache-2.0
import type { StoreSpecs } from "@screenshot-studio/core/export";
import type { Project } from "@screenshot-studio/core/model";
import { attachmentProblem, SNIFF_BYTES } from "@web/lib/agents/agent-attachments";
import type { AgentStatus } from "@web/lib/agents/agent-registry.server";
import type { AgentEvent, AgentOtherFiles, AgentStep } from "@web/lib/agents/agent-session.server";
import { compactScreenSizeLabel } from "@web/lib/panel-helpers";

export type AgentResult = Extract<AgentEvent, { type: "result" }>;
export type AgentDone = Extract<AgentEvent, { type: "done" }>;

/** An image sent with one request. The file stays in editor memory so Retry can send it again. */
export interface AgentTurnAttachment {
  file: File;
  /** Object URL for the thumbnail; freed with the turn. */
  url: string;
}

/** One request and the run it started. Chat history is editor memory, never project content. */
export interface AgentTurn {
  id: number;
  agentName: string;
  message: string;
  attachments: AgentTurnAttachment[];
  text: string[];
  steps: AgentStep[];
  /** The last shell command the agent ran. */
  command: string | null;
  /** A run error event, or the server's refusal to start the run. */
  error: { code: string; message: string; resets: string | null } | null;
  result: AgentResult | null;
  done: AgentDone | null;
  stopped: boolean;
  /** Stop undid the run's changes, so the project is back at its pre-run snapshot. */
  restored: boolean;
}

export function createAgentTurn(
  id: number,
  agentName: string,
  message: string,
  attachments: AgentTurnAttachment[] = [],
): AgentTurn {
  return {
    id, agentName, message, attachments, text: [], steps: [], command: null,
    error: null, result: null, done: null, stopped: false, restored: false,
  };
}

/** Why a file cannot be attached (the server decides again from the same bytes), or null. */
export async function attachmentFileProblem(file: Blob): Promise<string | null> {
  return attachmentProblem(file.size, new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer()));
}

export function applyAgentEvent(turn: AgentTurn, event: AgentEvent): AgentTurn {
  switch (event.type) {
    case "text":
      return { ...turn, text: [...turn.text, event.text] };
    case "tool-use":
      return event.command ? { ...turn, command: event.command } : turn;
    case "progress":
      return { ...turn, steps: event.steps };
    case "error":
      return { ...turn, error: { code: event.code, message: event.message, resets: event.resets } };
    case "result":
      return { ...turn, result: event };
    case "done":
      return { ...turn, done: event };
  }
}

/** Splits the session route's SSE body into events; keep-alive comments and broken frames are skipped. */
export function createAgentEventParser(): (chunk: string) => AgentEvent[] {
  let buffer = "";
  return (chunk) => {
    buffer += chunk;
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    return frames.flatMap((frame) => frame.split("\n").flatMap((line) => {
      if (!line.startsWith("data: ")) return [];
      try {
        return [JSON.parse(line.slice(6)) as AgentEvent];
      } catch {
        return [];
      }
    }));
  };
}

export function turnActivity(turn: AgentTurn): string {
  if (turn.stopped) return "Stopping";
  return turn.command && /(^|\s)screenshots\s/.test(turn.command) ? "Changing the project" : "Thinking";
}

/** `Running · step 3 of 5`, or just `Running` before the agent shares a plan. */
export function turnProgressLabel(turn: AgentTurn): string {
  const total = turn.steps.length;
  if (total === 0) return "Running";
  const current = turn.steps.findIndex((step) => step.status === "in_progress");
  const completed = turn.steps.filter((step) => step.status === "completed").length;
  return `Running · step ${current >= 0 ? current + 1 : Math.min(completed + 1, total)} of ${total}`;
}

export type TurnOutcome =
  | { kind: "limit"; resets: string | null; unchanged: boolean }
  | { kind: "rejected"; reason: string }
  | { kind: "stopped"; restored: boolean }
  | { kind: "error"; message: string }
  | { kind: "changed"; count: number }
  | { kind: "unchanged" };

/** How a finished turn ended (mockup 7c); null while it still runs. */
export function turnOutcome(turn: AgentTurn): TurnOutcome | null {
  if (!turn.done) return null;
  const { error, result } = turn;
  if (error?.code === "usage-limit") return { kind: "limit", resets: error.resets, unchanged: result?.changed === false };
  if (result?.status === "rejected") return { kind: "rejected", reason: result.reason ?? "The project failed schema validation." };
  if (turn.done?.status === "cancelled") return { kind: "stopped", restored: turn.restored || result?.changed !== true };
  if (error) return { kind: "error", message: error.message };
  if (result?.changed) return { kind: "changed", count: result.changedScreens.length };
  return { kind: "unchanged" };
}

/** True when a verdict must mention other files: some changed, or the folder could not be compared. */
export function hasOtherFiles(otherFiles: AgentOtherFiles | null): boolean {
  return otherFiles === null || otherFiles.count > 0;
}

export type AgentNotice =
  | { kind: "loading" }
  | { kind: "no-agent" }
  | {
    kind: "not-signed-in" | "wrong-auth-mode" | "unsupported-version" | "not-installed" | "unavailable" | "no-adapter"
      | "consent-required";
    agent: AgentStatus;
  };

/** True once the agent's policy lets it run: `at-own-risk` needs stored consent, `unavailable` never. */
export function policyAllowsRun(agent: AgentStatus): boolean {
  return agent.policy.level === "supported" || (agent.policy.level === "at-own-risk" && agent.consented === true);
}

/** Whether a message to this agent can be sent; the server enforces the same policy again. */
export function agentCanRun(agent: AgentStatus | undefined): agent is AgentStatus {
  return agent !== undefined && agent.state === "ready" && policyAllowsRun(agent);
}

const POLICY_LEVEL_LABELS = { supported: "Supported", "at-own-risk": "At your own risk", unavailable: "Unavailable" } as const;

export function policyLevelLabel(agent: AgentStatus): string {
  return POLICY_LEVEL_LABELS[agent.policy.level];
}

/** Why the selected agent cannot run (mockup 7c); null when it is ready. */
export function agentNotice(agents: AgentStatus[] | null, selected: AgentStatus | undefined): AgentNotice | null {
  if (agents === null) return { kind: "loading" };
  // Agents that are never probed report `installed: null`, which does not count as installed.
  if (!agents.some((agent) => agent.installed === true)) return { kind: "no-agent" };
  if (!selected) return null;
  if (selected.state === "unavailable" || selected.state === "no-adapter") return { kind: selected.state, agent: selected };
  // The warning comes before every readiness notice: consent is the first thing an at-own-risk agent needs.
  if (selected.policy.level === "at-own-risk" && selected.consented !== true) return { kind: "consent-required", agent: selected };
  return selected.state === "ready" ? null : { kind: selected.state, agent: selected };
}

/** The meta line of an agent in the picker (mockup 7d), e.g. `Signed in · subscription · v2.1.296`. */
export function agentStateLabel(agent: AgentStatus): string {
  switch (agent.state) {
    case "ready":
      return ["Signed in", "subscription", agent.version ? `v${agent.version}` : null].filter(Boolean).join(" · ");
    case "not-installed":
      return "Not installed";
    case "not-signed-in":
      return "Not signed in";
    case "wrong-auth-mode":
      return "Signed in with an API key";
    case "unsupported-version":
      return agent.minVersion ? `Needs v${agent.minVersion} or later` : "Unsupported version";
    case "unavailable":
      return "Unavailable";
    case "no-adapter":
      return "Not supported in the editor yet";
  }
}

/** The agent a fresh panel selects: the current one while it exists, else the first ready one. */
export function defaultAgentId(agents: AgentStatus[], current: string | null): string | null {
  if (current && agents.some((agent) => agent.id === current)) return current;
  return (agents.find((agent) => agent.state === "ready" && policyAllowsRun(agent))
    ?? agents.find((agent) => agent.installed === true)
    ?? agents.find((agent) => agent.policy.level === "supported"))?.id ?? null;
}

/** The agent picker's options: name, an at-own-risk policy, and state; the trigger shows the name. */
export function agentOptions(agents: readonly AgentStatus[]): { value: string; label: string; triggerLabel: string }[] {
  return agents.map((agent) => ({
    value: agent.id,
    label: [agent.name, agent.policy.level === "at-own-risk" ? policyLevelLabel(agent) : null, agentStateLabel(agent)]
      .filter(Boolean).join(" · "),
    triggerLabel: agent.name,
  }));
}

/** The run's model and effort: the user's pick while the agent offers it, else the agent's default. */
export function agentRunChoices(
  agent: AgentStatus | undefined,
  model: string | null,
  effort: string | null,
): { model: string | null; effort: string | null } {
  if (!agent) return { model: null, effort: null };
  return {
    model: agent.models.some(({ id }) => id === model) ? model : agent.models[0]?.id ?? null,
    effort: agent.efforts.some(({ id }) => id === effort) ? effort : agent.defaultEffort,
  };
}

export interface ChangedScreenRow {
  id: string;
  name: string;
  /** Locale and size; null for a screen the run removed. */
  detail: string | null;
}

/** The review list (mockup 7b): each changed screen with its locale and size, removed ones last. */
export function changedScreenRows(project: Project, screenIds: readonly string[], specs: StoreSpecs): ChangedScreenRow[] {
  const screens = new Map(project.layouts.flatMap((layout) => layout.screens.map((screen) => [screen.id, screen] as const)));
  const rows = screenIds.map((id): ChangedScreenRow => {
    const screen = screens.get(id);
    return screen
      ? { id, name: screen.name, detail: `${screen.locale.toUpperCase()} · ${compactScreenSizeLabel(screen, specs)}` }
      : { id, name: "Removed screen", detail: null };
  });
  return [...rows.filter((row) => row.detail), ...rows.filter((row) => !row.detail)];
}
