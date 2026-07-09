import { editorStore } from "./editor-store.js";
import { saveLatestProject, scheduleSave } from "./debounced-save.js";

/**
 * Persistence helpers for the editor. The store stays free of the network layer; every UI
 * mutation that should hit disk goes through the shared serialized save coordinator.
 */

/** Discrete actions (toolbar insert, canvas drag-end, layer reorder/delete, screen CRUD). */
export function mutateAndSave(mutate: () => void): void {
  mutate();
  const next = editorStore.getState().project;
  if (next) void saveLatestProject();
}

/** Continuous inputs (inspector keystrokes / sliders) — coalesced via scheduleSave. */
export function mutateAndScheduleSave(mutate: () => void): void {
  mutate();
  const next = editorStore.getState().project;
  if (next) scheduleSave(next);
}
