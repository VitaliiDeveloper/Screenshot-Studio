import { createStore } from "zustand/vanilla";
import { produce } from "immer";
import type { Project, TextElement } from "@screenshot-studio/core/model";

/**
 * Editor state as a framework-agnostic Zustand vanilla store, bound to React via `useStore` in
 * components. Every mutation goes through Immer, so each change is a discrete immutable patch —
 * the day-0 requirement (roadmap.md §1) that lets undo/redo be added later without a rewrite.
 * The store is the only writer of project state; the canvas dispatches actions, never mutates.
 */
export type ElementPatch = Partial<
  Pick<TextElement, "x" | "y" | "width" | "height" | "rotation" | "content">
>;

export interface EditorState {
  project: Project | null;
  activeScreenId: string | null;
  selectedId: string | null;
  load: (project: Project) => void;
  select: (id: string | null) => void;
  patchElement: (id: string, patch: ElementPatch) => void;
}

export const editorStore = createStore<EditorState>((set) => ({
  project: null,
  activeScreenId: null,
  selectedId: null,
  load: (project) =>
    set({ project, activeScreenId: project.screens[0]?.id ?? null, selectedId: null }),
  select: (id) => set({ selectedId: id }),
  patchElement: (id, patch) =>
    set((state) => {
      if (!state.project) return state;
      const project = produce(state.project, (draft) => {
        for (const screen of draft.screens) {
          const el = screen.elements.find((e) => e.id === id);
          if (el) Object.assign(el, patch);
        }
      });
      return { project };
    }),
}));
