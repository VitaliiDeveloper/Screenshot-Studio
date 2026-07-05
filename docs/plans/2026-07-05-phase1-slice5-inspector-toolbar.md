# Phase 1 Slice 5 — Inspector + toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the editor's right-hand inspector, a toolbar (insert `text`/`shape` + zoom), and a no-selection artboard/background editor — completing the Phase 1 web-editor basics.

**Architecture:** `core` gains pure default-element factories (shared with a future CLI). The Zustand store widens `ElementPatch` and gains `addElement`/`patchBackground`/`patchArtboard`, all Immer patches (store stays persistence-free). React components (Inspector, Toolbar) call the store, then persist — inspector edits through a debounced saver, discrete inserts immediately. Zoom is local view state applied as a Konva `Stage` scale; it never enters the store or JSON, so render/export parity is untouched.

**Tech Stack:** Next.js 15 + React 19, Zustand vanilla + Immer, Zod (core schema), Konva/react-konva, Vitest (unit + fake timers), Playwright via `vitest.e2e.config.ts` (behavioral gate).

## Global Constraints

- Node.js 20+. `crypto.randomUUID()` is available (browser + Node 20+) — use it for new element ids.
- Render/export parity is rule #1: never add a second render path; nothing in this slice may touch `elementToNodeConfig`/`renderScreen`.
- **Zoom is view state:** it lives in local React state only — never the store, never the project JSON — and must not change export output.
- Schema stays **v1**: this slice adds NO schema fields and NO element types. No migration.
- The store is the only writer of project state and stays free of the network/persistence layer (its day-0 contract). Persistence lives in UI-side wrappers (`mutate-and-save.ts`, `debounced-save.ts`).
- Toolbar inserts **`text` + `shape` only**. `screenshot`/`device-frame` stay editable via the inspector's free-text `assetUrl`; they are NOT insertable from scratch this slice.
- `lock`/`hide` toggles live in the Layers panel (Slice 4) — the inspector must NOT duplicate them.
- Commit style: `prefix: imperative subject`, no `Co-Authored-By` trailer.

---

### Task 1: `core` default-element factories

**Files:**
- Create: `packages/core/src/model/factories.ts`
- Modify: `packages/core/src/model/index.ts` (re-export the factories)
- Test: `packages/core/src/model/factories.test.ts`

**Interfaces:**
- Produces: `createTextElement(origin?: { x?: number; y?: number }): TextElement` and `createShapeElement(origin?: { x?: number; y?: number }): ShapeElement`. Both return schema-valid elements with a fresh `crypto.randomUUID()` id. Re-exported from `@screenshot-studio/core/model`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/model/factories.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTextElement, createShapeElement } from "./factories.js";
import { Element } from "./schema.js";

