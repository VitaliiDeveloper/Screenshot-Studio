// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { Project } from "@screenshot-studio/core/model";
import {
  errorText,
  projectRevision,
  readProjectSnapshot,
  withProjectMutation,
  writeProjectAtomic,
  type ProjectSnapshot,
} from "@screenshot-studio/core/storage";
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

export type AgentDoneStatus = "completed" | "failed" | "cancelled";

/**
 * The normalized stream of every adapter. A run always ends with one `result`, the verdict on what
 * the agent left on disk (mockup 7c: a rejected result is rolled back), then exactly one `done`.
 */
export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool-use"; tool: string; command: string | null; path: string | null }
  | { type: "progress"; step: number; total: number; steps: AgentStep[] }
  /** `resets` is the limit reset time as the CLI words it, when it gives one. */
  | { type: "error"; code: AgentErrorCode; message: string; resets: string | null }
  | {
    type: "result";
    status: "accepted" | "rejected";
    /** Why the project was rolled back; null when accepted. */
    reason: string | null;
    changed: boolean;
    changedScreens: string[];
    /** Revision now on disk: the run's for accepted, the restored snapshot's for rejected. */
    revision: string;
  }
  | { type: "done"; status: AgentDoneStatus; summary: string | null; durationMs: number | null };

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

/** An accepted run whose pre-run snapshot is still held, so the chat can offer Undo run / Keep (7b). */
export interface AgentRunOutcome {
  /** Revision the run left on disk; Undo refuses once the editor has written past it. */
  revision: string;
  changedScreens: string[];
  finishedAt: string;
}

interface PendingOutcome {
  snapshot: Project;
  outcome: AgentRunOutcome;
}

interface SettledRun {
  result: Extract<AgentEvent, { type: "result" }>;
  status: AgentDoneStatus;
}

export const PROJECT_FILE_NAME = "app-store-screenshots.json";

const ADAPTERS: ReadonlyMap<string, AgentAdapter> = new Map([[claudeCodeAdapter.agentId, claudeCodeAdapter]]);
const DEFAULT_RUN_TIMEOUT_MS = 10 * 60_000;
const STDERR_LIMIT = 64 * 1024;
const ACTIVE_RUNS_GLOBAL_KEY = Symbol.for("screenshot-studio.agent-runs");
const OUTCOMES_GLOBAL_KEY = Symbol.for("screenshot-studio.agent-outcomes");

// Shared across Next dev module evaluations like the project session registry, so a recompiled
// route sees the same runs and snapshots.
function serverGlobalMap<T>(key: symbol, onCreate?: (map: Map<string, T>) => void): Map<string, T> {
  const serverGlobal = globalThis as typeof globalThis & { [key: symbol]: unknown };
  const existing = serverGlobal[key] as Map<string, T> | undefined;
  if (existing) return existing;
  const created = new Map<string, T>();
  serverGlobal[key] = created;
  onCreate?.(created);
  return created;
}

// Keyed by the project folder's real path, so one project never runs two agents at once.
function activeRuns(): Map<string, () => void> {
  return serverGlobalMap<() => void>(ACTIVE_RUNS_GLOBAL_KEY, (runs) => {
    // Agent process groups are detached; they must not keep editing a project after the server exits.
    process.once("exit", () => {
      for (const cancel of runs.values()) cancel();
    });
  });
}

// shortcut: snapshots live in server memory, so a server restart drops a pending Undo run; persist
// them under the project folder when the chat needs Undo to survive restarts.
function pendingOutcomes(): Map<string, PendingOutcome> {
  return serverGlobalMap<PendingOutcome>(OUTCOMES_GLOBAL_KEY);
}

async function realProjectDir(projectDir: string): Promise<string | null> {
  return realpath(projectDir).catch(() => null);
}

/** Whether an agent is editing the project folder right now; editor writes must wait for it. */
export async function agentRunActive(projectDir: string): Promise<boolean> {
  const resolved = await realProjectDir(projectDir);
  return resolved !== null && activeRuns().has(resolved);
}

