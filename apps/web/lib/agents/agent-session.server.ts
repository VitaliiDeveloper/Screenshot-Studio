// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  errorText,
  projectRevision,
  readProjectSnapshot,
  withProjectMutation,
  writeProjectAtomic,
  type ProjectSnapshot,
} from "@screenshot-studio/core/storage";
import { resolveManagedProjectStorageConfig } from "@web/lib/managed-projects/managed-project-config.server.js";
import { realPathOf, storeKeyFolder } from "@web/lib/store-key-folder.server.js";
import { resolveStoreSpecsPath } from "@web/lib/store-specs-path.js";
import { detectAgent } from "./agent-registry.server.js";
import {
  AGENT_DEFINITIONS,
  agentEnv,
  type AgentDefinition,
} from "./agents.server.js";
import { skillReference } from "./agent-adapter.server.js";
import { agentAdapter } from "./agent-adapters.server.js";
import type { AgentAttachment } from "./agent-attachments.js";
import { createRunFolder, removeRunFolder } from "./agent-attachment-store.server.js";
import { RENDER_INBOX_ENV } from "@screenshot-studio/core/agent-render";
import { startRenderBroker, type RenderBroker } from "./agent-render-broker.server.js";
import type { RenderHost } from "./agent-render-job.server.js";
import { launchRun } from "./agent-run-process.server.js";
import { activeRuns, editorWrites, pendingOutcomes } from "./agent-run-state.server.js";
import { folderManifest, PROJECT_FILE_NAME, settleRun } from "./agent-run-verdict.server.js";
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
  /** The guide that ships with the CLI; a project's own AGENTS.md may come from an imported archive. */
  bundledGuidePath: string | null;
  skillPath: string | null;
  /** The Codex credentials store the readiness probe used; null for other agents. */
  codexAuthStore: CodexAuthStore | null;
  /** The store key folder, closed to every agent; may not exist yet. */
  storeCredentialsDir: string;
}

/** `critic` reviews the exported set and must not change the project; a change it makes is rolled back. */
export const AGENT_RUN_MODES = ["edit", "critic"] as const;
export type AgentRunMode = (typeof AGENT_RUN_MODES)[number];

export interface AgentRunRequest {
  message: string;
  mode: AgentRunMode;
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
  /** `edit` when omitted. */
  mode?: AgentRunMode;
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
  /** Lets `screenshots export` and `check --render` render through this editor from inside the sandbox. */
  renderHost?: RenderHost;
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

const DEFAULT_RUN_TIMEOUT_MS = 10 * 60_000;
// An export holds an editor write for its whole render, so a run waits a while before giving up.
const DEFAULT_DRAIN_TIMEOUT_MS = 30_000;
const DRAIN_POLL_MS = 25;

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

function bundledSkillPath(): string {
  return join(dirname(resolveStoreSpecsPath()), "skills", "screenshot-studio", "SKILL.md");
}

async function runContext(codexAuthStore: CodexAuthStore | null): Promise<AgentRunContext> {
  const appRoot = dirname(resolveStoreSpecsPath());
  const skillPath = bundledSkillPath();
  // A checkout keeps the guide in the CLI source; the packaged CLI copies it to dist/, beside the
  // runtime/ folder that holds store-specs.json.
  const bundledGuidePath = [
    join(appRoot, "packages", "cli", "src", "project-agent-guide.md"),
    join(appRoot, "..", "dist", "project-agent-guide.md"),
  ].find((path) => existsSync(path)) ?? null;
  return {
    bundledGuidePath,
    skillPath: existsSync(skillPath) ? skillPath : null,
    codexAuthStore,
    storeCredentialsDir: await realPathOf(storeKeyFolder(resolveManagedProjectStorageConfig().root)),
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
  const mode = options.mode ?? "edit";
  if (mode === "critic" && !existsSync(skillReference(bundledSkillPath(), "critic.md"))) {
    throw new AgentRunError(409, "critic-unavailable", "The critic rules are not installed with this app");
  }
  const projectDir = await realpath(options.projectDir);
  const runs = activeRuns();
  if (runs.has(projectDir)) {
    throw new AgentRunError(409, "agent-busy", "An agent is already running in this project");
  }
  let cancelledBeforeLaunch = false;
  let runFolder: string | null = null;
  let broker: RenderBroker | null = null;
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
    // Rendering is one part of a run, so a temp folder that cannot be used costs only that: the CLI
    // then fails to render exactly as it does without a broker.
    if (options.renderHost) broker = await startRenderBroker({ projectDir, host: options.renderHost }).catch(() => null);
    // Stop can arrive during any await above; DELETE already answered it, so the run must not launch.
    if (cancelledBeforeLaunch) {
      runs.delete(projectDir);
      if (folder.dir) await removeRunFolder(folder.dir);
      await broker?.stop();
      return finishedRun({ type: "done", status: "cancelled", summary: null, durationMs: null });
    }
    // A new edit run supersedes the previous Undo: its snapshot is the state the user chose to go on from.
    if (mode === "edit") pendingOutcomes().delete(projectDir);
    const request: AgentRunRequest = {
      message: options.message,
      mode,
      model: options.model ?? null,
      effort: options.effort ?? null,
      context: await runContext(codexAuthStore),
      attachments: folder.files,
    };
    const run = launchRun(definition, adapter, request, {
      projectDir,
      env: broker ? { ...agentEnv(options.env), [RENDER_INBOX_ENV]: broker.inboxDir } : agentEnv(options.env),
      timeoutMs: options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
      settle: async (doneStatus) => {
        await broker?.stop();
        return settleRun(projectDir, snapshot, folderBefore, doneStatus, mode);
      },
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
    await broker?.stop();
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
  const resolved = await realProjectDir(projectDir);
  const cancel = resolved === null ? undefined : activeRuns().get(resolved);
  cancel?.();
  return cancel !== undefined;
}
