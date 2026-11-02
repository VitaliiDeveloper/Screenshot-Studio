// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Project } from "@screenshot-studio/core/model";
import {
  errorText,
  readProjectSnapshot,
  withProjectMutation,
  writeProjectAtomic,
  type ProjectSnapshot,
} from "@screenshot-studio/core/storage";
import { pendingOutcomes } from "./agent-run-state.server.js";
import type {
  AgentDoneStatus,
  AgentEvent,
  AgentOtherFile,
  AgentOtherFiles,
  AgentRunMode,
} from "./agent-session.server.js";

export interface SettledRun {
  result: Extract<AgentEvent, { type: "result" }>;
  status: AgentDoneStatus;
}

export const PROJECT_FILE_NAME = "app-store-screenshots.json";

// Longer than the mutation lock's 30 s stale window, which bounds an abandoned lock's lifetime.
const VERDICT_LOCK_TIMEOUT_MS = 45_000;
const FOLDER_SCAN_LIMIT = 5_000;
const OTHER_FILES_LIMIT = 50;
const AGENT_GUIDES = ["AGENTS.md", "CLAUDE.md"];
const CRITIC_CHANGED_REASON = "The critic changed the project, but a critic run is read-only";

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
export async function folderManifest(projectDir: string): Promise<FolderManifest | null> {
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
  // The guides steer agents the user starts outside the editor, so their changes lead the list.
  files.sort(comparePaths);
  return { files: files.slice(0, OTHER_FILES_LIMIT), count: files.length };
}

/**
 * The verdict on the project file after the agent exited: a document the strict schema rejects
 * (or a missing one) is rolled back to the pre-run snapshot; a valid one becomes the pending outcome
 * the chat can keep or undo. A critic run that changed the project is rolled back too, and it never
 * replaces the pending outcome of the run it reviewed. Either way the result lists the other files
 * the run left changed.
 */
export async function settleRun(
  projectDir: string,
  snapshot: ProjectSnapshot,
  folderBefore: FolderManifest | null,
  status: AgentDoneStatus,
  mode: AgentRunMode,
): Promise<SettledRun> {
  const projectFile = join(projectDir, PROJECT_FILE_NAME);
  const otherFiles = await otherFileChanges(projectDir, folderBefore);
  const rejected = (reason: string, restored: ProjectSnapshot): SettledRun => {
    const pending = pendingOutcomes().get(projectDir);
    if (mode === "edit") pendingOutcomes().delete(projectDir);
    // The restore rewrites the reviewed run's state, so Undo follows it to the rewritten revision.
    else if (pending?.outcome.revision === snapshot.revision) pending.outcome = { ...pending.outcome, revision: restored.revision };
    return {
      result: {
        type: "result", status: "rejected", reason, changed: false, changedScreens: [], revision: restored.revision, otherFiles,
      },
      status: "failed",
    };
  };
  // A restore would `mkdir -p` a deleted project back as an uncatalogued folder.
  if (!existsSync(projectDir)) return rejected("The project folder was removed during the run", snapshot);
  // The lock path resolves through the project file, so a deleted file cannot be locked by anyone;
  // it is restored without the lock.
  if (!existsSync(projectFile)) {
    return rejected(`The agent removed ${PROJECT_FILE_NAME}`, await writeProjectAtomic(projectFile, snapshot.project));
  }
  // Read and rollback in one locked section, so a terminal CLI write cannot slip between them. A CLI
  // killed mid-write leaves its lock until it goes stale, so the wait outlasts the stale window.
  const verdict = await withProjectMutation(projectFile, async () => {
    try {
      const current = await readProjectSnapshot(projectFile);
      if (mode === "critic" && current.revision !== snapshot.revision) {
        return { valid: false as const, reason: CRITIC_CHANGED_REASON, restored: await writeProjectAtomic(projectFile, snapshot.project) };
      }
      return { valid: true as const, current };
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
  } else if (mode === "edit") {
    pendingOutcomes().delete(projectDir);
  }
  return {
    result: { type: "result", status: "accepted", reason: null, changed, changedScreens, revision: current.revision, otherFiles },
    status,
  };
}
