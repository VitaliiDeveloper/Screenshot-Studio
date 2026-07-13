# Phase 1 Slice 4 — Left panel (Screens + Layers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the editor's left panel — a Screens section (select · reorder · duplicate-add · delete) and a Layers section (select · reorder z-order · lock · hide · rename · delete) — writing all order into the project JSON that is the single source of truth.

**Architecture:** New store actions mutate `project.screens` / `screen.elements` arrays through Immer patches (store stays persistence-free). Reorder maps directly to array order: element order is z-order (consumed live today by `renderScreen`); screen order is the SoT that Phase 2's bundler will consume. React components (dnd-kit sortable) call the store, then a `mutateAndSave` wrapper persists via the existing `PUT /api/project` route.

**Tech Stack:** Next.js 15 + React 19, Zustand vanilla + Immer, Zod (core schema), dnd-kit (sortable lists), Vitest (unit), Playwright via `vitest.e2e.config.ts` (behavioral gate).

## Global Constraints

- Node.js 20+. `crypto.randomUUID()` is available (browser + Node 20+) — use it for new ids.
- Render/export parity is rule #1: never add a second render path; the new `name` field must never be read by `elementToNodeConfig`/`renderScreen`.
- Schema stays **v1** — the only change is an *additive optional* field. No migration.
- The store is the only writer of project state and must stay free of the network/persistence layer (its day-0 contract). Persistence lives in a UI-side wrapper.
- Element insertion is OUT (Slice 5 toolbar). Grouping, snapping, undo/redo UI, inspector are OUT.
- Layers list convention: **top-of-list = front-most = last in the `elements` array.**
- Commit style: `prefix: imperative subject`, no `Co-Authored-By` trailer.

---

### Task 1: Add optional `name` to the element schema

**Files:**
- Modify: `packages/core/src/model/schema.ts:22-33` (`elementBase`)
- Test: `packages/core/src/model/schema.test.ts`

