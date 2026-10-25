// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
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
import { agentAdapter } from "./agent-adapters.server.js";
import type { AgentAttachment } from "./agent-attachments.js";
import { createRunFolder, removeRunFolder } from "./agent-attachment-store.server.js";
import { sharedAgentConsentStore, type AgentConsentStore } from "./agent-consent.server.js";
import { readCodexAuthStore, type CodexAuthStore } from "./codex-auth-store.server.js";

export type AgentErrorCode = "usage-limit" | "not-authorized" | "timeout" | "failed";

export interface AgentStep {
  label: string;
  status: "pending" | "in_progress" | "completed";
}

export type AgentDoneStatus = "completed" | "failed" | "cancelled";

export interface AgentOtherFile {
  /** Relative to the project folder, `/`-separated. */
  path: string;
  change: "added" | "modified" | "removed";
}

/**
 * What changed in the project folder outside `app-store-screenshots.json` while a run held it.
 * Neither a rejected verdict, Undo run, nor Stop restores these files.
 */
export interface AgentOtherFiles {
  /** The first `OTHER_FILES_LIMIT` changes, the agent guides first. */
  files: AgentOtherFile[];
  count: number;
}

/**
 * The normalized stream of every adapter. A launched run always ends with one `result`, the verdict
 * on what the agent left on disk (mockup 7c: a rejected result is rolled back), then exactly one
 * `done`. A run cancelled before launch never touched the project and ends with `done` alone.
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
    /** Null when the folder was too large or could not be read to compare. */
    otherFiles: AgentOtherFiles | null;
  }
  | { type: "done"; status: AgentDoneStatus; summary: string | null; durationMs: number | null };

export interface AgentRunContext {
  agentGuidePath: string | null;
  /** The guide that ships with the app; set only when the project has no AGENTS.md of its own. */
  bundledGuidePath: string | null;
  skillPath: string | null;
  /** The Codex credentials store the readiness probe used; null for other agents. */
  codexAuthStore: CodexAuthStore | null;
}

