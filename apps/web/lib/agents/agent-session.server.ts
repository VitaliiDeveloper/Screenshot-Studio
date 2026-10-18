// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { resolveStoreSpecsPath } from "@web/lib/store-specs-path.js";
import { detectAgent } from "./agent-registry.server.js";
import {
  AGENT_DEFINITIONS,
  agentEnv,
  killProcessTree,
  spawnAgentProcess,
  type AgentDefinition,
} from "./agents.server.js";
import { claudeCodeAdapter } from "./claude-code-adapter.server.js";

export type AgentErrorCode = "usage-limit" | "not-authorized" | "timeout" | "failed";

export interface AgentStep {
  label: string;
  status: "pending" | "in_progress" | "completed";
}

/** The normalized stream of every adapter. A run always ends with exactly one `done`. */
export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool-use"; tool: string; command: string | null; path: string | null }
  | { type: "progress"; step: number; total: number; steps: AgentStep[] }
  /** `resets` is the limit reset time as the CLI words it, when it gives one. */
  | { type: "error"; code: AgentErrorCode; message: string; resets: string | null }
  | {
    type: "done";
    status: "completed" | "failed" | "cancelled";
    summary: string | null;
    durationMs: number | null;
  };

export interface AgentRunContext {
  agentGuidePath: string | null;
  skillPath: string | null;
}

export interface AgentRunRequest {
  message: string;
  model: string | null;
  context: AgentRunContext;
}

export interface AgentOutputNormalizer {
  line(line: string): AgentEvent[];
  /** Called when the process exits; `stderr` may be classified but is never forwarded. */
  end(exit: { code: number | null; stderr: string }): AgentEvent[];
}

export interface AgentAdapter {
  agentId: string;
  args(request: AgentRunRequest): string[];
  normalizer(): AgentOutputNormalizer;
}

export class AgentRunError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "AgentRunError";
  }
}

export interface AgentRunOptions {
  agentId: string;
  projectDir: string;
  message: string;
  model?: string | null;
  /** Source environment; the CLI only ever receives its `agentEnv` reduction. */
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  definitions?: readonly AgentDefinition[];
}

export interface AgentRun {
  events: ReadableStream<AgentEvent>;
  cancel(): void;
}

const ADAPTERS: ReadonlyMap<string, AgentAdapter> = new Map([[claudeCodeAdapter.agentId, claudeCodeAdapter]]);
const DEFAULT_RUN_TIMEOUT_MS = 10 * 60_000;
const STDERR_LIMIT = 64 * 1024;
const ACTIVE_RUNS_GLOBAL_KEY = Symbol.for("screenshot-studio.agent-runs");

// Keyed by the project folder's real path. Shared across Next dev module evaluations like the
// project session registry, so a recompiled route cannot start a second run in one project.
function activeRuns(): Map<string, () => void> {
  const serverGlobal = globalThis as typeof globalThis & { [key: symbol]: unknown };
  const existing = serverGlobal[ACTIVE_RUNS_GLOBAL_KEY] as Map<string, () => void> | undefined;
  if (existing) return existing;
  const runs = new Map<string, () => void>();
  serverGlobal[ACTIVE_RUNS_GLOBAL_KEY] = runs;
  // Agent process groups are detached; they must not keep editing a project after the server exits.
  process.once("exit", () => {
    for (const cancel of runs.values()) cancel();
  });
  return runs;
}

function runContext(projectDir: string): AgentRunContext {
  const agentGuidePath = join(projectDir, "AGENTS.md");
  const skillPath = join(dirname(resolveStoreSpecsPath()), "skills", "screenshot-studio", "SKILL.md");
  return {
    agentGuidePath: existsSync(agentGuidePath) ? agentGuidePath : null,
    skillPath: existsSync(skillPath) ? skillPath : null,
  };
}

