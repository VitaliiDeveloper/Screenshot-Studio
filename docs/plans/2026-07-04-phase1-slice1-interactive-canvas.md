# Phase 1 · Slice 1 — Interactive Canvas + Render-Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an interactive Konva editor for one screen that shares the single element-render source of truth with the export path, proving Phase 1's core thesis without forking a second renderer.

**Architecture:** A pure `elementToNodeConfig(element)` map in `core/engine` becomes the one place element props turn into Konva props; the existing static `renderScreen` (export) and a new react-konva `EditorStage` (editor) both consume it. Editor state is a framework-agnostic Zustand+Immer store (vanilla store + React binding); persistence is a disk-backed Next API route wrapping `LocalFileStorageAdapter`.

**Tech Stack:** TypeScript, Konva 9 + react-konva 19, Zustand + Immer, Next.js 15 (App Router) + React 19, Tailwind CSS v4, Zod (via `core`), Vitest (unit) + Playwright (e2e).

## Global Constraints

- **Node.js ≥ 20**; package manager is **pnpm 11** (`packageManager: pnpm@11.10.0`).
- **Render/export parity is rule #1.** There must be exactly one element-rendering source of truth (`elementToNodeConfig`) and one export path (`/render` → `renderScreen`). Never add a second react-konva tree for export.
- **The Zod schema is not modified in this slice.** Only existing element types `text` and `shape` are used. Schema widening is Slice 2.
- **`core` stays framework-agnostic** — it may depend on Konva + Zod, never on React/Next. The editor store and API route live in `apps/web`, not `core`.
- **Strict validation on every load/save.** Invalid project JSON must fail loudly with the validator message (`ProjectValidationError`), never be rendered or written.
- **Commit prefixes:** `feat` / `fix` / `refactor` / `chore` / `test` / `docs`. Imperative mood, no trailing period. **Never** add a `Co-Authored-By` trailer.
- **Unit tests:** `pnpm test` (Vitest, node env). **Parity/e2e:** `pnpm test:e2e`. Typecheck: `pnpm typecheck`.
- Existing `apps/web/next.config.mjs` already stubs `canvas: false` and sets `extensionAlias` for `.js`→`.ts`; keep both — react-konva relies on the `canvas` stub.

---

### Task 1: `elementToNodeConfig` — the single render source of truth

**Files:**
- Create: `packages/core/src/engine/node-config.ts`
- Test: `packages/core/src/engine/node-config.test.ts`
- Modify: `packages/core/src/engine/render.ts` (drawElement → use the map)
- Modify: `packages/core/src/engine/index.ts` (re-export)

**Interfaces:**
- Consumes: `Element`, `TextElement`, `ShapeElement` from `../model/schema.js`.
- Produces:
  - `type NodeConfig = { konva: "Text"; config: Konva.TextConfig } | { konva: "Rect"; config: Konva.RectConfig }`
  - `function elementToNodeConfig(element: Element): NodeConfig`
  Both `render.ts` (Task 1) and `EditorStage` (Task 5) rely on these exact names/shapes.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/engine/node-config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { elementToNodeConfig } from "./node-config.js";
import type { TextElement, ShapeElement } from "../model/schema.js";

const baseText: TextElement = {
  id: "t1", type: "text", x: 10, y: 20, width: 300, height: 100,
  rotation: 5, opacity: 0.8, locked: false, visible: true,
  content: "Hi", fontFamily: "Pacifico", size: 96, weight: 600,
  lineHeight: 1.2, letterSpacing: 2, align: "center", color: "#FFFFFF",
};

const baseShape: ShapeElement = {
  id: "s1", type: "shape", x: 0, y: 0, width: 50, height: 40,
  rotation: 0, opacity: 1, locked: false, visible: true,
  kind: "rect", fill: "#FF0000", radius: 8,
};

