import { createStore } from "zustand/vanilla";
import { produce } from "immer";
import {
  cloneScreenWithFreshIds,
  recomputeManifests,
  type Project,
  type Element,
  type TextElement,
  type ShapeElement,
  type ScreenshotElement,
  type DeviceFrameElement,
  type FontAsset,
} from "@screenshot-studio/core/model";

/**
 * Editor state as a framework-agnostic Zustand vanilla store, bound to React via `useStore` in
 * components. Every mutation goes through Immer, so each change is a discrete immutable patch —
 * the day-0 requirement (roadmap.md §1) that lets undo/redo be added later without a rewrite.
 * The store is the only writer of project state; the canvas dispatches actions, never mutates.
 */

/** Geometry / layer metadata shared by every element type. */
export type CommonElementPatch = Partial<
  Pick<Element, "x" | "y" | "width" | "height" | "rotation" | "opacity" | "locked" | "visible" | "name">
>;

type TextFields = Partial<
  Pick<
    TextElement,
    "content" | "fontFamily" | "size" | "weight" | "lineHeight" | "letterSpacing" | "align" | "color"
  >
>;
type ShapeFields = Partial<Pick<ShapeElement, "fill" | "radius">>;
type ScreenshotFields = Partial<Pick<ScreenshotElement, "assetUrl" | "fit" | "cornerRadius">>;
type DeviceFrameFields = Partial<Pick<DeviceFrameElement, "assetUrl" | "fit">>;

/**
 * Call-site convenience: common fields plus optional type-specific fields.
 * Runtime apply only writes keys valid for the live element's `type` — a `fill` on a text
 * element is ignored, never Object.assigned onto the wrong shape.
 */
export type ElementPatch = CommonElementPatch &
  TextFields &
  ShapeFields &
  ScreenshotFields &
  DeviceFrameFields;

function applyCommonPatch(el: Element, patch: CommonElementPatch): void {
  if (patch.x !== undefined) el.x = patch.x;
  if (patch.y !== undefined) el.y = patch.y;
  if (patch.width !== undefined) el.width = patch.width;
  if (patch.height !== undefined) el.height = patch.height;
  if (patch.rotation !== undefined) el.rotation = patch.rotation;
  if (patch.opacity !== undefined) el.opacity = patch.opacity;
  if (patch.locked !== undefined) el.locked = patch.locked;
  if (patch.visible !== undefined) el.visible = patch.visible;
  if (patch.name !== undefined) el.name = patch.name;
}

/** Apply only fields legal for this element's type (no blind Object.assign). */
export function applyElementPatch(el: Element, patch: ElementPatch): void {
  applyCommonPatch(el, patch);
  switch (el.type) {
    case "text":
      if (patch.content !== undefined) el.content = patch.content;
      if (patch.fontFamily !== undefined) el.fontFamily = patch.fontFamily;
      if (patch.size !== undefined) el.size = patch.size;
      if (patch.weight !== undefined) el.weight = patch.weight;
      if (patch.lineHeight !== undefined) el.lineHeight = patch.lineHeight;
      if (patch.letterSpacing !== undefined) el.letterSpacing = patch.letterSpacing;
      if (patch.align !== undefined) el.align = patch.align;
      if (patch.color !== undefined) el.color = patch.color;
      break;
    case "shape":
      if (patch.fill !== undefined) el.fill = patch.fill;
      if (patch.radius !== undefined) el.radius = patch.radius;
      break;
    case "screenshot":
      if (patch.assetUrl !== undefined) el.assetUrl = patch.assetUrl;
      if (patch.fit !== undefined) el.fit = patch.fit;
      if (patch.cornerRadius !== undefined) el.cornerRadius = patch.cornerRadius;
      break;
    case "device-frame":
      if (patch.assetUrl !== undefined) el.assetUrl = patch.assetUrl;
      if (patch.fit !== undefined) el.fit = patch.fit;
      break;
  }
}

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
  addElement: (element: Element) => void;
  patchBackground: (patch: { color: string }) => void;
  patchArtboard: (patch: { width?: number; height?: number }) => void;
  replaceFonts: (fonts: FontAsset[]) => void;
}

/** In-place array move for Immer drafts (arrayMove returns a new array; drafts want mutation). */
function moveInPlace<T>(arr: T[], from: number, to: number): void {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return;
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item as T);
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
          if (el) applyElementPatch(el, patch);
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
      const copy = cloneScreenWithFreshIds(active);
      const project = recomputeManifests({
        ...state.project,
        screens: [...state.project.screens, copy],
      });
      return { project, activeScreenId: copy.id, selectedId: null };
    }),
  removeScreen: (id) =>
    set((state) => {
      if (!state.project || state.project.screens.length <= 1) return state;
      const idx = state.project.screens.findIndex((s) => s.id === id);
      if (idx === -1) return state;
      const screens = state.project.screens.filter((s) => s.id !== id);
      const project = recomputeManifests({ ...state.project, screens });
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
  addElement: (element) =>
    set((state) => {
      if (!state.project || !state.activeScreenId) return state;
      const project = produce(state.project, (draft) => {
        const screen = draft.screens.find((s) => s.id === state.activeScreenId);
        if (screen) screen.elements.push(element);
      });
      return { project, selectedId: element.id };
    }),
  patchBackground: (patch) =>
    set((state) => {
      if (!state.project || !state.activeScreenId) return state;
      const project = produce(state.project, (draft) => {
        const screen = draft.screens.find((s) => s.id === state.activeScreenId);
        if (screen && screen.background.type === "solid") Object.assign(screen.background, patch);
      });
      return { project };
    }),
  patchArtboard: (patch) =>
    set((state) => {
      if (!state.project || !state.activeScreenId) return state;
      const project = produce(state.project, (draft) => {
        const screen = draft.screens.find((s) => s.id === state.activeScreenId);
        if (screen) Object.assign(screen.artboard, patch);
      });
      return { project };
    }),
  replaceFonts: (fonts) =>
    set((state) => {
      if (!state.project) return state;
      return { project: { ...state.project, fonts } };
    }),
}));
