import type { Project } from "@screenshot-studio/core/model";
import { editorStore } from "./editor-store.js";
import { saveProject } from "./save-project.js";

/**
 * Returns a debounced version of `saveFn` that coalesces rapid calls into one, keeping only the
 * latest project. Inspector inputs fire per keystroke / slider tick (spec §3); this stops each
 * one becoming its own PUT while the store patch stays immediate.
 */
export function createDebouncedSaver(
  saveFn: (project: Project) => void | Promise<void>,
  delayMs: number,
): ((project: Project) => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (project: Project) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      saveFn(project);
    }, delayMs);
  };
  schedule.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  return schedule;
}

export function createProjectSaveCoordinator(
  saveFn: (project: Project) => Promise<void>,
  getLatestProject: () => Project | undefined,
) {
  let tail: Promise<void> = Promise.resolve();

  const runExclusive = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };

  return {
    /** Enqueue a save that reads the latest store state only when it reaches the front. */
    saveLatest(): Promise<void> {
      return runExclusive(async () => {
        const project = getLatestProject();
        if (project) await saveFn(project);
      });
    },
    runExclusive,
    whenIdle(): Promise<void> {
      return tail;
    },
  };
}

const projectSaves = createProjectSaveCoordinator(
  saveProject,
  () => editorStore.getState().project ?? undefined,
);

/** Persist the latest editor snapshot after all earlier saves/operations complete. */
export function saveLatestProject(): Promise<void> {
  return projectSaves.saveLatest();
}

/** The editor's shared debounced saver (300 ms) — persists inspector edits to disk. */
export const scheduleSave = createDebouncedSaver(() => void saveLatestProject(), 300);

/** Cancel a queued stale snapshot before an operation performs its own awaited flush. */
export function cancelScheduledSave(): void {
  scheduleSave.cancel();
}

/**
 * Wait for earlier saves, flush the latest store snapshot, then keep later saves queued until
 * the operation has synchronized any durable server-side project mutation back into the store.
 */
export function withFlushedProject<T>(operation: () => Promise<T>): Promise<T> {
  cancelScheduledSave();
  return projectSaves.runExclusive(async () => {
    const project = editorStore.getState().project;
    if (!project) throw new Error("No project loaded");
    await saveProject(project);
    return operation();
  });
}