describe("elementToNodeConfig", () => {
  it("maps a text element to a Konva Text config", () => {
    const result = elementToNodeConfig(baseText);
    expect(result.konva).toBe("Text");
    expect(result.config).toMatchObject({
      id: "t1", x: 10, y: 20, width: 300, height: 100,
      rotation: 5, opacity: 0.8, text: "Hi", fontFamily: "Pacifico",
      fontSize: 96, fontStyle: "600", lineHeight: 1.2,
      letterSpacing: 2, align: "center", fill: "#FFFFFF",
    });
  });

  it("maps a shape element to a Konva Rect config", () => {
    const result = elementToNodeConfig(baseShape);
    expect(result.konva).toBe("Rect");
    expect(result.config).toMatchObject({
      id: "s1", x: 0, y: 0, width: 50, height: 40,
      rotation: 0, opacity: 1, fill: "#FF0000", cornerRadius: 8,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- node-config`
Expected: FAIL — `Cannot find module './node-config.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/engine/node-config.ts`:

```ts
import type Konva from "konva";
import type { Element } from "../model/schema.js";

/**
 * The single element→Konva-props map (docs/specs/2026-07-04-phase1-slice1-...): both the static
 * export renderer (`renderScreen`) and the interactive editor stage build nodes from this exact
 * output, so UI and CLI can never render an element two different ways. Pure and side-effect free
 * — it maps document props to visual props only. Interaction props (draggable, listeners) are the
 * editor's concern and are added by the caller, never here, so the export config stays identical.
 */
export type NodeConfig =
  | { konva: "Text"; config: Konva.TextConfig }
  | { konva: "Rect"; config: Konva.RectConfig };

export function elementToNodeConfig(element: Element): NodeConfig {
  const common = {
    id: element.id,
    x: element.x,
    y: element.y,
    rotation: element.rotation,
    opacity: element.opacity,
  };

  if (element.type === "text") {
    return {
      konva: "Text",
      config: {
        ...common,
        width: element.width,
        height: element.height,
        text: element.content,
        fontFamily: element.fontFamily,
        fontSize: element.size,
        // Konva folds fontStyle into the canvas font shorthand; a numeric weight string
        // ("600 96px Family") is valid CSS, so this maps custom weights directly.
        fontStyle: String(element.weight),
        lineHeight: element.lineHeight,
        letterSpacing: element.letterSpacing,
        align: element.align,
        fill: element.color,
      },
    };
  }

  return {
    konva: "Rect",
    config: {
      ...common,
      width: element.width,
      height: element.height,
      fill: element.fill,
      cornerRadius: element.radius,
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- node-config`
Expected: PASS (2 tests).

- [ ] **Step 5: Refactor `renderScreen` onto the map**

In `packages/core/src/engine/render.ts`, replace the body of `drawElement` (the `if (element.type === "shape")` / `if (element.type === "text")` blocks) with:

```ts
import Konva from "konva";
import type { Project, Screen, Element } from "../model/schema.js";
import { getScreen } from "../model/index.js";
import { elementToNodeConfig } from "./node-config.js";

// ... renderScreen and drawBackground unchanged ...

function drawElement(layer: Konva.Layer, element: Element): void {
  const { konva, config } = elementToNodeConfig(element);
  layer.add(konva === "Text" ? new Konva.Text(config) : new Konva.Rect(config));
}
```

(Keep the file's existing header comment, imports for `renderScreen`/`drawBackground`, and their bodies as-is.)

- [ ] **Step 6: Re-export from the engine barrel**

In `packages/core/src/engine/index.ts`, add:

```ts
export { renderScreen } from "./render.js";
export { elementToNodeConfig, type NodeConfig } from "./node-config.js";
```

- [ ] **Step 7: Run unit tests + typecheck**

Run: `pnpm test` then `pnpm typecheck`
Expected: all unit tests PASS; typecheck clean.

- [ ] **Step 8: Run the parity gate (proves export pixels did not shift)**

Run: `pnpm test:e2e`
Expected: `e2e/parity.test.ts` PASSES unchanged — the refactor did not move export output. **If this fails, stop and fix before continuing; this is the slice's non-negotiable gate.**

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/engine/node-config.ts packages/core/src/engine/node-config.test.ts packages/core/src/engine/render.ts packages/core/src/engine/index.ts
git commit -m "refactor: extract elementToNodeConfig as the single render source of truth"
```

---

### Task 2: Editor store (Zustand + Immer)

**Files:**
- Create: `apps/web/lib/editor-store.ts`
- Test: `apps/web/lib/editor-store.test.ts`
- Modify: `apps/web/package.json` (add `zustand`, `immer`)
- Modify: `vitest.config.ts` (include `apps/**` unit tests)

**Interfaces:**
- Consumes: `Project`, `Element`, `TextElement` from `@screenshot-studio/core/model`.
- Produces:
  - `type ElementPatch = Partial<Pick<TextElement, "x" | "y" | "width" | "height" | "rotation" | "content">>`
  - `editorStore` — a Zustand **vanilla** store (`createStore`) with state `{ project: Project | null; activeScreenId: string | null; selectedId: string | null }` and actions `load(project)`, `select(id | null)`, `patchElement(id, patch)`.
  `EditorStage` (Task 5) and the editor page (Task 4) consume these exact names.

- [ ] **Step 1: Add dependencies**

Run: `pnpm --filter @screenshot-studio/web add zustand immer`
Expected: `zustand` and `immer` appear under `apps/web/package.json` dependencies.

- [ ] **Step 2: Broaden the unit test glob to cover `apps/web`**

In `vitest.config.ts`, change the `include` line to:

```ts
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
```

Leave the existing `exclude` (`**/node_modules/**`, `**/dist/**`, `e2e/**`) as-is, and add `**/.next/**` to it:

```ts
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "e2e/**"],
```

- [ ] **Step 3: Write the failing test**

Create `apps/web/lib/editor-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { editorStore } from "./editor-store.js";
import type { Project } from "@screenshot-studio/core/model";

function project(): Project {
  return {
    meta: { name: "T", schemaVersion: 1 },
    platforms: ["apple"],
    locales: ["en"],
    fonts: [],
    screens: [{
      id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
      artboard: { width: 660, height: 1434 },
      background: { type: "solid", color: "#000000" },
      elements: [{
        id: "headline", type: "text", x: 40, y: 100, width: 580, height: 200,
        rotation: 0, opacity: 1, locked: false, visible: true,
        content: "Hello", fontFamily: "Pacifico", size: 72, weight: 400,
        lineHeight: 1.2, letterSpacing: 0, align: "left", color: "#FFFFFF",
      }],
    }],
  };
}

describe("editorStore", () => {
  beforeEach(() => {
    editorStore.setState({ project: null, activeScreenId: null, selectedId: null });
  });

  it("load sets the project and the first screen as active", () => {
    editorStore.getState().load(project());
    const s = editorStore.getState();
    expect(s.project?.meta.name).toBe("T");
    expect(s.activeScreenId).toBe("hero");
    expect(s.selectedId).toBeNull();
  });

  it("select sets the selected id", () => {
    editorStore.getState().load(project());
    editorStore.getState().select("headline");
    expect(editorStore.getState().selectedId).toBe("headline");
  });

  it("patchElement updates geometry immutably (new project reference)", () => {
    editorStore.getState().load(project());
    const before = editorStore.getState().project!;
    editorStore.getState().patchElement("headline", { x: 123, y: 456 });
    const after = editorStore.getState().project!;
    expect(after).not.toBe(before); // new reference — patch, not in-place mutation
    expect(after.screens[0]!.elements[0]!).toMatchObject({ x: 123, y: 456 });
    expect(before.screens[0]!.elements[0]!.x).toBe(40); // original untouched
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm test -- editor-store`
Expected: FAIL — `Cannot find module './editor-store.js'`.

- [ ] **Step 5: Write the implementation**

Create `apps/web/lib/editor-store.ts`:

```ts
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
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test -- editor-store`
Expected: PASS (3 tests).

**If it fails to resolve `@screenshot-studio/core/model`:** this is the first *unit* test to import
`core` by package specifier (existing unit tests use relative imports; only the e2e config uses the
specifier). Add an alias to `vitest.config.ts` so Vitest resolves the exports map to the `.ts`
source, then re-run:

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@screenshot-studio/core": fileURLToPath(new URL("./packages/core/src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "e2e/**"],
  },
});
```

(The alias maps the specifier root to `packages/core/src`; the exports subpaths like `/model`
resolve under it. Only add this if Step 6 actually fails to resolve — don't add config you don't need.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/editor-store.ts apps/web/lib/editor-store.test.ts apps/web/package.json pnpm-lock.yaml vitest.config.ts
git commit -m "feat: add zustand+immer editor store with patch-based mutations"
```

---

### Task 3: Disk-backed project API route

**Files:**
- Create: `apps/web/lib/project-path.ts`
- Create: `apps/web/app/api/project/route.ts`
- Test: `apps/web/app/api/project/route.test.ts`

**Interfaces:**
- Consumes: `LocalFileStorageAdapter` from `@screenshot-studio/core/storage`; `parseProject`, `ProjectValidationError` from `@screenshot-studio/core/model`; `resolveProjectPath` from `./project-path` (Task 3).
- Produces: Next route handlers `GET(): Promise<Response>` and `PUT(req: Request): Promise<Response>` at `/api/project`. `GET` → `200 {project}` or `4xx {error}`; `PUT` validates the body and → `200 {ok:true}` or `400 {error}`. The editor page (Task 4) and save wiring (Task 5) consume this contract.

- [ ] **Step 1: Write the path resolver**

Create `apps/web/lib/project-path.ts`:

```ts
import { resolve } from "node:path";

/**
 * Resolves the on-disk project JSON the editor reads and writes. Same local-file, self-hosted
 * model as the /render route: the path comes from PROJECT_PATH (env), defaulting to the
 * repo-relative sample so the editor is runnable out of the box. Server-only (uses node:path).
 */
export function resolveProjectPath(): string {
  return resolve(process.env.PROJECT_PATH ?? "fixtures/phase-0-sample/app-store-screenshots.json");
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/app/api/project/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET, PUT } from "./route.js";

const validProject = {
  meta: { name: "T", schemaVersion: 1 },
  platforms: ["apple"], locales: ["en"], fonts: [],
  screens: [{
    id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
    artboard: { width: 660, height: 1434 },
    background: { type: "solid", color: "#000000" },
    elements: [],
  }],
};

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "proj-"));
  file = join(dir, "app-store-screenshots.json");
  writeFileSync(file, JSON.stringify(validProject));
  process.env.PROJECT_PATH = file;
});

afterEach(() => {
  delete process.env.PROJECT_PATH;
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/project", () => {
  it("returns the parsed project", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.name).toBe("T");
  });
});

describe("PUT /api/project", () => {
  it("validates and writes a valid project to disk", async () => {
    const next = structuredClone(validProject);
    next.meta.name = "Renamed";
    const res = await PUT(new Request("http://x/api/project", {
      method: "PUT", body: JSON.stringify(next),
    }));
    expect(res.status).toBe(200);
    expect(JSON.parse(readFileSync(file, "utf8")).meta.name).toBe("Renamed");
  });

  it("rejects an invalid project with 400 and does not write", async () => {
    const res = await PUT(new Request("http://x/api/project", {
      method: "PUT", body: JSON.stringify({ meta: { name: "" } }),
    }));
    expect(res.status).toBe(400);
    // original file untouched
    expect(JSON.parse(readFileSync(file, "utf8")).meta.name).toBe("T");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- api/project`
Expected: FAIL — `Cannot find module './route.js'`.

- [ ] **Step 4: Write the route handlers**

Create `apps/web/app/api/project/route.ts`:

```ts
import { LocalFileStorageAdapter } from "@screenshot-studio/core/storage";
import { parseProject, ProjectValidationError } from "@screenshot-studio/core/model";
import { dirname } from "node:path";
import { resolveProjectPath } from "../../../lib/project-path.js";

/**
 * The editor's only persistence channel (spec §5): the browser reads/writes the same on-disk
 * app-store-screenshots.json the CLI and /render use, via LocalFileStorageAdapter. PUT validates
 * with the same strict core loader before writing — an invalid project is rejected, never saved.
 * Dev-only, local, self-hosted; arbitrary local file read is acceptable here (same as /render).
 */
export const dynamic = "force-dynamic";

function adapter(path: string): LocalFileStorageAdapter {
  return new LocalFileStorageAdapter(dirname(path));
}

export async function GET(): Promise<Response> {
  const path = resolveProjectPath();
  try {
    const project = await adapter(path).load(path);
    return Response.json(project);
  } catch (err) {
    const status = err instanceof ProjectValidationError ? 422 : 404;
    return Response.json({ error: (err as Error).message }, { status });
  }
}

export async function PUT(req: Request): Promise<Response> {
  const path = resolveProjectPath();
  let project;
  try {
    project = parseProject(await req.json());
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
  await adapter(path).save(project, path);
  return Response.json({ ok: true });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test -- api/project`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/project-path.ts apps/web/app/api/project/route.ts apps/web/app/api/project/route.test.ts
git commit -m "feat: add disk-backed project API route with strict validation"
```

---

### Task 4: Tailwind scaffold + static editor page

**Files:**
- Modify: `apps/web/package.json` (add `react-konva`, `tailwindcss`, `@tailwindcss/postcss`, `postcss`)
- Create: `apps/web/postcss.config.mjs`
- Create: `apps/web/app/globals.css`
- Modify: `apps/web/app/layout.tsx` (import globals)
- Create: `apps/web/components/EditorStage.tsx` (static render only)
- Create: `apps/web/app/editor/page.tsx`

**Interfaces:**
- Consumes: `elementToNodeConfig` from `@screenshot-studio/core/engine`; `registerProjectFonts` from `@screenshot-studio/core/fonts`; `editorStore` from `../lib/editor-store.js`; `GET /api/project` (Task 3).
- Produces: `EditorStage` React component (client, react-konva) rendering the active screen; `/editor` page that loads the project into the store and mounts `EditorStage` client-side. Task 5 extends `EditorStage` with interaction.

- [ ] **Step 1: Add dependencies**

Run: `pnpm --filter @screenshot-studio/web add react-konva && pnpm --filter @screenshot-studio/web add -D tailwindcss @tailwindcss/postcss postcss`
Expected: `react-konva` in dependencies; `tailwindcss`, `@tailwindcss/postcss`, `postcss` in devDependencies.

- [ ] **Step 2: Configure PostCSS + Tailwind entry**

Create `apps/web/postcss.config.mjs`:

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

Create `apps/web/app/globals.css`:

```css
@import "tailwindcss";
```

- [ ] **Step 3: Import globals in the root layout**

In `apps/web/app/layout.tsx`, add the stylesheet import at the top (keep the rest of the file unchanged):

```tsx
import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Screenshot Studio",
  description: "Phase 0 render host",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
```

- [ ] **Step 4: Write the static `EditorStage` component**

Create `apps/web/components/EditorStage.tsx`. Lives outside `app/` per react-konva's Next.js guidance; it is dynamically imported with `ssr:false` in Step 5.

```tsx
"use client";

import { Stage, Layer, Text, Rect } from "react-konva";
import { useStore } from "zustand";
import { getScreen } from "@screenshot-studio/core/model";
import { elementToNodeConfig } from "@screenshot-studio/core/engine";
import { editorStore } from "../lib/editor-store";

/**
 * Interactive editor canvas. Renders the active screen's elements through the SAME
 * elementToNodeConfig map the export renderer uses (spec §1) — never a parallel react-konva tree
 * with its own prop logic. Interaction (selection, transform, inline edit) is layered on in a
 * later task; this version is the static read-only render.
 */
export function EditorStage() {
  const project = useStore(editorStore, (s) => s.project);
  const activeScreenId = useStore(editorStore, (s) => s.activeScreenId);
  if (!project || !activeScreenId) return null;

  const screen = getScreen(project, activeScreenId);
  const { width, height } = screen.artboard;

  return (
    <Stage width={width} height={height} className="bg-neutral-200">
      <Layer>
        {screen.background.type === "solid" && (
          <Rect x={0} y={0} width={width} height={height} fill={screen.background.color} />
        )}
        {screen.elements.map((element) => {
          if (!element.visible) return null;
          const { konva, config } = elementToNodeConfig(element);
          return konva === "Text" ? (
            <Text key={element.id} {...config} />
          ) : (
            <Rect key={element.id} {...config} />
          );
        })}
      </Layer>
    </Stage>
  );
}
```

- [ ] **Step 5: Write the `/editor` page**

Create `apps/web/app/editor/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { parseProject } from "@screenshot-studio/core/model";
import { registerProjectFonts } from "@screenshot-studio/core/fonts";
import { editorStore } from "../../lib/editor-store";

// react-konva needs the DOM; load the stage client-only (no SSR).
const EditorStage = dynamic(
  () => import("../../components/EditorStage").then((m) => m.EditorStage),
  { ssr: false },
);

export default function EditorPage() {
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/project");
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to load project");
        const project = parseProject(body);
        await registerProjectFonts(project.fonts); // fonts before first paint (parity)
        editorStore.getState().load(project);
        setReady(true);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  if (error) return <main className="p-6 text-red-600 whitespace-pre-wrap">{error}</main>;
  if (!ready) return <main className="p-6 text-neutral-500">Loading…</main>;
  return (
    <main className="min-h-screen w-full overflow-auto bg-neutral-100 p-8">
      <EditorStage />
    </main>
  );
}
```

- [ ] **Step 6: Typecheck and build**

Run: `pnpm --filter @screenshot-studio/web typecheck && pnpm --filter @screenshot-studio/web build`
Expected: both succeed with no errors.

- [ ] **Step 7: Manual smoke check**

Run: `pnpm --filter @screenshot-studio/web dev` then open `http://localhost:3000/editor`.
Expected: the Phase 0 sample screen renders (dark artboard, "accent" rectangle, "headline" text in Pacifico). Stop the dev server after confirming.

- [ ] **Step 8: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/postcss.config.mjs apps/web/app/globals.css apps/web/app/layout.tsx apps/web/components/EditorStage.tsx apps/web/app/editor/page.tsx
git commit -m "feat: add tailwind scaffold and static editor canvas over the shared render map"
```

---

### Task 5: Selection, transform, inline text edit, and save

**Files:**
- Modify: `apps/web/components/EditorStage.tsx` (add interaction + Transformer + inline edit)
- Create: `apps/web/lib/save-project.ts`

**Interfaces:**
- Consumes: `editorStore` actions `select`, `patchElement` (Task 2); `PUT /api/project` (Task 3).
- Produces: `saveProject(project: Project): Promise<void>` in `save-project.ts`; an `EditorStage` that selects on click, moves/resizes/rotates the selected element via a Konva `Transformer`, edits `text` inline on double-click, and persists each committed change.

- [ ] **Step 1: Write the save helper**

Create `apps/web/lib/save-project.ts`:

```ts
import type { Project } from "@screenshot-studio/core/model";

/** Persist the project to disk through the API route (spec §4). Throws on a validation reject. */
export async function saveProject(project: Project): Promise<void> {
  const res = await fetch("/api/project", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(project),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Save failed (${res.status})`);
  }
}
```

- [ ] **Step 2: Rewrite `EditorStage` with interaction**

Replace the contents of `apps/web/components/EditorStage.tsx` with:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Konva from "konva";
import { Stage, Layer, Text, Rect, Transformer } from "react-konva";
import { useStore } from "zustand";
import { getScreen } from "@screenshot-studio/core/model";
import { elementToNodeConfig } from "@screenshot-studio/core/engine";
import { editorStore, type ElementPatch } from "../lib/editor-store";
import { saveProject } from "../lib/save-project";

/**
 * Interactive editor canvas. Elements are rendered through the SAME elementToNodeConfig map the
 * export renderer uses (spec §1). Interaction props (draggable, listeners) and the Transformer
 * are layered on here only — they never touch the shared map, so export output is unaffected.
 * Each committed change flows through the store (Immer patch) and is persisted via saveProject.
 */
export function EditorStage() {
  const project = useStore(editorStore, (s) => s.project);
  const activeScreenId = useStore(editorStore, (s) => s.activeScreenId);
  const selectedId = useStore(editorStore, (s) => s.selectedId);

  const trRef = useRef<Konva.Transformer>(null);
  const nodeRefs = useRef(new Map<string, Konva.Node>());
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);

  // Keep the Transformer attached to whatever node is selected.
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = selectedId ? nodeRefs.current.get(selectedId) : undefined;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, project]);

  if (!project || !activeScreenId) return null;
  const screen = getScreen(project, activeScreenId);
  const { width, height } = screen.artboard;

  const commit = (id: string, patch: ElementPatch) => {
    editorStore.getState().patchElement(id, patch);
    const next = editorStore.getState().project;
    if (next) void saveProject(next);
  };

  const onDragEnd = (id: string) => (e: Konva.KonvaEventObject<DragEvent>) => {
    commit(id, { x: e.target.x(), y: e.target.y() });
  };

  // Konva applies scale on transform; bake it into width/height and reset scale to 1.
  const onTransformEnd = (id: string) => (e: Konva.KonvaEventObject<Event>) => {
    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    commit(id, {
      x: node.x(),
      y: node.y(),
      rotation: node.rotation(),
      width: Math.max(5, node.width() * scaleX),
      height: Math.max(5, node.height() * scaleY),
    });
  };

  return (
    <div style={{ position: "relative", width, height }}>
      <Stage
        width={width}
        height={height}
        className="bg-neutral-200"
        onMouseDown={(e) => {
          // Click on empty stage clears the selection.
          if (e.target === e.target.getStage()) editorStore.getState().select(null);
        }}
      >
        <Layer>
          {screen.background.type === "solid" && (
            <Rect x={0} y={0} width={width} height={height} fill={screen.background.color} listening={false} />
          )}
          {screen.elements.map((element) => {
            if (!element.visible) return null;
            const { konva, config } = elementToNodeConfig(element);
            const interaction = {
              draggable: !element.locked,
              ref: (n: Konva.Node | null) => {
                if (n) nodeRefs.current.set(element.id, n);
                else nodeRefs.current.delete(element.id);
              },
              onClick: () => editorStore.getState().select(element.id),
              onTap: () => editorStore.getState().select(element.id),
              onDragEnd: onDragEnd(element.id),
              onTransformEnd: onTransformEnd(element.id),
            };
            return konva === "Text" ? (
              <Text
                key={element.id}
                {...config}
                {...interaction}
                onDblClick={() => setEditing({ id: element.id, value: (config as Konva.TextConfig).text ?? "" })}
              />
            ) : (
              <Rect key={element.id} {...config} {...interaction} />
            );
          })}
          <Transformer ref={trRef} rotateEnabled />
        </Layer>
      </Stage>

      {editing && (
        <textarea
          autoFocus
          value={editing.value}
          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
          onBlur={() => {
            commit(editing.id, { content: editing.value });
            setEditing(null);
          }}
          className="absolute left-0 top-0 z-10 border border-blue-500 p-1"
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @screenshot-studio/web typecheck`
Expected: clean.

- [ ] **Step 4: Manual smoke check**

Run: `pnpm --filter @screenshot-studio/web dev`, open `/editor`.
Expected: clicking the accent rect or headline shows transform handles; dragging moves it; resizing/rotating works; double-clicking the headline opens a textarea whose edited value replaces the text on blur; refreshing the page shows the persisted changes. Stop the dev server after.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/EditorStage.tsx apps/web/lib/save-project.ts
git commit -m "feat: add selection, transform, inline text edit, and save to the editor canvas"
```

---

### Task 6: End-to-end round-trip test

**Files:**
- Create: `e2e/editor.test.ts`

**Interfaces:**
- Consumes: `startWebServer` from `../packages/cli/src/server.js`; the `/editor` page + `/api/project` (Tasks 3–5). Drives a real Chromium via Playwright, matching `e2e/parity.test.ts`.
- Produces: the slice's behavioral gate — load → drag → persisted-on-disk round-trip.

- [ ] **Step 1: Write the e2e test against a disposable copy of the sample**

Create `e2e/editor.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

/**
 * Slice 1 behavioral gate: the interactive editor mutates an element and the change round-trips
 * through the store and the API route to the on-disk JSON. Runs against a temp copy so the
 * committed fixture is never modified. PROJECT_PATH points the /api/project route at that copy.
 */
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sample = resolve(repoRoot, "fixtures/phase-0-sample/app-store-screenshots.json");

let server: RunningServer;
let browser: Browser;
let dir: string;
let projectFile: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "editor-e2e-"));
  projectFile = join(dir, "app-store-screenshots.json");
  writeFileSync(projectFile, readFileSync(sample, "utf8"));
  process.env.PROJECT_PATH = projectFile;
  server = await startWebServer(3124);
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop();
  delete process.env.PROJECT_PATH;
  rmSync(dir, { recursive: true, force: true });
});

interface Geom { id: string; x: number; y: number; width: number; height: number }

function headline(): Geom {
  const p = JSON.parse(readFileSync(projectFile, "utf8"));
  return p.screens[0].elements.find((e: Geom) => e.id === "headline");
}

describe("editor round-trip", () => {
  it("dragging an element persists its new position to disk", async () => {
    const start = headline();
    // Viewport must fit the 660×1434 artboard (stage renders 1:1, no zoom this slice), else the
    // element sits below the fold and the mouse can't hit it.
    const page = await browser.newPage({ viewport: { width: 800, height: 1600 } });
    // Match the project's proven readiness pattern (render-driver.ts): "load", not "networkidle"
    // — next dev's HMR channel keeps the network busy and makes "networkidle" flaky.
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    const canvas = await page.waitForSelector("canvas");
    const box = (await canvas.boundingBox())!;

    // Coords are computed, not guessed: the stage is 1:1, so the headline's centre on screen is
    // the canvas origin plus its document x/y/width/height.
    const cx = box.x + start.x + start.width / 2;
    const cy = box.y + start.y + start.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 40, cy + 30, { steps: 5 });
    await page.mouse.up();

    // Wait for the PUT to land, then assert the on-disk x changed.
    await expect.poll(() => headline().x, { timeout: 10_000 }).not.toBe(start.x);
    await page.close();
  });
});
```

- [ ] **Step 2: Run the e2e test**

Run: `pnpm test:e2e -- editor`
Expected: PASS. Coordinates are computed from the fixture geometry against a 1:1 stage, so no fraction-tuning is needed; if it misses, verify the artboard is not being scaled by CSS (it must render at its native `width`/`height`).

- [ ] **Step 3: Run the full e2e suite (parity must still pass alongside the new test)**

Run: `pnpm test:e2e`
Expected: both `parity.test.ts` and `editor.test.ts` PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/editor.test.ts
git commit -m "test: add editor load-drag-save round-trip e2e"
```

---

## Self-Review

**Spec coverage** (spec §-by-§):
- §1 thesis / single render source → Task 1 (`elementToNodeConfig`, parity gate).
- §2 scope: pan/zoom → canvas is scrollable via `overflow-auto` (Task 4) [see note]; select/move/resize/rotate → Task 5; inline text → Task 5; text+shape only, schema untouched → Tasks 1/5; patch store, no undo UI → Task 2; disk save/load → Tasks 3–5; export path unchanged → Task 1 Step 8.
- §3 components: mapper → T1; UI scaffold (Tailwind, no shadcn) → T4; EditorStage → T4/T5; store → T2; API route → T3.
- §4 data flow → T5 `commit` (store → PUT); export flow unchanged → T1.
- §5 errors: invalid JSON blocks load → T4 page catch; PUT reject → T3.
- §6 interfaces → the Interfaces block in T1/T2/T3.
- §7 tests: parity regression → T1 S8; mapper unit → T1; store unit → T2; e2e round-trip → T6.
- §8 DoD → satisfied across T1–T6.

**Note on pan/zoom:** Reconciled in the spec — §2 now scopes Slice 1 to a scrollable 1:1 canvas and
lists stage-level pan/zoom gestures (wheel-zoom, space-drag pan) as an explicit follow-up. Both docs
now agree; the plan ships scroll/overflow (Task 4). Binding `stage.scale`/`stage.position` to wheel +
space-drag later does not change any interface defined above.

**Placeholder scan:** none — every code step has complete code; every run step has an exact command and expected result.

**Type consistency:** `elementToNodeConfig`/`NodeConfig` (T1) consumed verbatim in T4/T5; `editorStore` actions `load`/`select`/`patchElement` and `ElementPatch` (T2) used as defined in T4/T5; `resolveProjectPath` (T3) used in T3 route; `saveProject` (T5) name consistent; `GET`/`PUT` handler names consistent across T3 test and route.