export interface AgentRunRequest {
  message: string;
  model: string | null;
  effort: string | null;
  context: AgentRunContext;
  /** Absolute paths of this run's image attachments; they all live in one folder only this run knows. */
  attachments: string[];
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
  effort?: string | null;
  /** Validated images for this request only; written to a temporary folder once the run is admitted. */
  attachments?: readonly AgentAttachment[];
  /** Source environment; the CLI only ever receives its `agentEnv` reduction. */
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** How long a run waits for editor writes already in flight before it gives up as `project-busy`. */
  drainTimeoutMs?: number;
  definitions?: readonly AgentDefinition[];
  /** Where `at-own-risk` consent is stored; the app's own store when omitted. */
  consent?: AgentConsentStore;
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
  otherFiles: AgentOtherFiles | null;
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

const DEFAULT_RUN_TIMEOUT_MS = 10 * 60_000;
// An export holds an editor write for its whole render, so a run waits a while before giving up.
const DEFAULT_DRAIN_TIMEOUT_MS = 30_000;
const DRAIN_POLL_MS = 25;
// Longer than the mutation lock's 30 s stale window, which bounds an abandoned lock's lifetime.
const VERDICT_LOCK_TIMEOUT_MS = 45_000;
const STDERR_LIMIT = 64 * 1024;
const FOLDER_SCAN_LIMIT = 5_000;
const OTHER_FILES_LIMIT = 50;
const AGENT_GUIDES = ["AGENTS.md", "CLAUDE.md"];
const ACTIVE_RUNS_GLOBAL_KEY = Symbol.for("screenshot-studio.agent-runs");
const EDITOR_WRITES_GLOBAL_KEY = Symbol.for("screenshot-studio.agent-editor-writes");
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

// Editor writes in flight per project folder. A run reserves its slot, then waits for this count to
// drain before its snapshot; an editor write checks the slot and counts itself in one synchronous
// step. So no editor write can land between a run's snapshot and its verdict, where Undo or a
// rejected result would silently drop it.
function editorWrites(): Map<string, number> {
  return serverGlobalMap<number>(EDITOR_WRITES_GLOBAL_KEY);
}

async function realProjectDir(projectDir: string): Promise<string | null> {
  return realpath(projectDir).catch(() => null);
}

/**
 * Admits one editor write to the project folder, or returns null while an agent run holds it. The
 * caller keeps the returned release until its locked write is done.
 * shortcut: in-process only; a terminal `screenshots` CLI writing during a run is not fenced and is
 * dropped by Undo run like any other change made after the snapshot.
 */
export async function beginEditorWrite(projectDir: string): Promise<(() => void) | null> {
  const resolved = await realProjectDir(projectDir);
  if (resolved === null) return () => undefined;
  // No await from here to the increment: the run check and the count are one atomic step.
  if (activeRuns().has(resolved)) return null;
  const writes = editorWrites();
  writes.set(resolved, (writes.get(resolved) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (writes.get(resolved) ?? 1) - 1;
    if (left > 0) writes.set(resolved, left);
    else writes.delete(resolved);
  };
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
  // Undo is an editor write: a run cannot start between this check and the restore.
  const release = await beginEditorWrite(resolved);
  if (!release) {
    throw new AgentRunError(409, "agent-busy", "An agent is running in this project; stop it before undoing");
  }
  const projectFile = join(resolved, PROJECT_FILE_NAME);
  try {
    await withProjectMutation(projectFile, async () => {
      const current = await readFile(projectFile).then(projectRevision, () => null);
      if (current !== null && current !== pending.outcome.revision) {
        throw new AgentRunError(409, "project-changed", "The project changed after the agent run; undo is no longer possible");
      }
      await writeProjectAtomic(projectFile, pending.snapshot);
    });
  } finally {
    release();
  }
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

/** Path → stat fingerprint of every entry in a project folder. */
type FolderManifest = Map<string, string>;

/** The project file and the lock and temp files its own writes leave beside it. */
function projectFileOrSidecar(name: string): boolean {
  return name === PROJECT_FILE_NAME
    || (name.startsWith(`.${PROJECT_FILE_NAME}.`) && (name.endsWith(".tmp") || name.endsWith(".screenshot-studio.lock")));
}

function skipMissing<T>(fallback: T): (error: unknown) => T {
  return (error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  };
}

/** Null past `FOLDER_SCAN_LIMIT` entries or on a read error, so a partial scan never reports a guess. */
async function folderManifest(projectDir: string): Promise<FolderManifest | null> {
  const manifest: FolderManifest = new Map();
  const folders = [""];
  let visited = 0;
  try {
    for (let folder = folders.pop(); folder !== undefined; folder = folders.pop()) {
      const entries = (await readdir(join(projectDir, folder), { withFileTypes: true }).catch(skipMissing([])))
        .filter(({ name }) => name !== ".DS_Store" && !(folder === "" && projectFileOrSidecar(name)));
      visited += entries.length;
      if (visited > FOLDER_SCAN_LIMIT) return null;
      const files: string[] = [];
      for (const entry of entries) {
        const path = folder ? `${folder}/${entry.name}` : entry.name;
        // Dirent types are lstat's, so a symlinked folder is fingerprinted as a link, never followed.
        (entry.isDirectory() ? folders : files).push(path);
      }
      await Promise.all(files.map(async (path) => {
        const stat = await lstat(join(projectDir, path)).catch(skipMissing(null));
        // ctime moves on every write and cannot be set back, unlike mtime.
        if (stat) manifest.set(path, `${stat.mode}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`);
      }));
    }
  } catch {
    return null;
  }
  return manifest;
}

function comparePaths(a: AgentOtherFile, b: AgentOtherFile): number {
  const rank = (path: string) => (AGENT_GUIDES.includes(path) ? AGENT_GUIDES.indexOf(path) : AGENT_GUIDES.length);
  // Paths are unique, so two entries never compare equal.
  return rank(a.path) - rank(b.path) || (a.path < b.path ? -1 : 1);
}

async function otherFileChanges(projectDir: string, before: FolderManifest | null): Promise<AgentOtherFiles | null> {
  const after = before && await folderManifest(projectDir);
  if (!before || !after) return null;
  const files: AgentOtherFile[] = [];
  for (const [path, fingerprint] of after) {
    const previous = before.get(path);
    if (previous !== fingerprint) files.push({ path, change: previous === undefined ? "added" : "modified" });
  }
  for (const path of before.keys()) if (!after.has(path)) files.push({ path, change: "removed" });
  // The guides steer every later run of either agent, so their changes lead the list.
  files.sort(comparePaths);
  return { files: files.slice(0, OTHER_FILES_LIMIT), count: files.length };
}

/**
 * The verdict on the project file after the agent exited: a document the strict schema rejects
 * (or a missing one) is rolled back to the pre-run snapshot; a valid one becomes the pending outcome
 * the chat can keep or undo. Either way the result lists the other files the run left changed.
 */
async function settleRun(
  projectDir: string,
  snapshot: ProjectSnapshot,
  folderBefore: FolderManifest | null,
  status: AgentDoneStatus,
): Promise<SettledRun> {
  const projectFile = join(projectDir, PROJECT_FILE_NAME);
  const otherFiles = await otherFileChanges(projectDir, folderBefore);
  const rejected = (reason: string, restored: ProjectSnapshot): SettledRun => {
    pendingOutcomes().delete(projectDir);
    return {
      result: {
        type: "result", status: "rejected", reason, changed: false, changedScreens: [], revision: restored.revision, otherFiles,
      },
      status: "failed",
    };
  };
  // The lock path resolves through the project file, so a deleted file cannot be locked by anyone;
  // it is restored without the lock.
  if (!existsSync(projectFile)) {
    return rejected(`The agent removed ${PROJECT_FILE_NAME}`, await writeProjectAtomic(projectFile, snapshot.project));
  }
  // Read and rollback in one locked section, so a terminal CLI write cannot slip between them. A CLI
  // killed mid-write leaves its lock until it goes stale, so the wait outlasts the stale window.
  const verdict = await withProjectMutation(projectFile, async () => {
    try {
      return { valid: true as const, current: await readProjectSnapshot(projectFile) };
    } catch (error) {
      return { valid: false as const, reason: errorText(error), restored: await writeProjectAtomic(projectFile, snapshot.project) };
    }
  }, { timeoutMs: VERDICT_LOCK_TIMEOUT_MS });
  if (!verdict.valid) return rejected(verdict.reason, verdict.restored);
  const { current } = verdict;
  const changed = current.revision !== snapshot.revision;
  const changedScreens = changed ? changedScreenIds(snapshot.project, current.project) : [];
  if (changed) {
    pendingOutcomes().set(projectDir, {
      snapshot: snapshot.project,
      outcome: { revision: current.revision, changedScreens, otherFiles, finishedAt: new Date().toISOString() },
    });
  } else {
    pendingOutcomes().delete(projectDir);
  }
  return {
    result: { type: "result", status: "accepted", reason: null, changed, changedScreens, revision: current.revision, otherFiles },
    status,
  };
}

function runContext(projectDir: string, codexAuthStore: CodexAuthStore | null): AgentRunContext {
  const agentGuidePath = join(projectDir, "AGENTS.md");
  const hasAgentGuide = existsSync(agentGuidePath);
  const appRoot = dirname(resolveStoreSpecsPath());
  const skillPath = join(appRoot, "skills", "screenshot-studio", "SKILL.md");
  // Editor-created projects have no AGENTS.md. A checkout keeps the guide in the CLI source; the
  // packaged CLI copies it to dist/, beside the runtime/ folder that holds store-specs.json.
  const bundledGuidePath = hasAgentGuide ? null : [
    join(appRoot, "packages", "cli", "src", "project-agent-guide.md"),
    join(appRoot, "..", "dist", "project-agent-guide.md"),
  ].find((path) => existsSync(path)) ?? null;
  return {
    agentGuidePath: hasAgentGuide ? agentGuidePath : null,
    bundledGuidePath,
    skillPath: existsSync(skillPath) ? skillPath : null,
    codexAuthStore,
  };
}

async function requireConsent(definition: AgentDefinition, options: AgentRunOptions): Promise<void> {
  if (definition.policy.level === "at-own-risk" && !await (options.consent ?? sharedAgentConsentStore()).isGranted(definition)) {
    throw new AgentRunError(403, "consent-required", `${definition.name} needs your consent before it can run`);
  }
}

/**
 * The server-side policy gate. Nothing in a request can grant consent: it is read from the app's own
 * store, and `unavailable` is refused before any consent or adapter lookup.
 */
async function runnableDefinition(options: AgentRunOptions): Promise<{ definition: AgentDefinition; adapter: AgentAdapter }> {
  const definition = (options.definitions ?? AGENT_DEFINITIONS).find(({ id }) => id === options.agentId);
  if (!definition) throw new AgentRunError(404, "unknown-agent", `Unknown agent: ${options.agentId}`);
  if (definition.policy.level === "unavailable") {
    throw new AgentRunError(403, "unavailable", definition.policy.reason);
  }
  await requireConsent(definition, options);
  const adapter = agentAdapter(definition.id);
  if (!adapter) throw new AgentRunError(409, "no-adapter", `${definition.name} cannot run from the editor yet`);
  if (options.model != null && !definition.models.some(({ id }) => id === options.model)) {
    throw new AgentRunError(400, "unknown-model", `${definition.name} has no model ${options.model}`);
  }
  if (options.effort != null && !definition.efforts.some(({ id }) => id === options.effort)) {
    throw new AgentRunError(400, "unknown-effort", `${definition.name} has no effort ${options.effort}`);
  }
  return { definition, adapter };
}

/**
 * Starts one agent run in the project folder after the server-side policy and readiness checks.
 * Rejections throw `AgentRunError`; once started, every outcome is an event on `events`. Order:
 * reserve the project slot (new editor writes now get 423), wait for editor writes in flight to
 * finish, then snapshot under the mutation lock, so an invalid result can be rolled back and a
 * valid one undone without dropping an editor change.
 */
export async function startAgentRun(options: AgentRunOptions): Promise<AgentRun> {
  const { definition, adapter } = await runnableDefinition(options);
  const projectDir = await realpath(options.projectDir);
  const runs = activeRuns();
  if (runs.has(projectDir)) {
    throw new AgentRunError(409, "agent-busy", "An agent is already running in this project");
  }
  let cancelledBeforeLaunch = false;
  let runFolder: string | null = null;
  runs.set(projectDir, () => {
    cancelledBeforeLaunch = true;
  });
  try {
    // Read once, so the readiness probe and the run use the same store.
    const codexAuthStore = definition.id === "codex" ? await readCodexAuthStore(agentEnv(options.env)) : null;
    const status = await detectAgent(definition, { env: options.env, codexAuthStore });
    if (!cancelledBeforeLaunch && status.state !== "ready") {
      throw new AgentRunError(409, status.state, `${definition.name} is not ready (${status.state})`);
    }
    const drainDeadline = Date.now() + (options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS);
    while (!cancelledBeforeLaunch && (editorWrites().get(projectDir) ?? 0) > 0) {
      if (Date.now() >= drainDeadline) {
        throw new AgentRunError(409, "project-busy", "The editor is still saving or exporting this project; try again when it finishes");
      }
      await new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_MS));
    }
    if (cancelledBeforeLaunch) {
      runs.delete(projectDir);
      return finishedRun({ type: "done", status: "cancelled", summary: null, durationMs: null });
    }
    // The readiness probe and the drain wait can take a while; a consent revoked meanwhile still wins.
    await requireConsent(definition, options);
    let snapshot: ProjectSnapshot;
    try {
      const projectFile = join(projectDir, PROJECT_FILE_NAME);
      snapshot = await withProjectMutation(projectFile, () => readProjectSnapshot(projectFile));
    } catch (error) {
      throw new AgentRunError(409, "project-invalid", `The project cannot be snapshotted before the run: ${errorText(error)}`);
    }
    const folderBefore = await folderManifest(projectDir);
    // Only an admitted run with images touches the file system, so a refused or text-only request
    // never leaves a file behind or fails on the temp directory.
    const folder = options.attachments?.length ? await createRunFolder(options.attachments) : { dir: null, files: [] };
    runFolder = folder.dir;
    // Stop can arrive during any await above; DELETE already answered it, so the run must not launch.
    if (cancelledBeforeLaunch) {
      runs.delete(projectDir);
      if (folder.dir) await removeRunFolder(folder.dir);
      return finishedRun({ type: "done", status: "cancelled", summary: null, durationMs: null });
    }
    // A new run supersedes the previous Undo: its snapshot is the state the user chose to go on from.
    pendingOutcomes().delete(projectDir);
    const request: AgentRunRequest = {
      message: options.message,
      model: options.model ?? null,
      effort: options.effort ?? null,
      context: runContext(projectDir, codexAuthStore),
      attachments: folder.files,
    };
    const run = launchRun(definition, adapter, request, {
      projectDir,
      env: agentEnv(options.env),
      timeoutMs: options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
      settle: (doneStatus) => settleRun(projectDir, snapshot, folderBefore, doneStatus),
      // The process tree is dead by now, so nothing still reads the images.
      release: () => {
        runs.delete(projectDir);
        if (folder.dir) void removeRunFolder(folder.dir);
      },
    });
    runs.set(projectDir, run.cancel);
    return run;
  } catch (error) {
    runs.delete(projectDir);
    if (runFolder) await removeRunFolder(runFolder);
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