export async function pendingAgentOutcome(projectDir: string): Promise<AgentRunOutcome | null> {
  const resolved = await realProjectDir(projectDir);
  return resolved === null ? null : pendingOutcomes().get(resolved)?.outcome ?? null;
}

/** Keep: the run's changes stay and the snapshot is dropped. False when nothing was pending. */
export async function keepAgentOutcome(projectDir: string): Promise<boolean> {
  const resolved = await realProjectDir(projectDir);
  return resolved !== null && pendingOutcomes().delete(resolved);
}

/**
 * Undo run: restores the pre-run snapshot as one project write. Refused while an agent runs and once
 * the editor has written past the run's revision, so a later edit is never thrown away.
 */
export async function undoAgentOutcome(projectDir: string): Promise<AgentRunOutcome> {
  const resolved = await realProjectDir(projectDir);
  const pending = resolved ? pendingOutcomes().get(resolved) : undefined;
  if (!resolved || !pending) throw new AgentRunError(404, "no-outcome", "No agent run to undo in this project");
  if (activeRuns().has(resolved)) {
    throw new AgentRunError(409, "agent-busy", "An agent is running in this project; stop it before undoing");
  }
  const projectFile = join(resolved, PROJECT_FILE_NAME);
  await withProjectMutation(projectFile, async () => {
    const current = await readFile(projectFile).then(projectRevision, () => null);
    if (current !== null && current !== pending.outcome.revision) {
      throw new AgentRunError(409, "project-changed", "The project changed after the agent run; undo is no longer possible");
    }
    await writeProjectAtomic(projectFile, pending.snapshot);
  });
  pendingOutcomes().delete(resolved);
  return pending.outcome;
}

function changedScreenIds(before: Project, after: Project): string[] {
  const serialized = (project: Project) => new Map(project.layouts.flatMap((layout) =>
    layout.screens.map((screen) => [`${layout.id}/${screen.id}`, JSON.stringify(screen)] as const)
  ));
  const previous = serialized(before);
  const next = serialized(after);
  const ids = new Set<string>();
  for (const [key, value] of next) if (previous.get(key) !== value) ids.add(key.slice(key.indexOf("/") + 1));
  for (const key of previous.keys()) if (!next.has(key)) ids.add(key.slice(key.indexOf("/") + 1));
  return [...ids];
}

/**
 * The verdict on the project file after the agent exited: a document the strict schema rejects
 * (or a missing one) is rolled back to the pre-run snapshot; a valid one becomes the pending outcome
 * the chat can keep or undo.
 */
