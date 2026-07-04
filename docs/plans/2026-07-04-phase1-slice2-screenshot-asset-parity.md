# Phase 1 · Slice 2 — `screenshot` + Asset-Loading Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `screenshot` element that loads its image over HTTP and renders identically in the editor and the headless export, with every image provably decoded before the render-ready gate fires.

**Architecture:** The Zod union gains a `screenshot` member additively (no migration). A framework-agnostic `core` preloader decodes all screenshot images into a cache that both render paths await before drawing; the pure `elementToNodeConfig` map gains an optional cache argument and an `Image` variant. A same-origin web-host asset route serves the project's files so the editor and the headless export resolve the same URL (no canvas taint).

**Tech Stack:** TypeScript, Konva 9 + react-konva 19, Zod (via `core`), Next.js 15 App Router, Vitest (unit) + Playwright (e2e).

## Global Constraints

- **Render/export parity is rule #1.** One element-rendering source of truth (`elementToNodeConfig`), one export path (`/render` → `renderScreen`). The map stays **pure and synchronous** — it looks images up in a preloaded cache and never performs I/O.
- **`schemaVersion` stays `1`.** Adding a discriminated-union member is additive; existing v1 fixtures must load unchanged. No migration.
- **`core` stays framework-agnostic and network-agnostic.** The preloader decodes images but does not know URLs — the host injects a `resolve(assetUrl) => string`. No Next/React imports in `core`.
- **Assets are served, not base64.** `assetUrl` is a document-relative reference resolved by the asset route. Same-origin only (a cross-origin image taints the canvas and breaks `Stage.toDataURL`).
- **Readiness gate:** `window.__stageReady` is set **only after** both `loadProjectImages` and `registerProjectFonts` resolve. A missing/failed asset must not hang the render — it renders a placeholder and the gate still fires.
- **Strict Zod validation** on every load, unchanged. **Never** add a `Co-Authored-By` trailer. Commit prefixes: `feat`/`fix`/`refactor`/`chore`/`test`/`docs`.
- **Commands:** unit `pnpm test`; e2e `pnpm test:e2e`; typecheck `pnpm typecheck`.

---

### Task 1: `ScreenshotElement` schema (additive)

**Files:**
- Modify: `packages/core/src/model/schema.ts`
- Test: `packages/core/src/model/schema.test.ts` (add cases)

**Interfaces:**
- Produces: `ScreenshotElement` (Zod object + inferred type); `Element` union now includes it. Consumed by the map (Task 4), preloader (Task 3), and fixtures (Task 6).

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/model/schema.test.ts` (inside the existing file, after the last test):

```ts
import { Element } from "./schema.js"; // add to existing imports if not present

describe("ScreenshotElement", () => {
  const base = {
    id: "s1", type: "screenshot", x: 0, y: 0, width: 100, height: 200,
    assetUrl: "assets/shot.png",
  };

  it("parses a valid screenshot with defaults", () => {
    const parsed = Element.parse(base);
    expect(parsed).toMatchObject({ type: "screenshot", fit: "cover", cornerRadius: 0 });
  });

  it("accepts fit contain and a corner radius", () => {
    const parsed = Element.parse({ ...base, fit: "contain", cornerRadius: 24 });
    expect(parsed).toMatchObject({ fit: "contain", cornerRadius: 24 });
  });

  it("rejects an unknown fit", () => {
    expect(() => Element.parse({ ...base, fit: "stretch" })).toThrow();
  });

  it("rejects an empty assetUrl", () => {
    expect(() => Element.parse({ ...base, assetUrl: "" })).toThrow();
  });

  it("rejects an unknown key (strict)", () => {
    expect(() => Element.parse({ ...base, bogus: 1 })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- schema`
Expected: FAIL — `screenshot` is not a member of the union.

- [ ] **Step 3: Add the schema**

In `packages/core/src/model/schema.ts`, after the `ShapeElement` definition and before the
`Element = z.discriminatedUnion(...)` line, add:

```ts
export const ScreenshotElement = z
  .object({
    type: z.literal("screenshot"),
    ...elementBase,
    /** Document-relative path to the image, served by the web-host asset route. */
    assetUrl: z.string().min(1),
    fit: z.enum(["cover", "contain"]).default("cover"),
    cornerRadius: z.number().min(0).default(0),
  })
  .strict();
export type ScreenshotElement = z.infer<typeof ScreenshotElement>;
```

Then extend the union:

```ts
export const Element = z.discriminatedUnion("type", [TextElement, ShapeElement, ScreenshotElement]);
export type Element = z.infer<typeof Element>;
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm test -- schema && pnpm --filter @screenshot-studio/core typecheck`
Expected: all schema tests PASS (existing + 5 new); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/model/schema.ts packages/core/src/model/schema.test.ts
git commit -m "feat: add screenshot element type to the schema (additive, no migration)"
```

---

### Task 2: Web-host asset route

**Files:**
- Create: `apps/web/app/api/asset/route.ts`
- Test: `apps/web/app/api/asset/route.test.ts`

**Interfaces:**
- Consumes: `resolveProjectPath` from `../../../lib/project-path.js` (Slice 1) as the default base.
- Produces: `GET(req: Request): Promise<Response>` at `/api/asset`. Query: `path` (required, document-relative), `project` (optional absolute project-JSON path; defaults to `PROJECT_PATH`). Serves the file at `dirname(project)/path` with a content-type, or `400`/`404`. The base for resolving asset URLs on both render paths (Task 5).

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/api/asset/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET } from "./route.js";

let dir: string;
let projectFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "asset-"));
  projectFile = join(dir, "app-store-screenshots.json");
  writeFileSync(projectFile, "{}");
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "assets", "shot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  process.env.PROJECT_PATH = projectFile;
});

