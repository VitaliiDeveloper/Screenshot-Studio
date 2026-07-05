import type { Project } from "@screenshot-studio/core/model";
import { saveProject } from "./save-project.js";

/**
 * Returns a debounced version of `saveFn` that coalesces rapid calls into one, keeping only the
 * latest project. Inspector inputs fire per keystroke / slider tick (spec §3); this stops each
 * one becoming its own PUT while the store patch stays immediate.
 */
export function createDebouncedSaver(
  saveFn: (project: Project) => void,
  delayMs: number,
): (project: Project) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (project) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => saveFn(project), delayMs);
  };
}

/** The editor's shared debounced saver (300 ms) — persists inspector edits to disk. */
export const scheduleSave = createDebouncedSaver((p) => void saveProject(p), 300);
