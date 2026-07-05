import { createStore } from "zustand/vanilla";
import { produce } from "immer";
import type { Project, Screen, TextElement } from "@screenshot-studio/core/model";

/**
 * Editor state as a framework-agnostic Zustand vanilla store, bound to React via `useStore` in
 * components. Every mutation goes through Immer, so each change is a discrete immutable patch —
 * the day-0 requirement (roadmap.md §1) that lets undo/redo be added later without a rewrite.
 * The store is the only writer of project state; the canvas dispatches actions, never mutates.
 */
export type ElementPatch = Partial<
  Pick<
    TextElement,
    "x" | "y" | "width" | "height" | "rotation" | "content" | "locked" | "visible" | "name"
  >
>;

export interface EditorState {
  project: Project | null;
  activeScreenId: string | null;
  selectedId: string | null;
  load: (project: Project) => void;
  select: (id: string | null) => void;
  patchElement: (id: string, patch: ElementPatch) => void;
  selectScreen: (id: string) => void;
  reorderScreens: (from: number, to: number) => void;
  addScreen: () => void;
  removeScreen: (id: string) => void;
  reorderElements: (from: number, to: number) => void;
  removeElement: (id: string) => void;
}

/** In-place array move for Immer drafts (arrayMove returns a new array; drafts want mutation). */
function moveInPlace<T>(arr: T[], from: number, to: number): void {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return;
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item as T);
}

/** Deep-clone a screen with a fresh screen id and fresh element ids (used by addScreen). */
function cloneScreen(src: Screen): Screen {
  const copy = structuredClone(src) as Screen;
  copy.id = crypto.randomUUID();
  copy.name = `${src.name} copy`;
  copy.elements = copy.elements.map((el) => ({ ...el, id: crypto.randomUUID() }));
  return copy;
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
  selectScreen: (id) => set({ activeScreenId: id, selectedId: null }),
  reorderScreens: (from, to) =>
    set((state) => {
      if (!state.project) return state;
      const project = produce(state.project, (draft) => {
        moveInPlace(draft.screens, from, to);
      });
      return { project };
    }),
  addScreen: () =>
    set((state) => {
      if (!state.project) return state;
      const active =
        state.project.screens.find((s) => s.id === state.activeScreenId) ??
        state.project.screens[0];
      if (!active) return state;
      const copy = cloneScreen(active);
      const project = produce(state.project, (draft) => {
        draft.screens.push(copy);
      });
      return { project, activeScreenId: copy.id, selectedId: null };
    }),
  removeScreen: (id) =>
    set((state) => {
      if (!state.project || state.project.screens.length <= 1) return state;
      const idx = state.project.screens.findIndex((s) => s.id === id);
      if (idx === -1) return state;
      const project = produce(state.project, (draft) => {
        draft.screens.splice(idx, 1);
      });
      const wasActive = state.activeScreenId === id;
      const activeScreenId = wasActive
        ? project.screens[Math.min(idx, project.screens.length - 1)]!.id
        : state.activeScreenId;
      const selectedId = wasActive ? null : state.selectedId;
      return { project, activeScreenId, selectedId };
    }),
  reorderElements: (from, to) =>
    set((state) => {
      if (!state.project || !state.activeScreenId) return state;
      const project = produce(state.project, (draft) => {
        const screen = draft.screens.find((s) => s.id === state.activeScreenId);
        if (screen) moveInPlace(screen.elements, from, to);
      });
      return { project };
    }),
  removeElement: (id) =>
    set((state) => {
      if (!state.project || !state.activeScreenId) return state;
      const project = produce(state.project, (draft) => {
        const screen = draft.screens.find((s) => s.id === state.activeScreenId);
        if (screen) screen.elements = screen.elements.filter((e) => e.id !== id);
      });
      const selectedId = state.selectedId === id ? null : state.selectedId;
      return { project, selectedId };
    }),
}));