afterEach(() => {
  delete process.env.PROJECT_PATH;
  rmSync(dir, { recursive: true, force: true });
});

function req(qs: string): Request {
  return new Request(`http://x/api/asset?${qs}`);
}

describe("GET /api/asset", () => {
  it("serves a file under the project dir", async () => {
    const res = await GET(req("path=assets/shot.png"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    expect(new Uint8Array(await res.arrayBuffer())[0]).toBe(0x89);
  });

  it("400s on a missing path param", async () => {
    expect((await GET(req(""))).status).toBe(400);
  });

  it("rejects path traversal outside the base dir", async () => {
    const res = await GET(req("path=../../etc/passwd"));
    expect(res.status).toBe(400);
  });

  it("404s a nonexistent file", async () => {
    expect((await GET(req("path=assets/nope.png"))).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- api/asset`
Expected: FAIL — `Cannot find module './route.js'`.

- [ ] **Step 3: Write the route**

Create `apps/web/app/api/asset/route.ts`:

```ts
import { readFile } from "node:fs/promises";
import { dirname, join, resolve, relative, isAbsolute, extname } from "node:path";
import { resolveProjectPath } from "../../../lib/project-path.js";

/**
 * Serves the project's asset files over HTTP so /editor and the headless /render resolve the SAME
 * URL for a given screenshot assetUrl — parity by construction, and same-origin so images never
 * taint the canvas (spec §3). Dev-only, local, self-hosted (same model as /render, /api/project).
 * `project` (optional) lets the headless render pass its own project path; else PROJECT_PATH.
 */
export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const rel = url.searchParams.get("path");
  if (!rel) return Response.json({ error: "missing path" }, { status: 400 });

  const projectPath = url.searchParams.get("project") ?? resolveProjectPath();
  const baseDir = dirname(resolve(projectPath));
  const target = resolve(join(baseDir, rel));

  // Traversal guard: the resolved target must stay within the base dir.
  const within = relative(baseDir, target);
  if (within.startsWith("..") || isAbsolute(within)) {
    return Response.json({ error: "path outside project" }, { status: 400 });
  }

  try {
    const bytes = await readFile(target);
    const type = CONTENT_TYPES[extname(target).toLowerCase()] ?? "application/octet-stream";
    return new Response(bytes, { status: 200, headers: { "content-type": type } });
  } catch {
    return Response.json({ error: "not found" }, { status: 404 });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- api/asset`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/asset/route.ts apps/web/app/api/asset/route.test.ts
git commit -m "feat: add same-origin project asset route for screenshot loading"
```

---

### Task 3: Image preloader (`core/assets`)

**Files:**
- Create: `packages/core/src/assets/index.ts`
- Test: `packages/core/src/assets/collect.test.ts`
- Modify: `packages/core/package.json` (add `./assets` to exports)

**Interfaces:**
- Consumes: `Project`, `ScreenshotElement` from `../model/schema.js`.
- Produces:
  - `type ImageCache = Map<string, HTMLImageElement>`
  - `collectScreenshotUrls(project: Project): string[]` — pure, unit-tested (dedup of all screenshot `assetUrl`s).
  - `loadProjectImages(project: Project, resolve: (assetUrl: string) => string): Promise<ImageCache>` — browser-only (uses `Image`/`decode`), verified by the parity e2e (Task 6). A failed asset is absent from the cache, not thrown.

- [ ] **Step 1: Write the failing test (pure collector)**

Create `packages/core/src/assets/collect.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { collectScreenshotUrls } from "./index.js";
import type { Project } from "../model/schema.js";

function project(urls: string[]): Project {
  return {
    meta: { name: "T", schemaVersion: 1 },
    platforms: ["apple"], locales: ["en"], fonts: [],
    screens: [{
      id: "s", name: "S", platform: "apple", device: "iphone", locale: "en",
      artboard: { width: 660, height: 1434 },
      background: { type: "solid", color: "#000000" },
      elements: urls.map((assetUrl, i) => ({
        id: `img${i}`, type: "screenshot", x: 0, y: 0, width: 10, height: 10,
        rotation: 0, opacity: 1, locked: false, visible: true,
        assetUrl, fit: "cover", cornerRadius: 0,
      })),
    }],
  };
}

describe("collectScreenshotUrls", () => {
  it("returns every screenshot url, de-duplicated", () => {
    expect(collectScreenshotUrls(project(["a.png", "b.png", "a.png"])).sort()).toEqual(["a.png", "b.png"]);
  });

  it("returns empty when there are no screenshots", () => {
    const p = project([]);
    expect(collectScreenshotUrls(p)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- collect`
Expected: FAIL — `Cannot find module './index.js'`.

- [ ] **Step 3: Write the module**

Create `packages/core/src/assets/index.ts`:

```ts
import type { Project } from "../model/schema.js";

/**
 * Browser-side image preloading — the asset analog of core/fonts (docs/architecture.md §5). Text
 * was the Phase 0 parity race; images are the Slice 2 race: the render must not be screenshotted
 * until every image has DECODED, or the headless export captures a blank frame. Callers MUST await
 * loadProjectImages before rendering and before setting window.__stageReady.
 *
 * `core` stays network-agnostic: the host injects `resolve` (assetUrl -> a loadable, same-origin
 * URL). A failed asset is simply absent from the cache — the map renders a placeholder, the render
 * still completes.
 */
export type ImageCache = Map<string, HTMLImageElement>;

/** Every distinct screenshot assetUrl in the project. Pure. */
export function collectScreenshotUrls(project: Project): string[] {
  const urls = new Set<string>();
  for (const screen of project.screens) {
    for (const el of screen.elements) {
      if (el.type === "screenshot") urls.add(el.assetUrl);
    }
  }
  return [...urls];
}

/** Decode one image; resolves to the element or null if it fails to load. */
function loadOne(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolveP) => {
    const img = new Image();
    img.onload = () => resolveP(img);
    img.onerror = () => resolveP(null);
    // Same-origin route; no crossOrigin needed. decode() after onload guarantees paint-readiness.
    img.src = url;
  });
}

/** Load and decode every screenshot image, keyed by the document assetUrl. Failed assets omitted. */
export async function loadProjectImages(
  project: Project,
  resolve: (assetUrl: string) => string,
): Promise<ImageCache> {
  const cache: ImageCache = new Map();
  await Promise.all(
    collectScreenshotUrls(project).map(async (assetUrl) => {
      const img = await loadOne(resolve(assetUrl));
      if (img) {
        try { await img.decode(); } catch { /* onload already fired; decode is belt-and-suspenders */ }
        cache.set(assetUrl, img);
      }
    }),
  );
  return cache;
}
```

- [ ] **Step 4: Add the export map entry**

In `packages/core/package.json`, add to `exports` (after the `./fonts` line):

```json
    "./assets": "./src/assets/index.ts",
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test -- collect && pnpm --filter @screenshot-studio/core typecheck`
Expected: PASS (2 tests); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/assets/index.ts packages/core/src/assets/collect.test.ts packages/core/package.json
git commit -m "feat: add core image preloader for screenshot assets"
```

---

### Task 4: `Image` variant + screenshot mapping in `elementToNodeConfig`

**Files:**
- Modify: `packages/core/src/engine/node-config.ts`
- Test: `packages/core/src/engine/node-config.test.ts` (add cases)

**Interfaces:**
- Consumes: `ImageCache` from `../assets/index.js`; `ScreenshotElement` (Task 1).
- Produces: `NodeConfig` gains `{ konva: "Image"; config: Konva.ImageConfig }`; signature becomes
  `elementToNodeConfig(element: Element, images?: ImageCache): NodeConfig`. `screenshot` with a
  cached image → `Image` config (cover crop / contain box + cornerRadius); missing → placeholder
  `Rect`. `text`/`shape` unchanged. Consumed by `renderScreen` and the editor (Task 5).

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/engine/node-config.test.ts`:

```ts
import type { ScreenshotElement } from "../model/schema.js"; // add to imports
import type { ImageCache } from "../assets/index.js";        // add to imports

const shot: ScreenshotElement = {
  id: "p1", type: "screenshot", x: 10, y: 20, width: 200, height: 100,
  rotation: 0, opacity: 1, locked: false, visible: true,
  assetUrl: "a.png", fit: "cover", cornerRadius: 12,
};

// A 400×400 stub image — only width/height are read by the mapper.
const stubImage = { width: 400, height: 400 } as unknown as HTMLImageElement;
const cache: ImageCache = new Map([["a.png", stubImage]]);

describe("elementToNodeConfig — screenshot", () => {
  it("maps a cover screenshot to an Image config with crop and cornerRadius", () => {
    const result = elementToNodeConfig(shot, cache);
    expect(result.konva).toBe("Image");
    expect(result.config).toMatchObject({
      id: "p1", x: 10, y: 20, width: 200, height: 100, cornerRadius: 12, image: stubImage,
    });
    // 200×100 box (2:1) over a 400×400 image → crop keeps full width, half height, centred.
    expect(result.config).toMatchObject({ cropX: 0, cropY: 100, cropWidth: 400, cropHeight: 200 });
  });

  it("maps a contain screenshot to a centred fitted box, no crop", () => {
    const result = elementToNodeConfig({ ...shot, fit: "contain" }, cache);
    expect(result.konva).toBe("Image");
    // 400×400 image in a 200×100 box → scale 0.25, drawn 100×100, centred horizontally in 200.
    expect(result.config).toMatchObject({ x: 60, y: 20, width: 100, height: 100 });
    expect((result.config as Record<string, unknown>).cropWidth).toBeUndefined();
  });

  it("maps a missing image to a grey placeholder rect", () => {
    const result = elementToNodeConfig(shot, new Map());
    expect(result.konva).toBe("Rect");
    expect(result.config).toMatchObject({ id: "p1", width: 200, height: 100, cornerRadius: 12 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- node-config`
Expected: FAIL — screenshot branch not handled / `Image` not in `NodeConfig`.

- [ ] **Step 3: Extend the mapper**

In `packages/core/src/engine/node-config.ts`, update the imports and `NodeConfig`, then add the
screenshot branch. Full new file content:

```ts
import type Konva from "konva";
import type { Element } from "../model/schema.js";
import type { ImageCache } from "../assets/index.js";

/**
 * The single element→Konva-props map (spec §1): both the static export renderer (`renderScreen`)
 * and the interactive editor stage build nodes from this exact output. Pure and synchronous — for
 * `screenshot` it LOOKS UP a preloaded image in `images`, it never loads one, so the sync contract
 * holds for both render paths. Interaction props are added by the caller, never here.
 */
export type NodeConfig =
  | { konva: "Text"; config: Konva.TextConfig }
  | { konva: "Rect"; config: Konva.RectConfig }
  | { konva: "Image"; config: Konva.ImageConfig };

export function elementToNodeConfig(element: Element, images?: ImageCache): NodeConfig {
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

  if (element.type === "shape") {
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

  // screenshot
  const image = images?.get(element.assetUrl);
  if (!image) {
    // Missing/failed asset → a visible placeholder, never a crash or hang (editor.md §7).
    return {
      konva: "Rect",
      config: {
        ...common,
        width: element.width,
        height: element.height,
        fill: "#CCCCCC",
        cornerRadius: element.cornerRadius,
      },
    };
  }

  if (element.fit === "contain") {
    const scale = Math.min(element.width / image.width, element.height / image.height);
    const drawW = image.width * scale;
    const drawH = image.height * scale;
    return {
      konva: "Image",
      config: {
        ...common,
        x: element.x + (element.width - drawW) / 2,
        y: element.y + (element.height - drawH) / 2,
        width: drawW,
        height: drawH,
        image,
        cornerRadius: element.cornerRadius,
      },
    };
  }

  // cover: fill the box, crop the overflow (Konva object-fit-cover recipe, centred).
  const boxRatio = element.width / element.height;
  const imgRatio = image.width / image.height;
  let cropWidth: number;
  let cropHeight: number;
  if (boxRatio >= imgRatio) {
    cropWidth = image.width;
    cropHeight = image.width / boxRatio;
  } else {
    cropWidth = image.height * boxRatio;
    cropHeight = image.height;
  }
  return {
    konva: "Image",
    config: {
      ...common,
      width: element.width,
      height: element.height,
      image,
      cornerRadius: element.cornerRadius,
      cropX: (image.width - cropWidth) / 2,
      cropY: (image.height - cropHeight) / 2,
      cropWidth,
      cropHeight,
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- node-config && pnpm --filter @screenshot-studio/core typecheck`
Expected: PASS (2 original + 3 new); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/engine/node-config.ts packages/core/src/engine/node-config.test.ts
git commit -m "feat: map screenshot elements to Konva.Image with cover/contain and placeholder"
```

---

### Task 5: Thread the image cache through render + editor, gate on it

**Files:**
- Modify: `packages/core/src/engine/render.ts` (`renderScreen` takes the cache)
- Modify: `apps/web/app/render/RenderStage.tsx` (await images + fonts; gate; accept projectPath)
- Modify: `apps/web/app/render/page.tsx` (pass projectPath to RenderStage)
- Modify: `apps/web/components/EditorStage.tsx` (map with the cache)
- Modify: `apps/web/app/editor/page.tsx` (await loadProjectImages; hold cache in the store or state)

**Interfaces:**
- Consumes: `loadProjectImages`, `ImageCache` (Task 3); `elementToNodeConfig(el, images)` (Task 4).
- Produces: `renderScreen(container, project, screenId, images: ImageCache): Konva.Stage`. Both hosts
  preload images before drawing and before readiness.

- [ ] **Step 1: `renderScreen` takes the cache**

In `packages/core/src/engine/render.ts`, change the signature and thread it to `drawElement`:

```ts
import Konva from "konva";
import type { Project, Screen, Element } from "../model/schema.js";
import type { ImageCache } from "../assets/index.js";
import { getScreen } from "../model/index.js";
import { elementToNodeConfig } from "./node-config.js";

export function renderScreen(
  container: HTMLDivElement,
  project: Project,
  screenId: string,
  images: ImageCache,
): Konva.Stage {
  const screen = getScreen(project, screenId);
  const { width, height } = screen.artboard;

  const stage = new Konva.Stage({ container, width, height });
  const layer = new Konva.Layer({ listening: false });
  stage.add(layer);

  drawBackground(layer, screen);
  for (const element of screen.elements) {
    if (!element.visible) continue;
    drawElement(layer, element, images);
  }

  layer.draw();
  return stage;
}
```

And update `drawElement` (keep `drawBackground` unchanged):

```ts
function drawElement(layer: Konva.Layer, element: Element, images: ImageCache): void {
  const { konva, config } = elementToNodeConfig(element, images);
  if (konva === "Text") layer.add(new Konva.Text(config));
  else if (konva === "Image") layer.add(new Konva.Image(config));
  else layer.add(new Konva.Rect(config));
}
```

- [ ] **Step 2: Preload images in `RenderStage` and gate on them**

Replace `apps/web/app/render/RenderStage.tsx` with (adds `projectPath` prop + image preload before
the readiness flag):

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { Project } from "@screenshot-studio/core/model";

declare global {
  interface Window {
    __stageReady?: boolean;
    __renderError?: string;
    __exportPng?: (pixelRatio: number) => string;
  }
}

export function RenderStage({
  project,
  screenId,
  projectPath,
}: {
  project: Project;
  screenId: string;
  projectPath: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stage: import("konva").default.Stage | undefined;
    let cancelled = false;

    (async () => {
      const container = containerRef.current;
      if (!container) return;
      try {
        const [{ renderScreen }, { registerProjectFonts }, { loadProjectImages }] = await Promise.all([
          import("@screenshot-studio/core/engine"),
          import("@screenshot-studio/core/fonts"),
          import("@screenshot-studio/core/assets"),
        ]);

        // Fonts AND images must resolve before the first paint (spec §3): a screenshot must never
        // be captured half-loaded, just like the font must never fall back.
        const resolveAsset = (assetUrl: string) =>
          `/api/asset?project=${encodeURIComponent(projectPath)}&path=${encodeURIComponent(assetUrl)}`;
        const [, images] = await Promise.all([
          registerProjectFonts(project.fonts),
          loadProjectImages(project, resolveAsset),
        ]);
        if (cancelled) return;

        stage = renderScreen(container, project, screenId, images);

        window.__exportPng = (pixelRatio: number) =>
          stage!.toDataURL({ pixelRatio, mimeType: "image/png" });
        window.__stageReady = true;
      } catch (err) {
        const message = (err as Error).message;
        window.__renderError = message;
        setError(message);
      }
    })();

    return () => {
      cancelled = true;
      stage?.destroy();
      delete window.__stageReady;
      delete window.__exportPng;
    };
  }, [project, screenId, projectPath]);

  if (error) return <main data-render-error="render-failed">{error}</main>;
  return <div ref={containerRef} data-render-stage />;
}
```

- [ ] **Step 3: Pass `projectPath` from the render page**

In `apps/web/app/render/page.tsx`, change the final return to pass the raw path:

```tsx
  const targetScreen = screenId ?? project.screens[0]!.id;
  return <RenderStage project={project} screenId={targetScreen} projectPath={resolve(projectPath)} />;
```

(`resolve` and `projectPath` are already in scope in that file.)

- [ ] **Step 4: Give the editor its image cache**

In `apps/web/app/editor/page.tsx`, load images alongside fonts and store the cache in a ref-like
module state the stage can read. Simplest: keep the cache in React state and pass it as a prop.
Replace the file with:

```tsx
"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { parseProject } from "@screenshot-studio/core/model";
import { registerProjectFonts } from "@screenshot-studio/core/fonts";
import { loadProjectImages, type ImageCache } from "@screenshot-studio/core/assets";
import { editorStore } from "../../lib/editor-store";

const EditorStage = dynamic(
  () => import("../../components/EditorStage").then((m) => m.EditorStage),
  { ssr: false },
);

export default function EditorPage() {
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<ImageCache | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/project");
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to load project");
        const project = parseProject(body);
        const resolveAsset = (assetUrl: string) => `/api/asset?path=${encodeURIComponent(assetUrl)}`;
        const [, cache] = await Promise.all([
          registerProjectFonts(project.fonts),
          loadProjectImages(project, resolveAsset),
        ]);
        editorStore.getState().load(project);
        setImages(cache);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  if (error) return <main className="p-6 text-red-600 whitespace-pre-wrap">{error}</main>;
  if (!images) return <main className="p-6 text-neutral-500">Loading…</main>;
  return (
    <main className="min-h-screen w-full overflow-auto bg-neutral-100 p-8">
      <EditorStage images={images} />
    </main>
  );
}
```

- [ ] **Step 5: Use the cache in `EditorStage`**

In `apps/web/components/EditorStage.tsx`: (a) accept `images`, (b) pass it to the map, (c) render an
`Image` node for the `Image` variant. Change the function signature and the element `.map`:

Signature:

```tsx
import Konva from "konva";
import { Stage, Layer, Text, Rect, Image as KonvaImage, Transformer } from "react-konva";
import type { ImageCache } from "@screenshot-studio/core/assets";
// ...
export function EditorStage({ images }: { images: ImageCache }) {
```

Element mapping (replace the existing `screen.elements.map(...)` body's return with a three-way):

```tsx
          {screen.elements.map((element) => {
            if (!element.visible) return null;
            const { konva, config } = elementToNodeConfig(element, images);
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
            if (konva === "Text") {
              return (
                <Text
                  key={element.id}
                  {...config}
                  {...interaction}
                  onDblClick={() => setEditing({ id: element.id, value: (config as Konva.TextConfig).text ?? "" })}
                />
              );
            }
            if (konva === "Image") {
              return <KonvaImage key={element.id} {...config} {...interaction} />;
            }
            return <Rect key={element.id} {...config} {...interaction} />;
          })}
```

- [ ] **Step 6: Typecheck + build + existing parity gate**

Run: `pnpm typecheck && pnpm --filter @screenshot-studio/web build && pnpm test:e2e -- parity`
Expected: typecheck + build clean; the Phase 0 parity test (text+shape `hero` screen, empty image
cache) still PASSES unchanged — threading the cache did not disturb text/shape rendering.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/engine/render.ts apps/web/app/render/RenderStage.tsx apps/web/app/render/page.tsx apps/web/components/EditorStage.tsx apps/web/app/editor/page.tsx
git commit -m "feat: preload screenshot images and gate the render on them in both hosts"
```

---

### Task 6: Screenshot parity e2e (the gate) + fixture

**Files:**
- Create: `fixtures/slice-2-screenshot/app-store-screenshots.json`
- Create: `fixtures/slice-2-screenshot/assets/shot.png` (generated)
- Create: `e2e/screenshot-parity.test.ts`

**Interfaces:**
- Consumes: `startWebServer`, `renderScreenToPng`, `stripAlpha`, `inspectPng`, `pixelmatch` — same
  imports as `e2e/parity.test.ts`. Drives the same `/render` route, now with a `screenshot` screen.

- [ ] **Step 1: Generate the fixture asset**

Run this once to write a 400×400 solid-red PNG (pngjs is a root dependency):

```bash
node -e '
const { PNG } = require("pngjs");
const { writeFileSync, mkdirSync } = require("node:fs");
mkdirSync("fixtures/slice-2-screenshot/assets", { recursive: true });
const png = new PNG({ width: 400, height: 400 });
for (let i = 0; i < png.data.length; i += 4) { png.data[i]=220; png.data[i+1]=40; png.data[i+2]=40; png.data[i+3]=255; }
writeFileSync("fixtures/slice-2-screenshot/assets/shot.png", PNG.sync.write(png));
console.log("wrote shot.png");
'
```

Expected: `wrote shot.png`.

- [ ] **Step 2: Write the fixture project**

Create `fixtures/slice-2-screenshot/app-store-screenshots.json`:

```json
{
  "meta": { "name": "Slice 2 Screenshot", "schemaVersion": 1 },
  "platforms": ["apple"],
  "locales": ["en"],
  "fonts": [],
  "screens": [
    {
      "id": "shot",
      "name": "Shot",
      "platform": "apple",
      "device": "iphone",
      "locale": "en",
      "artboard": { "width": 660, "height": 1434 },
      "background": { "type": "solid", "color": "#101010" },
      "elements": [
        {
          "id": "hero-shot",
          "type": "screenshot",
          "x": 80,
          "y": 300,
          "width": 500,
          "height": 800,
          "assetUrl": "assets/shot.png",
          "fit": "cover",
          "cornerRadius": 48
        }
      ]
    }
  ]
}
```

- [ ] **Step 3: Write the parity e2e**

Create `e2e/screenshot-parity.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";
import { renderScreenToPng } from "../packages/cli/src/render-driver.js";
import { stripAlpha } from "../packages/core/src/export/png.js";

/**
 * Slice 2 gate: proves asset loading is parity-safe. (1) headed vs headless renders of a screen
 * with a screenshot match within tolerance, and (2) the image is provably live — removing the
 * asset (pointing assetUrl at a missing file → grey placeholder) changes the render by many
 * pixels. This is the image analog of the Phase 0 font-live assertion, and it only holds if the
 * readiness gate waits for image decode.
 */
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixturePath = resolve(repoRoot, "fixtures/slice-2-screenshot/app-store-screenshots.json");
const tmpDir = resolve(repoRoot, "e2e/.tmp");
const screenId = "shot";
const pixelRatio = 2;
const target = { width: 1320, height: 2868 };
const PER_PIXEL_THRESHOLD = 0.1;
const MAX_MISMATCH_FRACTION = 0.001;

let server: RunningServer;

beforeAll(async () => {
  mkdirSync(tmpDir, { recursive: true });
  server = await startWebServer(3125);
}, 180_000);

afterAll(async () => {
  await server?.stop();
});

function mismatch(a: Buffer, b: Buffer): number {
  const pa = PNG.sync.read(a);
  const pb = PNG.sync.read(b);
  expect(pa.width).toBe(pb.width);
  expect(pa.height).toBe(pb.height);
  const diff = new PNG({ width: pa.width, height: pa.height });
  return pixelmatch(pa.data, pb.data, diff.data, pa.width, pa.height, { threshold: PER_PIXEL_THRESHOLD });
}

describe("Slice 2 screenshot parity", () => {
  it("headed and headless renders of a screenshot match at the target size", async () => {
    const headed = stripAlpha(await renderScreenToPng({
      baseUrl: server.url, projectPath: fixturePath, screenId, pixelRatio, headless: false,
    }));
    const headless = stripAlpha(await renderScreenToPng({
      baseUrl: server.url, projectPath: fixturePath, screenId, pixelRatio, headless: true,
    }));
    const px = PNG.sync.read(headed);
    expect(px.width).toBe(target.width);
    expect(px.height).toBe(target.height);
    const fraction = mismatch(headed, headless) / (target.width * target.height);
    console.log(`[shot-parity] headed vs headless: ${(fraction * 100).toFixed(4)}%`);
    expect(fraction).toBeLessThan(MAX_MISMATCH_FRACTION);
  });

  it("proves the image is live: render differs from a missing-asset placeholder", async () => {
    const project = JSON.parse(readFileSync(fixturePath, "utf8"));
    project.screens[0].elements[0].assetUrl = "assets/does-not-exist.png";
    // Written INTO the fixture dir so the asset route's base (dirname of the project) still points
    // at the fixture's assets/ — the point is that does-not-exist.png 404s → grey placeholder.
    const missingInDir = resolve(repoRoot, "fixtures/slice-2-screenshot/_missing.json");
    writeFileSync(missingInDir, JSON.stringify(project));

    const present = stripAlpha(await renderScreenToPng({
      baseUrl: server.url, projectPath: fixturePath, screenId, pixelRatio, headless: true,
    }));
    const placeholder = stripAlpha(await renderScreenToPng({
      baseUrl: server.url, projectPath: missingInDir, screenId, pixelRatio, headless: true,
    }));
    expect(mismatch(present, placeholder)).toBeGreaterThan(2000);
  });
});
```

- [ ] **Step 4: Ignore the temp missing-project file**

Append to `.gitignore`:

```
fixtures/slice-2-screenshot/_missing.json
```

- [ ] **Step 5: Run the screenshot parity e2e**

Run: `pnpm test:e2e -- screenshot-parity`
Expected: PASS (2 tests). The `[shot-parity]` mismatch logs well under 0.1%.

- [ ] **Step 6: Run the full e2e suite (all gates green together)**

Run: `pnpm test:e2e`
Expected: `parity.test.ts`, `editor.test.ts`, and `screenshot-parity.test.ts` all PASS.

- [ ] **Step 7: Commit**

```bash
git add fixtures/slice-2-screenshot e2e/screenshot-parity.test.ts .gitignore
git commit -m "test: add screenshot asset-loading parity gate and fixture"
```

---

## Self-Review

**Spec coverage** (spec §-by-§):
- §1 thesis (images decode before gate; map stays pure/sync) → Task 3 (preloader), Task 4 (pure lookup), Task 5 (gate on images + fonts).
- §2 in-scope: `screenshot` type additive, schemaVersion 1 → Task 1; preloader → Task 3; asset route → Task 2; `elementToNodeConfig(el, images?)` cover/contain → Task 4; `renderScreen` threads cache, both hosts await → Task 5; missing-asset placeholder → Task 4 + Task 6 (live proof).
- §2 out-of-scope (device-frame, crop, platform widening, inspector warning) → absent from all tasks.
- §3 components 1–5 → Tasks 1,3,2,4,5 respectively.
- §4 data flow (resolve → /api/asset; both paths await) → Task 5 (RenderStage + editor resolvers).
- §5 errors (missing → placeholder, gate still fires; invalid → strict validator) → Task 4 + preloader omits failed asset (Task 3).
- §6 interfaces → the Interfaces block of each task.
- §7 tests (schema, map, preloader-collect, parity-e2e live) → Tasks 1,4,3,6.
- §8 DoD → satisfied across Tasks 1–6.

**Placeholder scan:** none — every code step is complete; every run step has an exact command + expected result.

**Type consistency:** `ImageCache` defined in Task 3, imported by Tasks 4 and 5. `elementToNodeConfig(element, images?)` defined in Task 4, called with the cache in Task 5. `NodeConfig` `Image` variant added in Task 4, consumed by `renderScreen` (Task 5, `konva === "Image"`) and `EditorStage` (Task 5, `<KonvaImage>`). `renderScreen(container, project, screenId, images)` signature consistent between Task 5 Step 1 and its callers. Asset route query contract (`path`, optional `project`) consistent between Task 2 and the Task 5 resolvers.