function runnableDefinition(options: AgentRunOptions): { definition: AgentDefinition; adapter: AgentAdapter } {
  const definition = (options.definitions ?? AGENT_DEFINITIONS).find(({ id }) => id === options.agentId);
  if (!definition) throw new AgentRunError(404, "unknown-agent", `Unknown agent: ${options.agentId}`);
  if (definition.policy.level === "unavailable") {
    throw new AgentRunError(403, "unavailable", definition.policy.reason);
  }
  // shortcut: no at-own-risk agent ships and consent storage arrives with its UI (VTL-33), so these
  // never run yet; add the local-settings consent check here when the first one is added.
  if (definition.policy.level === "at-own-risk") {
    throw new AgentRunError(403, "consent-required", `${definition.name} needs your consent before it can run`);
  }
  const adapter = ADAPTERS.get(definition.id);
  if (!adapter) throw new AgentRunError(409, "no-adapter", `${definition.name} cannot run from the editor yet`);
  if (options.model != null && !definition.models.includes(options.model)) {
    throw new AgentRunError(400, "unknown-model", `${definition.name} has no model ${options.model}`);
  }
  return { definition, adapter };
}

/**
 * Starts one agent run in the project folder after the server-side policy and readiness checks.
 * Rejections throw `AgentRunError`; once started, every outcome is an event on `events`.
 */
export async function startAgentRun(options: AgentRunOptions): Promise<AgentRun> {
  const { definition, adapter } = runnableDefinition(options);
  const projectDir = await realpath(options.projectDir);
  const runs = activeRuns();
  if (runs.has(projectDir)) {
    throw new AgentRunError(409, "agent-busy", "An agent is already running in this project");
  }
  runs.set(projectDir, () => undefined);
  try {
    const status = await detectAgent(definition, { env: options.env });
    if (status.state !== "ready") {
      throw new AgentRunError(409, status.state, `${definition.name} is not ready (${status.state})`);
    }
    const request = { message: options.message, model: options.model ?? null, context: runContext(projectDir) };
    const run = launchRun(definition, adapter, request, {
      projectDir,
      env: agentEnv(options.env),
      timeoutMs: options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
      release: () => runs.delete(projectDir),
    });
    runs.set(projectDir, run.cancel);
    return run;
  } catch (error) {
    runs.delete(projectDir);
    throw error;
  }
}

/** Cancels the project's run, if any, by killing its whole process tree. */
export async function cancelAgentRun(projectDir: string): Promise<boolean> {
  const cancel = activeRuns().get(await realpath(projectDir));
  cancel?.();
  return cancel !== undefined;
}

function launchRun(
  definition: AgentDefinition,
  adapter: AgentAdapter,
  request: AgentRunRequest,
  options: { projectDir: string; env: NodeJS.ProcessEnv; timeoutMs: number; release: () => void },
): AgentRun {
  const normalizer = adapter.normalizer();
  let controller!: ReadableStreamDefaultController<AgentEvent>;
  let streamOpen = true;
  let ended = false;
  let stderr = "";

  const events = new ReadableStream<AgentEvent>({
    start(streamController) {
      controller = streamController;
    },
    cancel() {
      streamOpen = false;
      cancel();
    },
  });
  const child = spawnAgentProcess(definition.binary, adapter.args(request), {
    cwd: options.projectDir,
    env: options.env,
    input: request.message,
  });

  function emit(next: AgentEvent[]): void {
    for (const event of next) {
      if (ended) return;
      if (streamOpen) controller.enqueue(event);
      if (event.type !== "done") continue;
      ended = true;
      clearTimeout(timer);
      options.release();
      if (streamOpen) controller.close();
      streamOpen = false;
      // Also reaps anything the agent left running: no background work outlives a run.
      killProcessTree(child);
    }
  }
  function cancel(): void {
    emit([{ type: "done", status: "cancelled", summary: null, durationMs: null }]);
  }

  const timer = setTimeout(() => emit([
    { type: "error", code: "timeout", message: "The agent run timed out", resets: null },
    { type: "done", status: "failed", summary: null, durationMs: null },
  ]), options.timeoutMs);
  if (child.stdout) {
    createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) => emit(normalizer.line(line)));
  }
  child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-STDERR_LIMIT);
  });
  child.once("error", () => emit(normalizer.end({ code: null, stderr })));
  child.once("close", (code) => emit(normalizer.end({ code, stderr })));
  return { events, cancel };
}
