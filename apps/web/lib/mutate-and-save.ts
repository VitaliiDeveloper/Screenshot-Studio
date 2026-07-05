import { editorStore } from "./editor-store.js";
import { saveProject } from "./save-project.js";

/**
 * Run a store mutation, then persist the new project to disk. Persistence lives here (UI side),
 * never in the store — the store stays free of the network layer (its day-0 contract). Mirrors
 * the existing EditorStage.commit pattern so every panel action round-trips to the JSON.
 */
export function mutateAndSave(mutate: () => void): void {
  mutate();
  const next = editorStore.getState().project;
  if (next) void saveProject(next);
}
