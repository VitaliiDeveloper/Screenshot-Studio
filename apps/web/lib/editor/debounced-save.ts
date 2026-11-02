// SPDX-License-Identifier: Apache-2.0
import type { Project } from "@screenshot-studio/core/model";
import { editorStore } from "./editor-store.js";
import { clearProjectPersistenceIdentity, saveProject } from "@web/lib/clients/save-project.js";

/**
 * Returns a debounced version of `saveFn` that coalesces rapid calls into one, keeping only the
 * latest project. Inspector inputs fire per keystroke / slider tick; this stops each
 * one becoming its own PUT while the store patch stays immediate.
 */
export function createDebouncedSaver(
  saveFn: (project: Project) => void | Promise<void>,
  delayMs: number,
): ((project: Project) => void) & {
  cancel: () => void;
  flush: () => Promise<void>;
  hasPending: () => boolean;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Project | undefined;
  const invoke = async () => {
    const project = pending;
    pending = undefined;
    if (project) await saveFn(project);
  };
  const schedule = (project: Project) => {
    pending = project;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void invoke().catch(() => undefined);
    }, delayMs);
  };
  schedule.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };
  schedule.flush = async () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    await invoke();
  };
  schedule.hasPending = () => pending !== undefined;
  return schedule;
}

export function createProjectSaveCoordinator(
  saveFn: (project: Project) => Promise<void>,
  getLatestProject: () => Project | undefined,
) {
  let tail: Promise<void> = Promise.resolve();
  // Re-sending an unchanged copy would fail its If-Match after another writer and block the caller.
  let persisted: Project | undefined;

  const runExclusive = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };

  const saveIfChanged = async (project: Project) => {
    if (project === persisted) return;
    await saveFn(project);
    persisted = project;
  };

  return {
    /** Enqueue a save that reads the latest store state only when it reaches the front. */
    saveLatest(): Promise<void> {
      return runExclusive(async () => {
        const project = getLatestProject();
        if (project) await saveIfChanged(project);
      });
    },
    runExclusive,
    /** Save the latest project, then keep later saves queued behind the operation. */
    runFlushed<T>(operation: () => Promise<T>): Promise<T> {
      return runExclusive(async () => {
        const project = getLatestProject();
        if (!project) throw new Error("No project loaded");
        await saveIfChanged(project);
        return operation();
      });
    },
    /** Drain the latest project, activate the replacement, then clear state before queued saves run. */
    switchProject<T>(activate: () => Promise<T>, reset: () => void): Promise<T> {
      return runExclusive(async () => {
        const project = getLatestProject();
        if (project) await saveIfChanged(project);
        const result = await activate();
        reset();
        return result;
      });
    },
    /** Record the project the server holds after a load or reload. */
    markPersisted(project: Project | undefined): void {
      persisted = project;
    },
    whenIdle(): Promise<void> {
      return tail;
    },
  };
}

async function persistProject(project: Project): Promise<void> {
  editorStore.getState().setSaveState("saving");
  try {
    await saveProject(project);
    editorStore.getState().setSaveState("saved");
  } catch (error) {
    editorStore.getState().setSaveState("error", (error as Error).message);
    throw error;
  }
}

const projectSaves = createProjectSaveCoordinator(
  persistProject,
  () => editorStore.getState().project ?? undefined,
);

/** Mark a project just read from the server so an unchanged copy is never PUT back. */
export function markProjectPersisted(project: Project): void {
  projectSaves.markPersisted(project);
}

/** Persist the latest editor snapshot after all earlier saves/operations complete. */
export function saveLatestProject(): Promise<void> {
  return projectSaves.saveLatest();
}

/** The editor's shared debounced saver (300 ms) — persists inspector edits to disk. */
export const scheduleSave = createDebouncedSaver(() => saveLatestProject(), 300);

/** Commit a pending Inspector edit immediately (for blur, reload, and resource operations). */
export function flushScheduledSave(): Promise<void> {
  return scheduleSave.flush();
}

export function hasPendingProjectSave(): boolean {
  return scheduleSave.hasPending();
}

/** Cancel a queued stale snapshot before an operation performs its own awaited flush. */
export function cancelScheduledSave(): void {
  scheduleSave.cancel();
}

/**
 * Forget client persistence after the server may have switched projects without returning a usable
 * response. The active receiver must be verified before calling this; no stale Project is saved.
 */
export function discardActiveProjectPersistence(): void {
  cancelScheduledSave();
  clearProjectPersistenceIdentity();
  projectSaves.markPersisted(undefined);
  editorStore.getState().resetProjectState();
}

/**
 * Keep the old cookie active until every old-project save is durable. The activation callback may
 * change the cookie; client persistence is reset before this exclusive queue slot is released.
 */
export function switchActiveProject<T>(activate: () => Promise<T>): Promise<T> {
  cancelScheduledSave();
  return projectSaves.switchProject(activate, () => {
    discardActiveProjectPersistence();
  });
}

/**
 * Wait for earlier saves, flush the latest store snapshot, then keep later saves queued until
 * the operation has synchronized any durable server-side project mutation back into the store.
 */
export function withFlushedProject<T>(operation: () => Promise<T>): Promise<T> {
  cancelScheduledSave();
  return projectSaves.runFlushed(operation);
}

/**
 * Wait for every already-dispatched save, then keep later saves behind a lifecycle operation.
 * Callers must reject a still-buffered debounce before entering this barrier.
 */
export function withDrainedProjectSaves<T>(operation: () => Promise<T>): Promise<T> {
  return projectSaves.runExclusive(operation);
}