**Interfaces:**
- Produces: every element type gains an optional `name?: string`. Existing JSON without `name` stays valid; `name` is metadata only (never rendered).

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/model/schema.test.ts`:

```ts
describe("element name (slice 4)", () => {
  it("accepts an element with an optional name", () => {
    const p = validProject();
    p.screens[0].elements[0].name = "Big headline";
    expect(() => parseProject(p)).not.toThrow();
    expect(parseProject(p).screens[0]!.elements[0]!.name).toBe("Big headline");
  });

  it("still accepts an element with no name (v1 stays valid)", () => {
    const p = validProject();
    delete p.screens[0].elements[0].name;
    expect(() => parseProject(p)).not.toThrow();
    expect(parseProject(p).screens[0]!.elements[0]!.name).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/model/schema.test.ts -t "element name"`
Expected: FAIL — the first test throws because `.strict()` rejects the unknown `name` key.

- [ ] **Step 3: Add the field**

In `packages/core/src/model/schema.ts`, add one line to `elementBase` (after `visible`):

```ts
const elementBase = {
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number().default(0),
  opacity: unitInterval.default(1),
  locked: z.boolean().default(false),
  visible: z.boolean().default(true),
  /** Layers-panel display label (slice 4). Metadata only — never rendered/exported. */
  name: z.string().optional(),
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/model/schema.test.ts`
Expected: PASS (new `name` tests + all existing schema tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/model/schema.ts packages/core/src/model/schema.test.ts
git commit -m "feat: add optional name field to the element schema"
```

---

### Task 2: Store — screen actions (select, reorder, add, remove)

**Files:**
- Modify: `apps/web/lib/editor-store.ts`
- Test: `apps/web/lib/editor-store.test.ts`

**Interfaces:**
- Consumes: existing `EditorState` (`project`, `activeScreenId`, `selectedId`, `load`, `select`, `patchElement`).
- Produces on `EditorState`:
  - `selectScreen(id: string): void` — sets `activeScreenId`, clears `selectedId`.
  - `reorderScreens(from: number, to: number): void` — moves within `project.screens`.
  - `addScreen(): void` — deep-clones the active screen (new screen id + new element ids), appends it, makes it active.
  - `removeScreen(id: string): void` — deletes; **no-op if it is the only screen**; if it was active, activates a neighbor and clears `selectedId`.
- Also adds a module-private `moveInPlace<T>(arr: T[], from: number, to: number): void`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/lib/editor-store.test.ts`. First extend the `project()` helper to have two screens so reorder/remove are meaningful — add a second screen after the existing `hero`:

```ts
// inside project(), replace the single-element `screens: [...]` with two screens:
    screens: [
      {
        id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
        artboard: { width: 660, height: 1434 },
        background: { type: "solid", color: "#000000" },
        elements: [{
          id: "headline", type: "text", x: 40, y: 100, width: 580, height: 200,
          rotation: 0, opacity: 1, locked: false, visible: true,
          content: "Hello", fontFamily: "Pacifico", size: 72, weight: 400,
          lineHeight: 1.2, letterSpacing: 0, align: "left", color: "#FFFFFF",
        }],
      },
      {
        id: "second", name: "Second", platform: "apple", device: "iphone", locale: "en",
        artboard: { width: 660, height: 1434 },
        background: { type: "solid", color: "#111111" },
        elements: [],
      },
    ],
```

Then add:

```ts
describe("editorStore screens (slice 4)", () => {
  beforeEach(() => {
    editorStore.setState({ project: null, activeScreenId: null, selectedId: null });
    editorStore.getState().load(project());
  });

  it("selectScreen sets active and clears selection", () => {
    editorStore.getState().select("headline");
    editorStore.getState().selectScreen("second");
    expect(editorStore.getState().activeScreenId).toBe("second");
    expect(editorStore.getState().selectedId).toBeNull();
  });

  it("reorderScreens moves a screen and preserves the source of truth order", () => {
    editorStore.getState().reorderScreens(0, 1);
    expect(editorStore.getState().project!.screens.map((s) => s.id)).toEqual(["second", "hero"]);
  });

  it("addScreen duplicates the active screen with fresh ids, appended and active", () => {
    const before = editorStore.getState().project!.screens.length;
    editorStore.getState().addScreen();
    const screens = editorStore.getState().project!.screens;
    expect(screens).toHaveLength(before + 1);
    const added = screens[screens.length - 1]!;
    expect(added.id).not.toBe("hero");
    expect(added.elements[0]!.id).not.toBe("headline"); // element id regenerated
    expect(added.elements[0]!.content).toBe("Hello");    // content copied
    expect(editorStore.getState().activeScreenId).toBe(added.id);
  });

  it("removeScreen deletes and reassigns active when the active screen goes", () => {
    editorStore.getState().removeScreen("hero"); // hero was active
    const screens = editorStore.getState().project!.screens;
    expect(screens.map((s) => s.id)).toEqual(["second"]);
    expect(editorStore.getState().activeScreenId).toBe("second");
  });

  it("removeScreen is a no-op on the last remaining screen", () => {
    editorStore.getState().removeScreen("second");
    editorStore.getState().removeScreen("hero"); // now the only one
    expect(editorStore.getState().project!.screens.map((s) => s.id)).toEqual(["hero"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/web/lib/editor-store.test.ts -t "screens (slice 4)"`
Expected: FAIL — `selectScreen`/`reorderScreens`/`addScreen`/`removeScreen` are not functions.

- [ ] **Step 3: Implement the screen actions**

In `apps/web/lib/editor-store.ts`, add the import and the `Screen` type, a `moveInPlace` helper, the interface methods, and the action bodies.

Update the import line:

```ts
import type { Project, Screen, TextElement } from "@screenshot-studio/core/model";
```

Add above `editorStore`:

```ts
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
```

Extend `EditorState` with the four signatures:

```ts
  selectScreen: (id: string) => void;
  reorderScreens: (from: number, to: number) => void;
  addScreen: () => void;
  removeScreen: (id: string) => void;
```

Add the action bodies inside `createStore(...)`:

```ts
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
      const active = state.project.screens.find((s) => s.id === state.activeScreenId)
        ?? state.project.screens[0];
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
        ? (project.screens[Math.min(idx, project.screens.length - 1)]!.id)
        : state.activeScreenId;
      const selectedId = wasActive ? null : state.selectedId;
      return { project, activeScreenId, selectedId };
    }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/web/lib/editor-store.test.ts`
Expected: PASS (new screen tests + existing store tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/editor-store.ts apps/web/lib/editor-store.test.ts
git commit -m "feat: add screen select/reorder/add/remove store actions"
```

---

### Task 3: Store — element actions (reorder, remove) + widen patch

**Files:**
- Modify: `apps/web/lib/editor-store.ts`
- Test: `apps/web/lib/editor-store.test.ts`

**Interfaces:**
- Consumes: `moveInPlace` (Task 2), `activeScreenId`.
- Produces on `EditorState`:
  - `reorderElements(from: number, to: number): void` — moves within the active screen's `elements` (array order = z-order).
  - `removeElement(id: string): void` — removes from the active screen; clears `selectedId` if it was selected.
  - Widened `ElementPatch` type now also accepts `locked | visible | name` (so `patchElement` powers lock/hide/rename). `patchElement` body is unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/lib/editor-store.test.ts`:

```ts
describe("editorStore elements (slice 4)", () => {
  beforeEach(() => {
    editorStore.setState({ project: null, activeScreenId: null, selectedId: null });
    editorStore.getState().load(project());
    // give the active screen a second element so reorder is observable
    editorStore.setState((s) => {
      const p = structuredClone(s.project!);
      p.screens[0]!.elements.push({
        id: "accent", type: "shape", x: 0, y: 0, width: 100, height: 100,
        rotation: 0, opacity: 1, locked: false, visible: true,
        kind: "rect", fill: "#FF0000", radius: 0,
      } as never);
      return { project: p };
    });
  });

  it("reorderElements changes z-order (array order)", () => {
    expect(editorStore.getState().project!.screens[0]!.elements.map((e) => e.id))
      .toEqual(["headline", "accent"]);
    editorStore.getState().reorderElements(0, 1);
    expect(editorStore.getState().project!.screens[0]!.elements.map((e) => e.id))
      .toEqual(["accent", "headline"]);
  });

  it("removeElement drops the element and clears matching selection", () => {
    editorStore.getState().select("accent");
    editorStore.getState().removeElement("accent");
    expect(editorStore.getState().project!.screens[0]!.elements.map((e) => e.id))
      .toEqual(["headline"]);
    expect(editorStore.getState().selectedId).toBeNull();
  });

  it("patchElement can set locked, visible and name", () => {
    editorStore.getState().patchElement("headline", { locked: true, visible: false, name: "Big" });
    const el = editorStore.getState().project!.screens[0]!.elements
      .find((e) => e.id === "headline")!;
    expect(el).toMatchObject({ locked: true, visible: false, name: "Big" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/web/lib/editor-store.test.ts -t "elements (slice 4)"`
Expected: FAIL — `reorderElements`/`removeElement` undefined; the `name` patch fails to type-check / is dropped.

- [ ] **Step 3: Widen the patch type and add the actions**

In `apps/web/lib/editor-store.ts`, widen `ElementPatch`:

```ts
export type ElementPatch = Partial<
  Pick<
    TextElement,
    "x" | "y" | "width" | "height" | "rotation" | "content" | "locked" | "visible" | "name"
  >
>;
```

Extend `EditorState`:

```ts
  reorderElements: (from: number, to: number) => void;
  removeElement: (id: string) => void;
```

Add the action bodies:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/web/lib/editor-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/editor-store.ts apps/web/lib/editor-store.test.ts
git commit -m "feat: add element reorder/remove store actions and widen the patch type"
```

---

### Task 4: UI helpers — label + reversed-list index mapping

**Files:**
- Create: `apps/web/lib/panel-helpers.ts`
- Create: `apps/web/lib/mutate-and-save.ts`
- Test: `apps/web/lib/panel-helpers.test.ts`

**Interfaces:**
- Produces:
  - `elementLabel(el: { type: string; name?: string }): string` — `el.name` (trimmed) if non-empty, else a human type label.
  - `viewToArrayIndex(len: number, viewIndex: number): number` — the layers list is rendered reversed (top = front = last in array); this maps a visible-row index back to the `elements` array index. Returns `len - 1 - viewIndex`.
  - `mutateAndSave(mutate: () => void): void` — runs a store mutation then persists the resulting project via `saveProject`. Keeps persistence out of the store.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/panel-helpers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { elementLabel, viewToArrayIndex } from "./panel-helpers.js";

describe("elementLabel", () => {
  it("uses the name when present", () => {
    expect(elementLabel({ type: "text", name: "Headline" })).toBe("Headline");
  });
  it("falls back to a type label when name is empty/absent", () => {
    expect(elementLabel({ type: "device-frame" })).toBe("Device frame");
    expect(elementLabel({ type: "text", name: "   " })).toBe("Text");
  });
});

describe("viewToArrayIndex (reversed layers list)", () => {
  // 3 elements [A,B,C]; rendered top→bottom as C,B,A (index 0,1,2).
  it("maps the top visible row to the last array element", () => {
    expect(viewToArrayIndex(3, 0)).toBe(2); // top row = C = array index 2
    expect(viewToArrayIndex(3, 2)).toBe(0); // bottom row = A = array index 0
  });
  it("a drag from visual-top to visual-bottom yields the correct array move", () => {
    // dragging the top row (view 0) to the bottom (view 2) = array move 2 -> 0
    expect([viewToArrayIndex(3, 0), viewToArrayIndex(3, 2)]).toEqual([2, 0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/web/lib/panel-helpers.test.ts`
Expected: FAIL — module `./panel-helpers.js` not found.

- [ ] **Step 3: Implement the helpers**

Create `apps/web/lib/panel-helpers.ts`:

```ts
/** Human-readable fallback labels for the layers panel (name overrides these). */
const TYPE_LABELS: Record<string, string> = {
  text: "Text",
  shape: "Shape",
  screenshot: "Screenshot",
  "device-frame": "Device frame",
  icon: "Icon",
  badge: "Badge",
  image: "Image",
};

/** The row label for a layer: its name if set, otherwise a human type label. */
export function elementLabel(el: { type: string; name?: string }): string {
  const trimmed = el.name?.trim();
  return trimmed ? trimmed : (TYPE_LABELS[el.type] ?? el.type);
}

/**
 * The layers list renders reversed — top-of-list is the front-most element, i.e. the LAST item
 * in `screen.elements`. This maps a visible-row index back to its `elements` array index.
 */
export function viewToArrayIndex(len: number, viewIndex: number): number {
  return len - 1 - viewIndex;
}
```

Create `apps/web/lib/mutate-and-save.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/web/lib/panel-helpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/panel-helpers.ts apps/web/lib/panel-helpers.test.ts apps/web/lib/mutate-and-save.ts
git commit -m "feat: add panel label/index helpers and the mutate-and-save wrapper"
```

---

### Task 5: Left panel components + two-column layout

**Files:**
- Modify: `apps/web/package.json` (add dnd-kit deps)
- Create: `apps/web/components/LeftPanel.tsx`
- Create: `apps/web/components/ScreensSection.tsx`
- Create: `apps/web/components/LayersSection.tsx`
- Create: `apps/web/components/SortableRow.tsx`
- Modify: `apps/web/app/editor/page.tsx` (two-column layout)

**Interfaces:**
- Consumes: `editorStore` actions (Tasks 2–3), `mutateAndSave`, `elementLabel`, `viewToArrayIndex` (Task 4), `getScreen` from `@screenshot-studio/core/model`.
- Produces: `LeftPanel` (default export a named `LeftPanel`), rendered by `page.tsx` beside `EditorStage`. No new store API.

- [ ] **Step 1: Add the dnd-kit dependencies**

Edit `apps/web/package.json` `dependencies` (add three lines, keep alphabetical-ish order):

```json
    "@dnd-kit/core": "^6.3.1",
    "@dnd-kit/sortable": "^10.0.0",
    "@dnd-kit/utilities": "^3.2.2",
```

Then install:

Run: `pnpm install`
Expected: lockfile updates; dnd-kit packages resolved under `apps/web`.

- [ ] **Step 2: Create the shared sortable row**

Create `apps/web/components/SortableRow.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/**
 * One draggable row for a sortable list. The drag handle is a dedicated span (so buttons/inputs
 * inside the row stay clickable); a KeyboardSensor on the parent DndContext makes the handle
 * focusable and reorderable with the keyboard (also what the e2e drives, deterministically).
 */
export function SortableRow({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 px-2 py-1">
      <span
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="cursor-grab select-none text-neutral-400"
      >
        ⠿
      </span>
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Create the Screens section**

Create `apps/web/components/ScreensSection.tsx`:

```tsx
"use client";

import { useStore } from "zustand";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { editorStore } from "../lib/editor-store";
import { mutateAndSave } from "../lib/mutate-and-save";
import { SortableRow } from "./SortableRow";

/** Screens list: select active, dnd reorder (= project.screens order), duplicate-add, delete. */
export function ScreensSection() {
  const project = useStore(editorStore, (s) => s.project);
  const activeScreenId = useStore(editorStore, (s) => s.activeScreenId);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  if (!project) return null;
  const screens = project.screens;

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = screens.findIndex((s) => s.id === e.active.id);
    const to = screens.findIndex((s) => s.id === e.over!.id);
    mutateAndSave(() => editorStore.getState().reorderScreens(from, to));
  };

  const onDelete = (id: string, name: string) => {
    if (screens.length <= 1) return; // last screen is not deletable
    if (!window.confirm(`Delete screen "${name}" and all its layers?`)) return;
    mutateAndSave(() => editorStore.getState().removeScreen(id));
  };

  return (
    <section className="border-b border-neutral-200">
      <header className="flex items-center justify-between px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Screens</h2>
        <button
          onClick={() => mutateAndSave(() => editorStore.getState().addScreen())}
          className="rounded px-2 py-0.5 text-sm text-blue-600 hover:bg-blue-50"
        >
          + Add
        </button>
      </header>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={screens.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {screens.map((s) => (
            <SortableRow key={s.id} id={s.id}>
              <button
                onClick={() => editorStore.getState().selectScreen(s.id)}
                className={`flex-1 truncate text-left text-sm ${
                  s.id === activeScreenId ? "font-semibold text-blue-700" : "text-neutral-700"
                }`}
              >
                {s.name} <span className="text-neutral-400">· {s.device}</span>
              </button>
              <button
                onClick={() => onDelete(s.id, s.name)}
                disabled={screens.length <= 1}
                aria-label={`Delete ${s.name}`}
                className="text-neutral-400 hover:text-red-600 disabled:opacity-30"
              >
                ✕
              </button>
            </SortableRow>
          ))}
        </SortableContext>
      </DndContext>
    </section>
  );
}
```

- [ ] **Step 4: Create the Layers section**

Create `apps/web/components/LayersSection.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useStore } from "zustand";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { getScreen } from "@screenshot-studio/core/model";
import { editorStore, type ElementPatch } from "../lib/editor-store";
import { mutateAndSave } from "../lib/mutate-and-save";
import { elementLabel, viewToArrayIndex } from "../lib/panel-helpers";
import { SortableRow } from "./SortableRow";

/** Layers list for the active screen. Rendered reversed: top row = front-most = last in array. */
export function LayersSection() {
  const project = useStore(editorStore, (s) => s.project);
  const activeScreenId = useStore(editorStore, (s) => s.activeScreenId);
  const selectedId = useStore(editorStore, (s) => s.selectedId);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  if (!project || !activeScreenId) return null;
  const elements = getScreen(project, activeScreenId).elements;
  const rows = [...elements].reverse(); // top-of-list = front-most
  const len = elements.length;

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const fromView = rows.findIndex((el) => el.id === e.active.id);
    const toView = rows.findIndex((el) => el.id === e.over!.id);
    mutateAndSave(() =>
      editorStore.getState().reorderElements(viewToArrayIndex(len, fromView), viewToArrayIndex(len, toView)),
    );
  };

  const patch = (id: string, p: ElementPatch) =>
    mutateAndSave(() => editorStore.getState().patchElement(id, p));

  return (
    <section>
      <header className="px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Layers</h2>
      </header>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={rows.map((el) => el.id)} strategy={verticalListSortingStrategy}>
          {rows.map((el) => (
            <SortableRow key={el.id} id={el.id}>
              {renaming?.id === el.id ? (
                <input
                  autoFocus
                  value={renaming.value}
                  onChange={(ev) => setRenaming({ id: el.id, value: ev.target.value })}
                  onBlur={() => { patch(el.id, { name: renaming.value }); setRenaming(null); }}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") { patch(el.id, { name: renaming.value }); setRenaming(null); }
                    if (ev.key === "Escape") setRenaming(null);
                  }}
                  className="flex-1 border border-blue-500 px-1 text-sm"
                />
              ) : (
                <button
                  onClick={() => editorStore.getState().select(el.id)}
                  onDoubleClick={() => setRenaming({ id: el.id, value: el.name ?? "" })}
                  className={`flex-1 truncate text-left text-sm ${
                    el.id === selectedId ? "font-semibold text-blue-700" : "text-neutral-700"
                  } ${el.visible ? "" : "text-neutral-400 line-through"}`}
                >
                  {elementLabel(el)}
                </button>
              )}
              <button
                onClick={() => patch(el.id, { visible: !el.visible })}
                aria-label={el.visible ? "Hide layer" : "Show layer"}
                className="text-neutral-400 hover:text-neutral-700"
              >
                {el.visible ? "👁" : "🚫"}
              </button>
              <button
                onClick={() => patch(el.id, { locked: !el.locked })}
                aria-label={el.locked ? "Unlock layer" : "Lock layer"}
                className="text-neutral-400 hover:text-neutral-700"
              >
                {el.locked ? "🔒" : "🔓"}
              </button>
              <button
                onClick={() => mutateAndSave(() => editorStore.getState().removeElement(el.id))}
                aria-label="Delete layer"
                className="text-neutral-400 hover:text-red-600"
              >
                ✕
              </button>
            </SortableRow>
          ))}
        </SortableContext>
      </DndContext>
    </section>
  );
}
```

- [ ] **Step 5: Create LeftPanel and wire the layout**

Create `apps/web/components/LeftPanel.tsx`:

```tsx
"use client";

import { ScreensSection } from "./ScreensSection";
import { LayersSection } from "./LayersSection";

/** The editor's left panel: Screens on top, Layers below (active screen). */
export function LeftPanel() {
  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-neutral-200 bg-white">
      <ScreensSection />
      <LayersSection />
    </aside>
  );
}
```

Rewrite `apps/web/app/editor/page.tsx`'s returned JSX (keep the load effect and guards untouched) to a two-column layout:

```tsx
  if (error) return <main className="p-6 text-red-600 whitespace-pre-wrap">{error}</main>;
  if (!images) return <main className="p-6 text-neutral-500">Loading…</main>;
  return (
    <main className="flex h-screen w-full">
      <LeftPanel />
      <div className="flex-1 overflow-auto bg-neutral-100 p-8">
        <EditorStage images={images} />
      </div>
    </main>
  );
```

Add the import near the top of `page.tsx`:

```tsx
import { LeftPanel } from "../../components/LeftPanel";
```

- [ ] **Step 6: Verify it type-checks and builds**

Run: `pnpm --filter @screenshot-studio/web typecheck`
Expected: PASS (no type errors).

Run: `pnpm --filter @screenshot-studio/web build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/components/ apps/web/app/editor/page.tsx
git commit -m "feat: add the screens/layers left panel to the editor"
```

---

### Task 6: e2e — layer reorder round-trips to disk

**Files:**
- Create: `e2e/left-panel.test.ts`

**Interfaces:**
- Consumes: `startWebServer` (`packages/cli/src/server.js`), the `fixtures/phase-0-sample` project (screen `hero` with `accent` shape + `headline` text), the running editor with the new panel.
- Produces: a behavioral gate proving a Layers reorder persists the new `elements` order to the on-disk JSON — the live z-order/export ordering contract.

- [ ] **Step 1: Write the failing test**

Create `e2e/left-panel.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

/**
 * Slice 4 gate: reordering a layer in the panel persists the new `elements` array order (= z-order)
 * to the on-disk JSON. Reorder is driven via dnd-kit's KeyboardSensor for determinism (no pixel
 * drag). Runs against a temp copy so the committed fixture is untouched.
 */
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sample = resolve(repoRoot, "fixtures/phase-0-sample/app-store-screenshots.json");

let server: RunningServer;
let browser: Browser;
let dir: string;
let projectFile: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "left-panel-e2e-"));
  projectFile = join(dir, "app-store-screenshots.json");
  writeFileSync(projectFile, readFileSync(sample, "utf8"));
  process.env.PROJECT_PATH = projectFile;
  server = await startWebServer(3125);
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop();
  delete process.env.PROJECT_PATH;
  rmSync(dir, { recursive: true, force: true });
});

function elementIds(): string[] {
  const p = JSON.parse(readFileSync(projectFile, "utf8"));
  return p.screens[0].elements.map((e: { id: string }) => e.id);
}

describe("left panel", () => {
  it("reordering a layer persists the new element order to disk", async () => {
    const before = elementIds(); // ["accent", "headline"]
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    // Focus the first layer row's drag handle and move it down one slot with the keyboard.
    const handle = page.getByLabel("Drag to reorder").first();
    await handle.waitFor();
    await handle.focus();
    await page.keyboard.press("Space");      // pick up
    await page.keyboard.press("ArrowDown");  // move one position
    await page.keyboard.press("Space");      // drop
    await expect.poll(() => elementIds().join(","), { timeout: 10_000 })
      .not.toBe(before.join(","));
    expect(elementIds().sort()).toEqual(before.slice().sort()); // same set, new order
    await page.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `pnpm test:e2e -- e2e/left-panel.test.ts`
Expected: PASS. (If dnd-kit's keyboard move needs an extra `ArrowDown`, adjust the key sequence — the assertion only requires the order to change to a valid permutation.)

Note: this is the first run of a new e2e, so "verify it fails first" is not meaningful (the file didn't exist). The failing-then-passing cycle for the underlying behavior is covered by the Task 2–4 unit tests; this task's value is the integration gate.

- [ ] **Step 3: Confirm export parity is untouched**

The schema change is additive and non-rendering, but this slice touches shared contracts, so run the existing parity gate once:

Run: `pnpm test:e2e -- e2e/parity.test.ts`
Expected: PASS — pixel output within tolerance, dimensions exact (the `name` field changes nothing).

- [ ] **Step 4: Commit**

```bash
git add e2e/left-panel.test.ts
git commit -m "test: add left-panel layer-reorder persistence e2e"
```

---

## Self-Review

**Spec coverage:**
- Screens: select (Task 2 `selectScreen`, Task 5 wiring) · reorder (Task 2 + Task 5) · add-duplicate (Task 2 `addScreen`) · delete w/ confirm + last-blocked (Task 2 `removeScreen`, Task 5 `window.confirm`/disabled) ✓
- Layers: select (Task 3/5) · reorder z-order reversed (Task 3 `reorderElements`, Task 4 `viewToArrayIndex`, Task 5) · lock/hide/rename (Task 3 widened patch, Task 5 toggles/inline input) · delete (Task 3 `removeElement`) · no insertion ✓
- Schema additive `name` (Task 1) ✓
- Persistence via `mutateAndSave`, store stays pure (Task 4) ✓
- Tests: store units (Tasks 2–3), reversed index-mapping unit (Task 4), layer-reorder e2e + parity gate (Task 6) ✓

**Placeholder scan:** No TODO/TBD/"implement later"; every code step shows final code. `patch` uses the imported `ElementPatch` type directly.

**Type consistency:** `reorderScreens/reorderElements(from,to)`, `addScreen()`, `removeScreen(id)`, `removeElement(id)`, `selectScreen(id)`, `ElementPatch` (widened), `elementLabel`, `viewToArrayIndex(len,i)`, `mutateAndSave(fn)` are used identically across Tasks 2–6.

**Screen reorder honesty:** No task claims a live multi-screen export effect — screen order is persisted to `project.screens` (SoT) only; Phase 2 consumes it. Matches the spec.