describe("element factories (slice 5)", () => {
  it("createTextElement returns a schema-valid text element", () => {
    const el = createTextElement();
    expect(() => Element.parse(el)).not.toThrow();
    expect(el.type).toBe("text");
    expect(el.id).toMatch(/[0-9a-f-]{36}/);
  });

  it("createShapeElement returns a schema-valid shape element", () => {
    const el = createShapeElement();
    expect(() => Element.parse(el)).not.toThrow();
    expect(el.type).toBe("shape");
    expect(el.kind).toBe("rect");
  });

  it("gives each element a fresh id", () => {
    expect(createTextElement().id).not.toBe(createTextElement().id);
  });

  it("honours a supplied origin", () => {
    const el = createShapeElement({ x: 250, y: 400 });
    expect(el).toMatchObject({ x: 250, y: 400 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/model/factories.test.ts`
Expected: FAIL — `./factories.js` does not exist (import error).

- [ ] **Step 3: Write the factories**

Create `packages/core/src/model/factories.ts`:

```ts
import type { TextElement, ShapeElement } from "./schema.js";

/** Optional top-left origin for a newly inserted element (defaults to a fixed offset). */
export interface ElementOrigin {
  x?: number;
  y?: number;
}

/**
 * Schema-valid default elements for insert-on-click (spec §"core — insert factories"). Every
 * required field with no Zod default is set explicitly. Lives in `core`, not the toolbar, so a
 * future CLI `element add` shares the exact same defaults (DRY).
 */
export function createTextElement(origin: ElementOrigin = {}): TextElement {
  return {
    id: crypto.randomUUID(),
    type: "text",
    x: origin.x ?? 100,
    y: origin.y ?? 100,
    width: 400,
    height: 120,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    content: "Text",
    fontFamily: "sans-serif",
    size: 64,
    weight: 400,
    lineHeight: 1.2,
    letterSpacing: 0,
    align: "left",
    color: "#000000",
  };
}

export function createShapeElement(origin: ElementOrigin = {}): ShapeElement {
  return {
    id: crypto.randomUUID(),
    type: "shape",
    x: origin.x ?? 100,
    y: origin.y ?? 100,
    width: 300,
    height: 300,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    kind: "rect",
    fill: "#3B82F6",
    radius: 0,
  };
}
```

- [ ] **Step 4: Re-export from the model entrypoint**

In `packages/core/src/model/index.ts`, add next to the existing `export *` lines:

```ts
export * from "./factories.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/model/factories.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/model/factories.ts packages/core/src/model/factories.test.ts packages/core/src/model/index.ts
git commit -m "feat: add default-element factories for insert-on-click"
```

---

### Task 2: Widen `ElementPatch` and add `addElement`

**Files:**
- Modify: `apps/web/lib/editor-store.ts:11-31` (`ElementPatch` type, `EditorState` interface, store body)
- Test: `apps/web/lib/editor-store.test.ts`

**Interfaces:**
- Consumes: `Element` type from `@screenshot-studio/core/model`.
- Produces: widened `ElementPatch` covering base + every type's editable fields; `addElement(element: Element): void` (appends to the active screen's `elements`, sets `selectedId` to it).

- [ ] **Step 1: Write the failing test**

Add to `apps/web/lib/editor-store.test.ts` inside `describe("editorStore elements (slice 4)", ...)` or a new `describe`:

```ts
describe("editorStore addElement + wide patch (slice 5)", () => {
  beforeEach(() => {
    editorStore.setState({ project: null, activeScreenId: null, selectedId: null });
    editorStore.getState().load(project());
  });

  it("addElement appends to the active screen and selects it", () => {
    const el = {
      id: "new-shape", type: "shape", x: 0, y: 0, width: 100, height: 100,
      rotation: 0, opacity: 1, locked: false, visible: true,
      kind: "rect", fill: "#00FF00", radius: 0,
    } as const;
    editorStore.getState().addElement(el);
    const screen = editorStore.getState().project!.screens[0]!;
    expect(screen.elements.map((e) => e.id)).toContain("new-shape");
    expect(editorStore.getState().selectedId).toBe("new-shape");
  });

  it("patchElement can set type-specific fields", () => {
    editorStore.getState().patchElement("headline", {
      color: "#123456", size: 99, align: "center", opacity: 0.5,
    });
    const el = editorStore.getState().project!.screens[0]!.elements
      .find((e) => e.id === "headline")! as { color: string; size: number; align: string; opacity: number };
    expect(el).toMatchObject({ color: "#123456", size: 99, align: "center", opacity: 0.5 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/web/lib/editor-store.test.ts -t "slice 5"`
Expected: FAIL — `addElement` is not a function; the wide-patch test fails to type-check / the fields aren't applied.

- [ ] **Step 3: Widen the patch type and imports**

In `apps/web/lib/editor-store.ts`, replace the top import and `ElementPatch` (lines 1-16) with:

```ts
import { createStore } from "zustand/vanilla";
import { produce } from "immer";
import type {
  Project,
  Screen,
  Element,
  TextElement,
  ShapeElement,
  ScreenshotElement,
  DeviceFrameElement,
} from "@screenshot-studio/core/model";

/**
 * Editor state as a framework-agnostic Zustand vanilla store, bound to React via `useStore` in
 * components. Every mutation goes through Immer, so each change is a discrete immutable patch —
 * the day-0 requirement (roadmap.md §1) that lets undo/redo be added later without a rewrite.
 * The store is the only writer of project state; the canvas dispatches actions, never mutates.
 */
export type ElementPatch = Partial<
  Pick<
    TextElement,
    | "x" | "y" | "width" | "height" | "rotation" | "opacity" | "locked" | "visible" | "name"
    | "content" | "fontFamily" | "size" | "weight" | "lineHeight" | "letterSpacing" | "align" | "color"
  >
> &
  Partial<Pick<ShapeElement, "fill" | "radius">> &
  Partial<Pick<ScreenshotElement, "assetUrl" | "fit" | "cornerRadius">> &
  Partial<Pick<DeviceFrameElement, "assetUrl" | "fit">>;
```

- [ ] **Step 4: Declare and implement `addElement`**

In the `EditorState` interface add:

```ts
  addElement: (element: Element) => void;
```

In the store body (after `removeElement`), add:

```ts
  addElement: (element) =>
    set((state) => {
      if (!state.project || !state.activeScreenId) return state;
      const project = produce(state.project, (draft) => {
        const screen = draft.screens.find((s) => s.id === state.activeScreenId);
        if (screen) screen.elements.push(element);
      });
      return { project, selectedId: element.id };
    }),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run apps/web/lib/editor-store.test.ts`
Expected: PASS (all store tests, including the two new ones).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/editor-store.ts apps/web/lib/editor-store.test.ts
git commit -m "feat: widen element patch and add addElement store action"
```

---

### Task 3: `patchBackground` and `patchArtboard` store actions

**Files:**
- Modify: `apps/web/lib/editor-store.ts` (`EditorState` interface + store body)
- Test: `apps/web/lib/editor-store.test.ts`

**Interfaces:**
- Produces: `patchBackground(patch: { color: string }): void` and `patchArtboard(patch: { width?: number; height?: number }): void`, both mutating the ACTIVE screen only.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/lib/editor-store.test.ts`:

```ts
describe("editorStore screen editors (slice 5)", () => {
  beforeEach(() => {
    editorStore.setState({ project: null, activeScreenId: null, selectedId: null });
    editorStore.getState().load(project());
  });

  it("patchBackground sets the active screen's solid colour", () => {
    editorStore.getState().patchBackground({ color: "#ABCDEF" });
    const bg = editorStore.getState().project!.screens[0]!.background;
    expect(bg).toMatchObject({ type: "solid", color: "#ABCDEF" });
  });

  it("patchArtboard sets the active screen's dimensions", () => {
    editorStore.getState().patchArtboard({ width: 720, height: 1560 });
    expect(editorStore.getState().project!.screens[0]!.artboard)
      .toMatchObject({ width: 720, height: 1560 });
  });

  it("patchArtboard only touches the active screen", () => {
    editorStore.getState().patchArtboard({ width: 720 });
    expect(editorStore.getState().project!.screens[1]!.artboard.width).toBe(660);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/web/lib/editor-store.test.ts -t "screen editors"`
Expected: FAIL — `patchBackground`/`patchArtboard` are not functions.

- [ ] **Step 3: Declare and implement the actions**

In the `EditorState` interface add:

```ts
  patchBackground: (patch: { color: string }) => void;
  patchArtboard: (patch: { width?: number; height?: number }) => void;
```

In the store body (after `addElement`), add:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/web/lib/editor-store.test.ts`
Expected: PASS (all store tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/editor-store.ts apps/web/lib/editor-store.test.ts
git commit -m "feat: add background and artboard patch store actions"
```

---

### Task 4: Debounced persistence helper

**Files:**
- Create: `apps/web/lib/debounced-save.ts`
- Test: `apps/web/lib/debounced-save.test.ts`

**Interfaces:**
- Consumes: `saveProject` from `./save-project.js`.
- Produces: `createDebouncedSaver(saveFn, delayMs): (project: Project) => void` (testable factory) and `scheduleSave(project: Project): void` (module singleton, 300 ms, wraps `saveProject`). The Inspector calls `scheduleSave` after each store patch.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/debounced-save.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDebouncedSaver } from "./debounced-save.js";
import type { Project } from "@screenshot-studio/core/model";

const fakeProject = { meta: { name: "X" } } as unknown as Project;

describe("createDebouncedSaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces rapid calls into a single save with the latest project", () => {
    const save = vi.fn();
    const debounced = createDebouncedSaver(save, 300);
    debounced(fakeProject);
    debounced(fakeProject);
    debounced(fakeProject);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("saves again after the delay elapses between calls", () => {
    const save = vi.fn();
    const debounced = createDebouncedSaver(save, 300);
    debounced(fakeProject);
    vi.advanceTimersByTime(300);
    debounced(fakeProject);
    vi.advanceTimersByTime(300);
    expect(save).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/web/lib/debounced-save.test.ts`
Expected: FAIL — `./debounced-save.js` does not exist.

- [ ] **Step 3: Write the helper**

Create `apps/web/lib/debounced-save.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/web/lib/debounced-save.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/debounced-save.ts apps/web/lib/debounced-save.test.ts
git commit -m "feat: add debounced project saver for inspector edits"
```

---

### Task 5: Inspector component (fields + selected + no-selection editors)

**Files:**
- Create: `apps/web/components/inspector-fields.tsx` (dumb field primitives)
- Create: `apps/web/components/Inspector.tsx`
- Modify: `apps/web/app/editor/page.tsx` (mount `<Inspector />` as the right column)

**Interfaces:**
- Consumes: `editorStore` + `ElementPatch` (`../lib/editor-store`), `scheduleSave` (`../lib/debounced-save`), `getScreen` (`@screenshot-studio/core/model`).
- Produces: `<Inspector />` (self-contained, reads the store). Field primitives `NumberField`, `ColorField`, `TextField`, `SelectField`.

- [ ] **Step 1: Write the field primitives**

Create `apps/web/components/inspector-fields.tsx`:

```tsx
"use client";

/** Small, dumb inspector inputs. One label + control per row; all controlled. */

export function NumberField({
  label, value, onChange, step = 1,
}: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-neutral-500">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 rounded border border-neutral-300 px-1 py-0.5"
      />
    </label>
  );
}

export function ColorField({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-neutral-500">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-24 rounded border border-neutral-300"
      />
    </label>
  );
}

export function TextField({
  label, value, onChange, multiline = false,
}: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-neutral-500">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-neutral-300 px-1 py-0.5"
          rows={3}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-neutral-300 px-1 py-0.5"
        />
      )}
    </label>
  );
}

export function SelectField<T extends string>({
  label, value, options, onChange,
}: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-neutral-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-24 rounded border border-neutral-300 px-1 py-0.5"
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 2: Write the Inspector**

Create `apps/web/components/Inspector.tsx`:

```tsx
"use client";

import { useStore } from "zustand";
import { getScreen } from "@screenshot-studio/core/model";
import { editorStore, type ElementPatch } from "../lib/editor-store";
import { scheduleSave } from "../lib/debounced-save";
import { NumberField, ColorField, TextField, SelectField } from "./inspector-fields";

/**
 * The right-hand inspector. When an element is selected it shows a Transform section plus a
 * per-type section; with no selection it edits the active screen's artboard + background.
 * Every edit patches the store (live canvas) then schedules a debounced save (spec §3, §4).
 */
function patch(id: string, p: ElementPatch) {
  editorStore.getState().patchElement(id, p);
  const next = editorStore.getState().project;
  if (next) scheduleSave(next);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-neutral-200 p-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{title}</h3>
      {children}
    </div>
  );
}

export function Inspector() {
  const project = useStore(editorStore, (s) => s.project);
  const activeScreenId = useStore(editorStore, (s) => s.activeScreenId);
  const selectedId = useStore(editorStore, (s) => s.selectedId);

  if (!project || !activeScreenId) return <aside className="w-64 shrink-0 border-l border-neutral-200 bg-white" />;
  const screen = getScreen(project, activeScreenId);
  const element = selectedId ? screen.elements.find((e) => e.id === selectedId) : undefined;

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col overflow-y-auto border-l border-neutral-200 bg-white">
      {element ? (
        <>
          <Section title="Transform">
            <NumberField label="X" value={element.x} onChange={(x) => patch(element.id, { x })} />
            <NumberField label="Y" value={element.y} onChange={(y) => patch(element.id, { y })} />
            <NumberField label="Width" value={element.width} onChange={(width) => patch(element.id, { width })} />
            <NumberField label="Height" value={element.height} onChange={(height) => patch(element.id, { height })} />
            <NumberField label="Rotation" value={element.rotation} onChange={(rotation) => patch(element.id, { rotation })} />
            <NumberField label="Opacity" value={element.opacity} step={0.1} onChange={(opacity) => patch(element.id, { opacity })} />
          </Section>

          {element.type === "text" && (
            <Section title="Text">
              <TextField label="Content" value={element.content} multiline onChange={(content) => patch(element.id, { content })} />
              <TextField label="Font" value={element.fontFamily} onChange={(fontFamily) => patch(element.id, { fontFamily })} />
              <NumberField label="Size" value={element.size} onChange={(size) => patch(element.id, { size })} />
              <NumberField label="Weight" value={element.weight} step={100} onChange={(weight) => patch(element.id, { weight })} />
              <NumberField label="Line height" value={element.lineHeight} step={0.1} onChange={(lineHeight) => patch(element.id, { lineHeight })} />
              <NumberField label="Letter spacing" value={element.letterSpacing} onChange={(letterSpacing) => patch(element.id, { letterSpacing })} />
              <SelectField label="Align" value={element.align} options={["left", "center", "right"] as const} onChange={(align) => patch(element.id, { align })} />
              <ColorField label="Color" value={element.color} onChange={(color) => patch(element.id, { color })} />
            </Section>
          )}

          {element.type === "shape" && (
            <Section title="Shape">
              <ColorField label="Fill" value={element.fill} onChange={(fill) => patch(element.id, { fill })} />
              <NumberField label="Radius" value={element.radius} onChange={(radius) => patch(element.id, { radius })} />
            </Section>
          )}

          {element.type === "screenshot" && (
            <Section title="Screenshot">
              <TextField label="Asset URL" value={element.assetUrl} onChange={(assetUrl) => patch(element.id, { assetUrl })} />
              <SelectField label="Fit" value={element.fit} options={["cover", "contain"] as const} onChange={(fit) => patch(element.id, { fit })} />
              <NumberField label="Corner radius" value={element.cornerRadius} onChange={(cornerRadius) => patch(element.id, { cornerRadius })} />
            </Section>
          )}

          {element.type === "device-frame" && (
            <Section title="Device frame">
              <TextField label="Asset URL" value={element.assetUrl} onChange={(assetUrl) => patch(element.id, { assetUrl })} />
              <SelectField label="Fit" value={element.fit} options={["cover", "contain"] as const} onChange={(fit) => patch(element.id, { fit })} />
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-neutral-500">Device</span>
                <span className="text-neutral-400">{element.deviceType}</span>
              </div>
            </Section>
          )}
        </>
      ) : (
        <>
          <Section title="Artboard">
            <NumberField label="Width" value={screen.artboard.width}
              onChange={(width) => { editorStore.getState().patchArtboard({ width }); const n = editorStore.getState().project; if (n) scheduleSave(n); }} />
            <NumberField label="Height" value={screen.artboard.height}
              onChange={(height) => { editorStore.getState().patchArtboard({ height }); const n = editorStore.getState().project; if (n) scheduleSave(n); }} />
          </Section>
          {screen.background.type === "solid" && (
            <Section title="Background">
              <ColorField label="Color" value={screen.background.color}
                onChange={(color) => { editorStore.getState().patchBackground({ color }); const n = editorStore.getState().project; if (n) scheduleSave(n); }} />
            </Section>
          )}
        </>
      )}
    </aside>
  );
}
```

- [ ] **Step 3: Mount the Inspector in the editor page**

In `apps/web/app/editor/page.tsx`, add the import near the other component imports:

```tsx
import { Inspector } from "../../components/Inspector";
```

Then change the returned layout's `<main>` (currently `LeftPanel` + stage div) to include the inspector as a third column:

```tsx
  return (
    <main className="flex h-screen w-full">
      <LeftPanel />
      <div className="flex-1 overflow-auto bg-neutral-100 p-8">
        <EditorStage images={images} />
      </div>
      <Inspector />
    </main>
  );
```

- [ ] **Step 4: Verify types and unit tests still pass**

Run: `pnpm --filter @screenshot-studio/web typecheck && pnpm vitest run apps/web`
Expected: PASS — no type errors; existing store/helper tests green. (The Inspector is exercised behaviorally in Task 8's e2e.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/inspector-fields.tsx apps/web/components/Inspector.tsx apps/web/app/editor/page.tsx
git commit -m "feat: add the right-hand inspector with per-type and no-selection editors"
```

---

### Task 6: Toolbar with insert-on-click (text + shape)

**Files:**
- Create: `apps/web/components/Toolbar.tsx`
- Modify: `apps/web/app/editor/page.tsx` (wrap the stage column with the toolbar)

**Interfaces:**
- Consumes: `createTextElement`/`createShapeElement` (`@screenshot-studio/core/model`), `editorStore`, `saveProject`.
- Produces: `<Toolbar zoom onZoomIn onZoomOut onZoomReset />`. Insert buttons build an element via a factory, call `addElement`, and persist immediately (a discrete action, not high-frequency). Zoom buttons are wired in Task 7 but the props exist now.

- [ ] **Step 1: Write the Toolbar**

Create `apps/web/components/Toolbar.tsx`:

```tsx
"use client";

import type { Element } from "@screenshot-studio/core/model";
import { createTextElement, createShapeElement } from "@screenshot-studio/core/model";
import { editorStore } from "../lib/editor-store";
import { saveProject } from "../lib/save-project";

/**
 * Editor toolbar: insert-on-click element tools (text + shape only — asset-bearing types are
 * inspector-edited, spec scope) plus zoom controls. Insert is a discrete action, so it persists
 * immediately (unlike the debounced inspector inputs).
 */
export function Toolbar({
  zoom, onZoomIn, onZoomOut, onZoomReset,
}: { zoom: number; onZoomIn: () => void; onZoomOut: () => void; onZoomReset: () => void }) {
  const insert = (element: Element) => {
    editorStore.getState().addElement(element);
    const next = editorStore.getState().project;
    if (next) void saveProject(next);
  };

  const btn = "rounded border border-neutral-300 bg-white px-2 py-1 text-xs hover:bg-neutral-100";

  return (
    <div className="flex items-center gap-2 border-b border-neutral-200 bg-white px-3 py-2">
      <button className={btn} onClick={() => insert(createTextElement())}>+ Text</button>
      <button className={btn} onClick={() => insert(createShapeElement())}>+ Shape</button>
      <div className="ml-auto flex items-center gap-1">
        <button className={btn} aria-label="Zoom out" onClick={onZoomOut}>−</button>
        <span className="w-12 text-center text-xs tabular-nums text-neutral-500">{Math.round(zoom * 100)}%</span>
        <button className={btn} aria-label="Zoom in" onClick={onZoomIn}>+</button>
        <button className={btn} onClick={onZoomReset}>Reset</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount the Toolbar above the stage**

In `apps/web/app/editor/page.tsx`, import it:

```tsx
import { Toolbar } from "../../components/Toolbar";
```

Wrap the stage column so the toolbar sits above the scroll region. Replace the middle `<div className="flex-1 overflow-auto …">` block with (zoom state is added in Task 7 — for now pass a static `zoom={1}` and no-op handlers so this task compiles and renders):

```tsx
      <div className="flex flex-1 flex-col overflow-hidden">
        <Toolbar zoom={1} onZoomIn={() => {}} onZoomOut={() => {}} onZoomReset={() => {}} />
        <div className="flex-1 overflow-auto bg-neutral-100 p-8">
          <EditorStage images={images} />
        </div>
      </div>
```

- [ ] **Step 3: Verify types and that insert renders**

Run: `pnpm --filter @screenshot-studio/web typecheck`
Expected: PASS. (Insert-persist is asserted in Task 8's e2e.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/Toolbar.tsx apps/web/app/editor/page.tsx
git commit -m "feat: add toolbar with text/shape insert-on-click"
```

---

### Task 7: Zoom (local view state)

**Files:**
- Modify: `apps/web/components/EditorStage.tsx` (accept a `zoom` prop; scale the Stage)
- Modify: `apps/web/app/editor/page.tsx` (own `zoom` state; wire Toolbar handlers)

**Interfaces:**
- Consumes: `zoom: number` prop into `EditorStage`; Toolbar's `onZoomIn/out/Reset`.
- Produces: `EditorStage` renders the artboard at `zoom` scale (default `1` keeps the Slice 1 drag e2e's 1:1 assumption valid). Zoom stays local React state — never the store, never JSON.

- [ ] **Step 1: Accept a `zoom` prop in EditorStage**

In `apps/web/components/EditorStage.tsx`, change the signature and the outer wrapper/Stage to scale. Replace:

```tsx
export function EditorStage({ images }: { images: ImageCache }) {
```

with:

```tsx
export function EditorStage({ images, zoom = 1 }: { images: ImageCache; zoom?: number }) {
```

Then replace the outer wrapper + `<Stage …>` opening (the `<div style={{ position: "relative", width, height }}>` and the `<Stage width={width} height={height} …>`) with a zoom-scaled version:

```tsx
    <div style={{ position: "relative", width: width * zoom, height: height * zoom }}>
      <Stage
        width={width * zoom}
        height={height * zoom}
        scaleX={zoom}
        scaleY={zoom}
        className="bg-neutral-200"
        onMouseDown={(e) => {
          // Click on empty stage clears the selection.
          if (e.target === e.target.getStage()) editorStore.getState().select(null);
        }}
      >
```

(The rest of the Stage/Layer body is unchanged — Konva's `scaleX/scaleY` scales all children and keeps pointer hit-testing correct.)

- [ ] **Step 2: Own zoom state in the page and wire the Toolbar**

In `apps/web/app/editor/page.tsx`, add `useState` to the existing React import if not present, and inside `EditorPage` add the zoom state + clamp:

```tsx
  const [zoom, setZoom] = useState(1);
  const clamp = (z: number) => Math.min(4, Math.max(0.25, Number(z.toFixed(2))));
```

Then update the middle column to use real handlers and pass `zoom` to the stage:

```tsx
      <div className="flex flex-1 flex-col overflow-hidden">
        <Toolbar
          zoom={zoom}
          onZoomIn={() => setZoom((z) => clamp(z + 0.25))}
          onZoomOut={() => setZoom((z) => clamp(z - 0.25))}
          onZoomReset={() => setZoom(1)}
        />
        <div className="flex-1 overflow-auto bg-neutral-100 p-8">
          <EditorStage images={images} zoom={zoom} />
        </div>
      </div>
```

- [ ] **Step 3: Verify types**

Run: `pnpm --filter @screenshot-studio/web typecheck`
Expected: PASS.

- [ ] **Step 4: Manual sanity (optional but recommended)**

Run: `pnpm --filter @screenshot-studio/web dev`, open `/editor`, click `+`/`−`/`Reset` — the artboard scales and the percentage updates; drag/select still work at 100%.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/EditorStage.tsx apps/web/app/editor/page.tsx
git commit -m "feat: add local zoom view state to the editor stage"
```

---

### Task 8: e2e gate — insert + inspector edit persist; parity unchanged

**Files:**
- Create: `e2e/inspector-toolbar.test.ts`
- Test (parity re-run): `e2e/parity.test.ts` (unchanged — run to confirm)

**Interfaces:**
- Consumes: the running web server + Chromium harness (mirrors `e2e/editor.test.ts`).
- Produces: a behavioral gate proving a toolbar insert and an inspector edit both round-trip to disk.

- [ ] **Step 1: Write the e2e**

Create `e2e/inspector-toolbar.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

/**
 * Slice 5 behavioral gate: a toolbar insert and an inspector edit both round-trip through the
 * store + API route to the on-disk JSON. Runs against a temp copy so the fixture is untouched.
 */
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sample = resolve(repoRoot, "fixtures/phase-0-sample/app-store-screenshots.json");

let server: RunningServer;
let browser: Browser;
let dir: string;
let projectFile: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "inspector-e2e-"));
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

function elements(): Array<{ id: string; type: string; width: number }> {
  const p = JSON.parse(readFileSync(projectFile, "utf8"));
  return p.screens[0].elements;
}

describe("inspector + toolbar", () => {
  it("inserting a shape and editing its width persist to disk", async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1600 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.waitForSelector("canvas");

    const before = elements().length;
    await page.getByRole("button", { name: "+ Shape" }).click();

    // The inserted shape is appended AND selected, so the inspector shows its Transform section.
    await expect.poll(() => elements().length, { timeout: 10_000 }).toBe(before + 1);
    const added = elements()[before]!;
    expect(added.type).toBe("shape");

    // Edit Width in the inspector; the debounced save (300 ms) must land the new value.
    const width = page.getByText("Width", { exact: true }).locator("xpath=following-sibling::input");
    await width.fill("321");
    await width.blur();
    await expect
      .poll(() => elements().find((e) => e.id === added.id)!.width, { timeout: 10_000 })
      .toBe(321);

    await page.close();
  });
});
```

- [ ] **Step 2: Run the new e2e**

Run: `pnpm vitest run --config vitest.e2e.config.ts e2e/inspector-toolbar.test.ts`
Expected: PASS. (If the `Width` locator is brittle, scope it to the Transform section via a `getByRole` on the inspector `<aside>`; the label+sibling-input xpath matches the `NumberField` markup from Task 5.)

- [ ] **Step 3: Confirm render/export parity is unchanged**

Run: `pnpm vitest run --config vitest.e2e.config.ts e2e/parity.test.ts`
Expected: PASS — the shared `elementToNodeConfig`/`renderScreen` path was never touched, so the Phase 0 parity gate still holds.

- [ ] **Step 4: Commit**

```bash
git add e2e/inspector-toolbar.test.ts
git commit -m "test: add slice 5 inspector+toolbar persistence e2e"
```

---

## Self-Review

- **Spec coverage:**
  - insert factories → Task 1 ✓
  - widened `ElementPatch` + `addElement` → Task 2 ✓
  - `patchBackground`/`patchArtboard` → Task 3 ✓
  - debounced persistence → Task 4 ✓
  - inspector (Transform + per-type + no-selection artboard/background) → Task 5 ✓
  - toolbar insert (text + shape only) → Task 6 ✓
  - zoom as local view state → Task 7 ✓
  - store/factory units, insert+edit e2e, parity re-run → Tasks 1–4, 8 ✓
  - `lock`/`hide` NOT duplicated (stay in Layers) → honored in Task 5 (only Transform + type fields) ✓
- **Placeholder scan:** none — every code step shows complete content.
- **Type consistency:** `ElementPatch` fields (Task 2) match every `patch(...)` call in the Inspector (Task 5); `addElement(element: Element)` (Task 2) matches the Toolbar's `insert(element: Element)` (Task 6); `EditorStage({ images, zoom })` (Task 7) matches the page's `<EditorStage images={images} zoom={zoom} />`; `createDebouncedSaver`/`scheduleSave` (Task 4) match the Inspector's `scheduleSave` calls (Task 5).
