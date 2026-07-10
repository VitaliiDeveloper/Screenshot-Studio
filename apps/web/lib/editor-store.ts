import { createStore } from "zustand/vanilla";
import { produce } from "immer";
import {
  cloneLocaleSet as cloneLocaleSetCore,
  cloneScreenWithFreshIds,
  recomputeManifests,
  removeLocaleSet as removeLocaleSetCore,
  setLocaleDirection as setLocaleDirectionCore,
  type Project,
  type Element,
  type TextElement,
  type ShapeElement,
  type ScreenshotElement,
  type DeviceFrameElement,
  type FontAsset,
  type LayoutDirection,
  type ThemeRole,
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
> & { role?: ThemeRole | null };

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
  if (patch.role !== undefined) {
    if (patch.role === null) delete el.role;
    else el.role = patch.role;
  }
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
  selectedScreenId: string | null;
  saveStatus: "idle" | "saving" | "saved" | "error";
  saveError: string | null;
  load: (project: Project) => void;
  setSaveState: (status: EditorState["saveStatus"], error?: string | null) => void;
  select: (id: string | null, screenId?: string) => void;
  patchElement: (id: string, patch: ElementPatch, screenId?: string) => void;
  selectScreen: (id: string) => void;
  selectLocale: (locale: string) => void;
  reorderScreensInLocale: (fromId: string, toId: string) => void;
  addScreen: () => void;
  removeScreen: (id: string) => void;
  addLocale: (sourceLocale: string, targetLocale: string, direction: LayoutDirection) => void;
  setLocaleDirection: (locale: string, direction: LayoutDirection) => void;
  removeLocale: (locale: string) => void;
  reorderElements: (from: number, to: number) => void;
  removeElement: (id: string, screenId?: string) => void;
  addElement: (element: Element) => void;
  patchBackground: (patch: { color: string }) => void;
  patchArtboard: (patch: { width?: number; height?: number }) => void;
  replaceFonts: (fonts: FontAsset[]) => void;
  replaceProject: (project: Project) => void;
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
  selectedScreenId: null,
  saveStatus: "idle",
  saveError: null,
  load: (project) =>
    set({
      project,
      activeScreenId: project.screens[0]?.id ?? null,
      selectedId: null,
      selectedScreenId: null,
      saveStatus: "idle",
      saveError: null,
    }),
  setSaveState: (saveStatus, saveError = null) => set({ saveStatus, saveError }),
  select: (id, screenId) => set((state) => {
    if (id === null) return { selectedId: null, selectedScreenId: null };
    const ownerScreenId = screenId ?? state.activeScreenId;
    if (!ownerScreenId) return state;
    return {
      selectedId: id,
      selectedScreenId: ownerScreenId,
      ...(state.project?.mode === "connected" ? { activeScreenId: ownerScreenId } : {}),
    };
  }),
  patchElement: (id, patch, screenId) =>
    set((state) => {
      if (!state.project) return state;
      const ownerScreenId = screenId
        ?? (state.selectedId === id ? state.selectedScreenId : null)
        ?? state.activeScreenId;
      if (!ownerScreenId) return state;
      const project = produce(state.project, (draft) => {
        const screen = draft.screens.find((candidate) => candidate.id === ownerScreenId);
        const element = screen?.elements.find((candidate) => candidate.id === id);
        if (element) applyElementPatch(element, patch);
      });
      return { project };
    }),
  selectScreen: (id) => set({ activeScreenId: id, selectedId: null, selectedScreenId: null }),
  selectLocale: (locale) =>
    set((state) => {
      const activeScreenId = state.project?.screens.find((screen) => screen.locale === locale)?.id;
      return activeScreenId ? { activeScreenId, selectedId: null, selectedScreenId: null } : state;
    }),
  reorderScreensInLocale: (fromId, toId) =>
    set((state) => {
      if (!state.project || fromId === toId) return state;
      const fromScreen = state.project.screens.find((screen) => screen.id === fromId);
      const toScreen = state.project.screens.find((screen) => screen.id === toId);
      if (!fromScreen || !toScreen || fromScreen.locale !== toScreen.locale) return state;
      const project = produce(state.project, (draft) => {
        const indices = draft.screens
          .map((screen, index) => screen.locale === fromScreen.locale ? index : -1)
          .filter((index) => index >= 0);
        const screens = indices.map((index) => draft.screens[index]!);
        const from = screens.findIndex((screen) => screen.id === fromId);
        const to = screens.findIndex((screen) => screen.id === toId);
        moveInPlace(screens, from, to);
        indices.forEach((index, position) => { draft.screens[index] = screens[position]!; });
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
      return { project, activeScreenId: copy.id, selectedId: null, selectedScreenId: null };
    }),
  removeScreen: (id) =>
    set((state) => {
      if (!state.project || state.project.screens.length <= 1) return state;
      const idx = state.project.screens.findIndex((s) => s.id === id);
      if (idx === -1) return state;
      const removed = state.project.screens[idx]!;
      const localeScreens = state.project.screens
        .filter((screen) => screen.locale === removed.locale);
      if (localeScreens.length <= 1) return state;
      const localeIndex = localeScreens.findIndex((screen) => screen.id === id);
      const screens = state.project.screens.filter((s) => s.id !== id);
      const project = recomputeManifests({ ...state.project, screens });
      const wasActive = state.activeScreenId === id;
      const sameLocale = project.screens.filter((screen) => screen.locale === removed.locale);
      const activeScreenId = wasActive
        ? (sameLocale[Math.min(localeIndex, sameLocale.length - 1)]
          ?? project.screens[Math.min(idx, project.screens.length - 1)])!.id
        : state.activeScreenId;
      const clearsSelection = state.selectedScreenId === id;
      const selectedId = clearsSelection ? null : state.selectedId;
      const selectedScreenId = clearsSelection ? null : state.selectedScreenId;
      return { project, activeScreenId, selectedId, selectedScreenId };
    }),
  addLocale: (sourceLocale, targetLocale, direction) =>
    set((state) => {
      if (!state.project) return state;
      const project = cloneLocaleSetCore(state.project, sourceLocale, targetLocale, direction);
      const activeScreenId = project.screens.find((screen) => screen.locale === targetLocale)!.id;
      return { project, activeScreenId, selectedId: null, selectedScreenId: null };
    }),
  setLocaleDirection: (locale, direction) =>
    set((state) => state.project
      ? { project: setLocaleDirectionCore(state.project, locale, direction) }
      : state),
  removeLocale: (locale) =>
    set((state) => {
      if (!state.project) return state;
      const activeScreen = state.project.screens.find((screen) => screen.id === state.activeScreenId);
      const project = removeLocaleSetCore(state.project, locale);
      if (activeScreen?.locale !== locale) return { project };
      return {
        project,
        activeScreenId: project.screens[0]!.id,
        selectedId: null,
        selectedScreenId: null,
      };
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
  removeElement: (id, screenId) =>
    set((state) => {
      if (!state.project) return state;
      const ownerScreenId = screenId
        ?? (state.selectedId === id ? state.selectedScreenId : null)
        ?? state.activeScreenId;
      if (!ownerScreenId) return state;
      const project = produce(state.project, (draft) => {
        const screen = draft.screens.find((s) => s.id === ownerScreenId);
        if (screen) screen.elements = screen.elements.filter((e) => e.id !== id);
      });
      const clearsSelection = state.selectedId === id && state.selectedScreenId === ownerScreenId;
      return {
        project,
        selectedId: clearsSelection ? null : state.selectedId,
        selectedScreenId: clearsSelection ? null : state.selectedScreenId,
      };
    }),
  addElement: (element) =>
    set((state) => {
      if (!state.project || !state.activeScreenId) return state;
      const project = produce(state.project, (draft) => {
        const screen = draft.screens.find((s) => s.id === state.activeScreenId);
        if (screen) screen.elements.push(element);
      });
      return { project, selectedId: element.id, selectedScreenId: state.activeScreenId };
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
  replaceProject: (project) =>
    set((state) => {
      const activeScreenId = project.screens.some((screen) => screen.id === state.activeScreenId)
        ? state.activeScreenId
        : project.screens[0]?.id ?? null;
      const selectedScreen = project.screens.find((screen) => screen.id === state.selectedScreenId);
      const selectedId = selectedScreen?.elements.some((element) => element.id === state.selectedId)
        ? state.selectedId
        : null;
      return {
        project,
        activeScreenId,
        selectedId,
        selectedScreenId: selectedId ? selectedScreen!.id : null,
      };
    }),
}));
