import { editorStore } from "./editor-store.js";
import { scheduleSave } from "./debounced-save.js";
import { saveProject } from "./save-project.js";

/**
 * Persistence helpers for the editor. The store stays free of the network layer; every UI
 * mutation that should hit disk goes through one of these two paths (not ad-hoc saveProject).
 * ExportDialog may still call saveProject directly when it must flush before export.
 */

/** Discrete actions (toolbar insert, canvas drag-end, layer reorder/delete, screen CRUD). */
export function mutateAndSave(mutate: () => void): void {
  mutate();
  const next = editorStore.getState().project;
  if (next) void saveProject(next);
}

/** Continuous inputs (inspector keystrokes / sliders) — coalesced via scheduleSave. */
export function mutateAndScheduleSave(mutate: () => void): void {
  mutate();
  const next = editorStore.getState().project;
  if (next) scheduleSave(next);
}