async function settleRun(
  projectDir: string,
  snapshot: ProjectSnapshot,
  status: AgentDoneStatus,
): Promise<SettledRun> {
  const projectFile = join(projectDir, PROJECT_FILE_NAME);
  let current: ProjectSnapshot;
  try {
    current = await readProjectSnapshot(projectFile);
  } catch (error) {
    // The agent's own CLI writes are already finished (its tree is dead), so the lock is free.
    await withProjectMutation(projectFile, () => writeProjectAtomic(projectFile, snapshot.project));
    pendingOutcomes().delete(projectDir);
    return {
      result: {
        type: "result",
        status: "rejected",
        reason: errorText(error),
        changed: false,
        changedScreens: [],
        revision: snapshot.revision,
      },
      status: "failed",
    };
  }
  const changed = current.revision !== snapshot.revision;
  const changedScreens = changed ? changedScreenIds(snapshot.project, current.project) : [];
  if (changed) {
    pendingOutcomes().set(projectDir, {
      snapshot: snapshot.project,
      outcome: { revision: current.revision, changedScreens, finishedAt: new Date().toISOString() },
    });
  } else {
    pendingOutcomes().delete(projectDir);
  }
  return {
    result: { type: "result", status: "accepted", reason: null, changed, changedScreens, revision: current.revision },
    status,
  };
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
 * Rejections throw `AgentRunError`; once started, every outcome is an event on `events`. The
 * project is snapshotted first, so an invalid result can be rolled back and a valid one undone.
 */
export async function startAgentRun(options: AgentRunOptions): Promise<AgentRun> {
  const { definition, adapter } = runnableDefinition(options);
  const projectDir = await realpath(options.projectDir);
  const runs = activeRuns();
  if (runs.has(projectDir)) {
    throw new AgentRunError(409, "agent-busy", "An agent is already running in this project");
  }
  let cancelledBeforeLaunch = false;
  runs.set(projectDir, () => {
    cancelledBeforeLaunch = true;
  });
  try {
    const status = await detectAgent(definition, { env: options.env });
    if (cancelledBeforeLaunch) {
      runs.delete(projectDir);
      return finishedRun({ type: "done", status: "cancelled", summary: null, durationMs: null });
    }
    if (status.state !== "ready") {
      throw new AgentRunError(409, status.state, `${definition.name} is not ready (${status.state})`);
    }
    let snapshot: ProjectSnapshot;
    try {
      snapshot = await readProjectSnapshot(join(projectDir, PROJECT_FILE_NAME));
    } catch (error) {
      throw new AgentRunError(409, "project-invalid", `The project cannot be snapshotted before the run: ${errorText(error)}`);
    }
    // A new run supersedes the previous Undo: its snapshot is the state the user chose to go on from.
    pendingOutcomes().delete(projectDir);
    const request = { message: options.message, model: options.model ?? null, context: runContext(projectDir) };
    const run = launchRun(definition, adapter, request, {
      projectDir,
      env: agentEnv(options.env),
      timeoutMs: options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
      settle: (doneStatus) => settleRun(projectDir, snapshot, doneStatus),
      release: () => runs.delete(projectDir),
    });
    runs.set(projectDir, run.cancel);
    return run;
  } catch (error) {
    runs.delete(projectDir);
    throw error;
  }
}

function finishedRun(event: AgentEvent): AgentRun {
  return {
    events: new ReadableStream<AgentEvent>({
      start(controller) {
        controller.enqueue(event);
        controller.close();
      },
    }),
    cancel: () => undefined,
  };
}

/** Cancels the project's run, if any; a run still in its readiness check never launches. */
export async function cancelAgentRun(projectDir: string): Promise<boolean> {
  const cancel = activeRuns().get(await realpath(projectDir));
  cancel?.();
  return cancel !== undefined;
}

function launchRun(
  definition: AgentDefinition,
  adapter: AgentAdapter,
  request: AgentRunRequest,
  options: {
    projectDir: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    settle: (status: AgentDoneStatus) => Promise<SettledRun>;
    release: () => void;
  },
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

  function close(next: AgentEvent[]): void {
    if (streamOpen) {
      for (const event of next) controller.enqueue(event);
    }
    // The project slot stays taken until the verdict is in, so no second run starts on an unchecked file.
    options.release();
    if (streamOpen) controller.close();
    streamOpen = false;
  }

  async function finish(done: Extract<AgentEvent, { type: "done" }>): Promise<void> {
    try {
      const settled = await options.settle(done.status);
      close([settled.result, { ...done, status: settled.status }]);
    } catch (error) {
      close([
        { type: "error", code: "failed", message: `The project could not be verified after the run: ${errorText(error)}`, resets: null },
        { ...done, status: "failed" },
      ]);
    }
  }

  function emit(next: AgentEvent[]): void {
    for (const event of next) {
      if (ended) return;
      if (event.type !== "done") {
        if (streamOpen) controller.enqueue(event);
        continue;
      }
      ended = true;
      clearTimeout(timer);
      // Also reaps anything the agent left running: no background work outlives a run, and the
      // verdict below reads a file nothing is still writing.
      killProcessTree(child);
      void finish(event);
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
