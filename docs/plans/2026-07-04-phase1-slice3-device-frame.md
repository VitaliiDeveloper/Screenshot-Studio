# Phase 1 · Slice 3 — `device-frame` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-contained `device-frame` element that composites a native-Konva iPhone frame over a screenshot clipped to the frame's screen slot, rendering identically in the editor and the headless export.

**Architecture:** The Zod union gains a `device-frame` member. Because widening the union re-narrows the mapper's screenshot branch, the schema, the geometry spec, and the mapper update land **atomically** in Task 1 (one typecheck-green commit). `elementToNodeConfig` gains a `Group` variant whose children (frame body, slot background, clipped content image, notch) are built by the *same pure map* from the *same preloaded image cache* — no new asset channel, no I/O. The frame is drawn with native Konva vector shapes from a hardcoded `DEVICE_FRAME_SPECS` (fractions of the element box), so the frame body and the slot come from one spec and cannot drift, and the frame stays crisp at any zoom / export `pixelRatio`. Both hosts realise the `Group` recursively; the content screenshot flows through the existing Slice-2 `/api/asset` route and readiness gate unchanged.

**Tech Stack:** TypeScript, Konva 9 + react-konva 19, Zod (via `core`), Next.js 15 App Router, Vitest (unit) + Playwright (e2e).

## Global Constraints

- **Render/export parity is rule #1.** One element-rendering source of truth (`elementToNodeConfig`), one export path (`/render` → `renderScreen`). The map stays **pure and synchronous** — it looks images up in a preloaded cache and never performs I/O.
- **`schemaVersion` stays `1`.** Existing v1 fixtures must load unchanged. Additive union member — no migration.
- **Native shapes, no bezel asset.** The frame is Konva rects + a notch, driven by `DEVICE_FRAME_SPECS` (fractions of the element box). No `/public` bezel file, no new preload path (spec §9). The only asset a `device-frame` loads is its content `assetUrl`, via the existing `/api/asset` channel.
- **Readiness gate unchanged.** `window.__stageReady` fires only after `loadProjectImages` + `registerProjectFonts` resolve. A missing content asset must not hang the render — the slot shows a placeholder and the gate still fires.
- **`core` stays framework-agnostic.** No Next/React imports in `core`. `DEVICE_FRAME_SPECS` is pure data.
- **Strict Zod validation** on every load, unchanged. **Never** add a `Co-Authored-By` trailer. Commit prefixes: `feat`/`fix`/`refactor`/`chore`/`test`/`docs`.
- **Commands:** unit `pnpm test`; e2e `pnpm test:e2e`; typecheck `pnpm typecheck`.

---

### Task 1: `device-frame` schema + geometry spec + mapper Group variant (atomic)

Widening `Element`, adding the geometry spec, and updating `elementToNodeConfig` are **one task**: the
moment `DeviceFrameElement` joins the union, the mapper's trailing `screenshot` branch re-narrows to
`ScreenshotElement | DeviceFrameElement` and `element.cornerRadius` (screenshot-only) stops
type-checking. Doing all of it in one commit keeps the tree green. This task also extracts the shared
`computeImageFit` helper so `screenshot` and `device-frame` clip through one recipe.

**Files:**
- Modify: `packages/core/src/model/schema.ts`
- Create: `packages/core/src/model/device-frames.ts`
- Modify: `packages/core/src/model/index.ts` (re-export the new module)
- Test: `packages/core/src/model/schema.test.ts` (add cases)
- Modify: `packages/core/src/engine/node-config.ts` (full rewrite — `computeImageFit` + `Group` variant)
- Test: `packages/core/src/engine/node-config.test.ts` (add cases)

**Interfaces:**
- Consumes: `ImageCache` (already defined in `node-config.ts`, Slice 2).
- Produces:
  - `DeviceFrameElement` (Zod object + inferred type); `Element` union includes it.
  - `DeviceFrameSpec` (interface) + `DEVICE_FRAME_SPECS: Record<"iphone", DeviceFrameSpec>` in
    `model/device-frames.ts`, re-exported from `model/index.ts`.
  - `NodeConfig` gains `{ konva: "Group"; config: Konva.GroupConfig; children: NodeConfig[] }`.
  - `elementToNodeConfig(element, images?)` — `device-frame` returns a `Group` of
    `[body Rect, slot-bg Rect, content Image?, notch Rect]`; `screenshot` unchanged in behaviour but now
    routed through the shared `computeImageFit`. Consumed by `renderScreen` and the editor (Task 3).

- [ ] **Step 1: Write the failing schema tests**

Append to `packages/core/src/model/schema.test.ts` (`Element` is already imported there):

```ts
describe("DeviceFrameElement", () => {
  const base = {
    id: "df1", type: "device-frame", x: 0, y: 0, width: 500, height: 1000,
    deviceType: "iphone", assetUrl: "assets/shot.png",
  };

  it("parses a valid device-frame with defaults", () => {
    const parsed = Element.parse(base);
    expect(parsed).toMatchObject({ type: "device-frame", deviceType: "iphone", fit: "cover" });
  });

  it("accepts fit contain", () => {
    expect(Element.parse({ ...base, fit: "contain" })).toMatchObject({ fit: "contain" });
  });

  it("rejects an unknown deviceType", () => {
    expect(() => Element.parse({ ...base, deviceType: "android" })).toThrow();
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

- [ ] **Step 2: Write the failing mapper tests**

Append to `packages/core/src/engine/node-config.test.ts`. Add `DeviceFrameElement` to the existing
`import type { … } from "../model/schema.js";` line, then add:

```ts
const frame: DeviceFrameElement = {
  id: "df1", type: "device-frame", x: 100, y: 50, width: 1000, height: 1000,
  rotation: 0, opacity: 1, locked: false, visible: true,
  deviceType: "iphone", assetUrl: "hero.png", fit: "cover",
};

// A 400×400 stub — only width/height are read by the mapper.
const frameStub = { width: 400, height: 400 } as unknown as HTMLImageElement;
const frameCache: ImageCache = new Map([["hero.png", frameStub]]);

describe("elementToNodeConfig — device-frame", () => {
  it("maps to a Group carrying the element box, positioned by x/y", () => {
    const result = elementToNodeConfig(frame, frameCache);
    expect(result.konva).toBe("Group");
    expect(result.config).toMatchObject({ id: "df1", x: 100, y: 50, width: 1000, height: 1000 });
  });

  it("composits body, slot background, clipped content image, and notch (box-local)", () => {
    const result = elementToNodeConfig(frame, frameCache);
    if (result.konva !== "Group") throw new Error("expected Group");
    expect(result.children.map((c) => c.konva)).toEqual(["Rect", "Rect", "Image", "Rect"]);

    // Frame body: full box, rounded silhouette.
    expect(result.children[0]!.config).toMatchObject({ x: 0, y: 0, width: 1000, height: 1000, cornerRadius: 140 });
    // Slot background: inset 3.5% x / 2.8% y, slot-rounded, opaque black.
    expect(result.children[1]!.config).toMatchObject({ x: 35, y: 28, width: 930, height: 944, cornerRadius: 93, fill: "#000000" });
    // Content image: fills the slot (cover), same slot rounding, the decoded image.
    expect(result.children[2]!.config).toMatchObject({ x: 35, y: 28, width: 930, height: 944, cornerRadius: 93, image: frameStub });
    // Notch: centred pill near the top.
    expect(result.children[3]!.config).toMatchObject({ x: 340, y: 22, width: 320, height: 18 });
  });

  it("drops the content image when the asset is missing (frame + slot bg + notch remain)", () => {
    const result = elementToNodeConfig(frame, new Map());
    if (result.konva !== "Group") throw new Error("expected Group");
    expect(result.children.map((c) => c.konva)).toEqual(["Rect", "Rect", "Rect"]);
  });
});
```

- [ ] **Step 3: Run to verify both fail**

Run: `pnpm test -- schema node-config`
Expected: FAIL — `device-frame` not in the union; mapper has no `Group`/device-frame branch.

- [ ] **Step 4: Add the geometry spec module**

Create `packages/core/src/model/device-frames.ts`:

```ts
/**
 * Bundled device-frame geometry (docs/specs/2026-07-04-phase1-slice3-device-frame-design.md §3). All
 * values are FRACTIONS of the element's own box, so the frame scales with the element and the screen
 * slot is always aligned to the frame body by construction — there is no separate bezel asset that
 * could drift. The frame is drawn with native Konva shapes (spec §9), so it stays vector-crisp at any
 * zoom or export pixelRatio.
 */
export interface DeviceFrameSpec {
  /** Frame body fill (the bezel). */
  bezelColor: string;
  /** Outer silhouette rounding, as a fraction of box width. */
  frameCornerRadius: number;
  /** Screen-slot inset: left/right are fractions of box width, top/bottom of box height. */
  slotInset: { top: number; right: number; bottom: number; left: number };
  /** Screen-corner rounding, as a fraction of slot width. */
  slotCornerRadius: number;
  /** Top notch/pill: width as a fraction of box width; height and top offset of box height. */
  notch: { widthFrac: number; heightFrac: number; topFrac: number };
}

export const DEVICE_FRAME_SPECS: Record<"iphone", DeviceFrameSpec> = {
  iphone: {
    bezelColor: "#1A1A1C",
    frameCornerRadius: 0.14,
    slotInset: { top: 0.028, right: 0.035, bottom: 0.028, left: 0.035 },
    slotCornerRadius: 0.1,
    notch: { widthFrac: 0.32, heightFrac: 0.018, topFrac: 0.022 },
  },
};
```

- [ ] **Step 5: Add the schema member**

In `packages/core/src/model/schema.ts`, after `ScreenshotElement` and before the
`Element = z.discriminatedUnion(...)` line, add:

```ts
export const DeviceFrameElement = z
  .object({
    type: z.literal("device-frame"),
    ...elementBase,
    deviceType: z.literal("iphone"),
    /** Document-relative path to the screenshot placed in the frame's screen slot. */
    assetUrl: z.string().min(1),
    fit: z.enum(["cover", "contain"]).default("cover"),
  })
  .strict();
export type DeviceFrameElement = z.infer<typeof DeviceFrameElement>;
```

Then extend the union:

```ts
export const Element = z.discriminatedUnion("type", [
  TextElement,
  ShapeElement,
  ScreenshotElement,
  DeviceFrameElement,
]);
export type Element = z.infer<typeof Element>;
```

- [ ] **Step 6: Re-export the geometry module from the model barrel**

In `packages/core/src/model/index.ts`, add next to the other `export * from` lines:

```ts
export * from "./device-frames.js";
```

- [ ] **Step 7: Rewrite the mapper**

Replace the full contents of `packages/core/src/engine/node-config.ts`:

```ts
import type Konva from "konva";
import type { Element } from "../model/schema.js";
import { DEVICE_FRAME_SPECS } from "../model/device-frames.js";

/**
 * The single element→Konva-props map (docs/specs/2026-07-04-phase1-slice3-device-frame-design.md §1):
 * both the static export renderer (`renderScreen`) and the interactive editor stage build nodes from
 * this exact output. Pure and synchronous — it LOOKS images up in a preloaded `images` cache, it never
 * loads one, so the sync contract holds for both render paths. A `device-frame` returns a `Group` of
 * native shapes + the clipped content image; interaction props (draggable, listeners) are the editor's
 * concern and are added by the caller, never here.
 */
export type ImageCache = Map<string, HTMLImageElement>;

export type NodeConfig =
  | { konva: "Text"; config: Konva.TextConfig }
  | { konva: "Rect"; config: Konva.RectConfig }
  | { konva: "Image"; config: Konva.ImageConfig }
  | { konva: "Group"; config: Konva.GroupConfig; children: NodeConfig[] };

interface Box {
  width: number;
  height: number;
}

interface Fit {
  x: number;
  y: number;
  width: number;
  height: number;
  cropX?: number;
  cropY?: number;
  cropWidth?: number;
  cropHeight?: number;
}

/**
 * object-fit for a decoded image inside a box, RELATIVE to the box's (0,0). Shared by `screenshot`
 * (box = the element) and `device-frame` (box = the screen slot). Pure.
 */
function computeImageFit(image: HTMLImageElement, box: Box, fit: "cover" | "contain"): Fit {
  if (fit === "contain") {
    const scale = Math.min(box.width / image.width, box.height / image.height);
    const drawW = image.width * scale;
    const drawH = image.height * scale;
    return { x: (box.width - drawW) / 2, y: (box.height - drawH) / 2, width: drawW, height: drawH };
  }
  // cover: fill the box, crop the overflow (Konva object-fit-cover recipe, centred).
  const boxRatio = box.width / box.height;
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
    x: 0,
    y: 0,
    width: box.width,
    height: box.height,
    cropX: (image.width - cropWidth) / 2,
    cropY: (image.height - cropHeight) / 2,
    cropWidth,
    cropHeight,
  };
}

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
        // Konva folds fontStyle into the canvas font shorthand; a numeric weight string
        // ("600 96px Family") is valid CSS, so this maps custom weights directly.
        fontSize: element.size,
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

  if (element.type === "screenshot") {
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
    const fit = computeImageFit(image, { width: element.width, height: element.height }, element.fit);
    return {
      konva: "Image",
      config: {
        ...common,
        x: element.x + fit.x,
        y: element.y + fit.y,
        width: fit.width,
        height: fit.height,
        image,
        cornerRadius: element.cornerRadius,
        cropX: fit.cropX,
        cropY: fit.cropY,
        cropWidth: fit.cropWidth,
        cropHeight: fit.cropHeight,
      },
    };
  }

  // device-frame → a Group of native shapes + the content image, all in BOX-LOCAL coords; the Group
  // carries element.x/y/rotation/opacity and the box size so the Transformer measures/resizes it as
  // one unit. Body and slot come from one spec → they cannot misalign.
  const spec = DEVICE_FRAME_SPECS[element.deviceType];
  const W = element.width;
  const H = element.height;
  const slotX = spec.slotInset.left * W;
  const slotY = spec.slotInset.top * H;
  const slotW = W - (spec.slotInset.left + spec.slotInset.right) * W;
  const slotH = H - (spec.slotInset.top + spec.slotInset.bottom) * H;
  const slotRadius = spec.slotCornerRadius * slotW;

  const children: NodeConfig[] = [
    // 1. Frame body — the outer silhouette AND the full-box child the Transformer measures.
    {
      konva: "Rect",
      config: { x: 0, y: 0, width: W, height: H, fill: spec.bezelColor, cornerRadius: spec.frameCornerRadius * W },
    },
    // 2. Slot background — letterbox for `contain`, slot-shaped placeholder for a missing asset.
    {
      konva: "Rect",
      config: { x: slotX, y: slotY, width: slotW, height: slotH, fill: "#000000", cornerRadius: slotRadius },
    },
  ];

  // 3. Content image, clipped to the slot (only if it decoded).
  const image = images?.get(element.assetUrl);
  if (image) {
    const fit = computeImageFit(image, { width: slotW, height: slotH }, element.fit);
    children.push({
      konva: "Image",
      config: {
        x: slotX + fit.x,
        y: slotY + fit.y,
        width: fit.width,
        height: fit.height,
        image,
        cornerRadius: slotRadius,
        cropX: fit.cropX,
        cropY: fit.cropY,
        cropWidth: fit.cropWidth,
        cropHeight: fit.cropHeight,
      },
    });
  }

  // 4. Notch (top pill), drawn on top of the content.
  const notchW = spec.notch.widthFrac * W;
  const notchH = spec.notch.heightFrac * H;
  children.push({
    konva: "Rect",
    config: {
      x: (W - notchW) / 2,
      y: spec.notch.topFrac * H,
      width: notchW,
      height: notchH,
      fill: spec.bezelColor,
      cornerRadius: notchH / 2,
    },
  });

  return { konva: "Group", config: { ...common, width: W, height: H }, children };
}
```

- [ ] **Step 8: Run tests + typecheck (must be green now — no interim red)**

Run: `pnpm test -- schema node-config && pnpm --filter @screenshot-studio/core typecheck`
Expected: all schema + mapper tests PASS (including the existing `screenshot` cover/contain cases,
unchanged — the `computeImageFit` extraction is behaviour-preserving); **typecheck clean** — the union
and its handler landed together.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/model/schema.ts packages/core/src/model/device-frames.ts packages/core/src/model/index.ts packages/core/src/model/schema.test.ts packages/core/src/engine/node-config.ts packages/core/src/engine/node-config.test.ts
git commit -m "feat: add device-frame element and map it to a native-shape Konva group"
```

---

### Task 2: Preload the framed screenshot (extend the collector)

The content screenshot of a `device-frame` must decode before the readiness gate, exactly like a bare
`screenshot`. The preloader already gates both hosts; it only needs to *see* device-frame assets.

**Files:**
- Modify: `packages/core/src/assets/index.ts` (rename `collectScreenshotUrls` → `collectImageUrls`; include `device-frame`)
- Test: `packages/core/src/assets/collect.test.ts` (rename + add a device-frame case)

**Interfaces:**
- Consumes: `Project` from `../model/schema.js`.
- Produces: `collectImageUrls(project: Project): string[]` — every `screenshot` **and** `device-frame`
  `assetUrl`, de-duplicated. `loadProjectImages` calls it; its signature is unchanged, so the hosts
  (RenderStage, editor page) need no edits.

- [ ] **Step 1: Update the failing test**

Replace the contents of `packages/core/src/assets/collect.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { collectImageUrls } from "./index.js";
import type { Project, Element } from "../model/schema.js";

function project(elements: Element[]): Project {
  return {
    meta: { name: "T", schemaVersion: 1 },
    platforms: ["apple"], locales: ["en"], fonts: [],
    screens: [{
      id: "s", name: "S", platform: "apple", device: "iphone", locale: "en",
      artboard: { width: 660, height: 1434 },
      background: { type: "solid", color: "#000000" },
      elements,
    }],
  };
}

const shot = (id: string, assetUrl: string): Element => ({
  id, type: "screenshot", x: 0, y: 0, width: 10, height: 10,
  rotation: 0, opacity: 1, locked: false, visible: true,
  assetUrl, fit: "cover", cornerRadius: 0,
});

const framed = (id: string, assetUrl: string): Element => ({
  id, type: "device-frame", x: 0, y: 0, width: 10, height: 20,
  rotation: 0, opacity: 1, locked: false, visible: true,
  deviceType: "iphone", assetUrl, fit: "cover",
});

describe("collectImageUrls", () => {
  it("returns every screenshot url, de-duplicated", () => {
    expect(collectImageUrls(project([shot("a", "a.png"), shot("b", "b.png"), shot("c", "a.png")])).sort())
      .toEqual(["a.png", "b.png"]);
  });

  it("includes device-frame content urls and dedups across element types", () => {
    expect(collectImageUrls(project([shot("a", "a.png"), framed("f", "b.png"), framed("g", "a.png")])).sort())
      .toEqual(["a.png", "b.png"]);
  });

  it("returns empty when there are no image-bearing elements", () => {
    expect(collectImageUrls(project([]))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- collect`
Expected: FAIL — `collectImageUrls` is not exported (still named `collectScreenshotUrls`).

- [ ] **Step 3: Rename + widen the collector**

In `packages/core/src/assets/index.ts`, replace the `collectScreenshotUrls` function and its one call
site inside `loadProjectImages`:

```ts
/** Every distinct content assetUrl (screenshot + device-frame) in the project. Pure. */
export function collectImageUrls(project: Project): string[] {
  const urls = new Set<string>();
  for (const screen of project.screens) {
    for (const el of screen.elements) {
      if (el.type === "screenshot" || el.type === "device-frame") urls.add(el.assetUrl);
    }
  }
  return [...urls];
}
```

Then in `loadProjectImages`, change the one call:

```ts
    collectImageUrls(project).map(async (assetUrl) => {
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- collect && pnpm --filter @screenshot-studio/core typecheck`
Expected: PASS (3 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/assets/index.ts packages/core/src/assets/collect.test.ts
git commit -m "feat: preload device-frame content assets in the image collector"
```

---

### Task 3: Render the `device-frame` Group in both hosts

The mapper now emits a `Group`. Both render paths must realise it recursively: the export renderer
(`renderScreen`, plain Konva) and the interactive editor (`EditorStage`, react-konva).

**Files:**
- Modify: `packages/core/src/engine/render.ts` (recursive `buildNode` for the `Group` variant)
- Modify: `apps/web/components/EditorStage.tsx` (react-konva `<Group>` case; children non-interactive)

**Interfaces:**
- Consumes: `elementToNodeConfig` → `NodeConfig` incl. `Group` (Task 1).
- Produces: no signature change. `renderScreen(container, project, screenId, images)` is unchanged for
  callers; it just knows how to draw a `Group`. Interaction stays on the outer node in the editor.

- [ ] **Step 1: Recurse into the Group in `renderScreen`**

In `packages/core/src/engine/render.ts`, extend the `NodeConfig` import and replace `drawElement` with a
recursive builder (leave `renderScreen` and `drawBackground` unchanged):

```ts
import type { ImageCache, NodeConfig } from "./node-config.js";
```

```ts
function drawElement(layer: Konva.Layer, element: Element, images: ImageCache): void {
  layer.add(buildNode(elementToNodeConfig(element, images)) as Konva.Group | Konva.Shape);
}

/** Realise a NodeConfig as Konva nodes, recursing into the device-frame Group's children. */
function buildNode(nc: NodeConfig): Konva.Node {
  if (nc.konva === "Text") return new Konva.Text(nc.config);
  if (nc.konva === "Image") return new Konva.Image(nc.config);
  if (nc.konva === "Group") {
    const group = new Konva.Group(nc.config);
    for (const child of nc.children) group.add(buildNode(child) as Konva.Group | Konva.Shape);
    return group;
  }
  return new Konva.Rect(nc.config);
}
```

- [ ] **Step 2: Render the Group in `EditorStage`**

In `apps/web/components/EditorStage.tsx`:

(a) Add `Group` to the react-konva import:

```tsx
import { Stage, Layer, Text, Rect, Image as KonvaImage, Group, Transformer } from "react-konva";
```

(b) Replace the `screen.elements.map(...)` callback body so it keeps the full mapper result (`nc`) and
adds a `Group` branch. Children get `listening={false}` so clicks/selection/transform target the whole
frame, not a child:

```tsx
          {screen.elements.map((element) => {
            if (!element.visible) return null;
            const nc = elementToNodeConfig(element, images);
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
            if (nc.konva === "Text") {
              return (
                <Text
                  key={element.id}
                  {...nc.config}
                  {...interaction}
                  onDblClick={() => setEditing({ id: element.id, value: (nc.config as Konva.TextConfig).text ?? "" })}
                />
              );
            }
            if (nc.konva === "Image") {
              return <KonvaImage key={element.id} {...nc.config} {...interaction} />;
            }
            if (nc.konva === "Group") {
              return (
                <Group key={element.id} {...nc.config} {...interaction}>
                  {nc.children.map((child, i) =>
                    child.konva === "Image" ? (
                      <KonvaImage key={i} {...child.config} listening={false} />
                    ) : (
                      <Rect key={i} {...child.config} listening={false} />
                    ),
                  )}
                </Group>
              );
            }
            return <Rect key={element.id} {...nc.config} {...interaction} />;
          })}
```

- [ ] **Step 3: Typecheck + build + existing parity gates**

Run: `pnpm typecheck && pnpm --filter @screenshot-studio/web build && pnpm test:e2e -- parity screenshot-parity`
Expected: typecheck + build clean; the Phase 0 parity test and the Slice 2 screenshot-parity test both
still PASS unchanged — the `Group` path did not disturb text/shape/screenshot rendering.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/engine/render.ts apps/web/components/EditorStage.tsx
git commit -m "feat: render the device-frame group in the export and editor hosts"
```

---

### Task 4: Device-frame parity e2e (the gate) + fixture

Mirror the Slice 2 screenshot-parity gate for a framed screenshot: headed vs headless match, the
framed image is provably present (red at the slot centre), and the image is live (a missing asset
diverges to the black slot placeholder). This proves the composited Group is parity-safe.

**Files:**
- Create: `fixtures/slice-3-device-frame/app-store-screenshots.json`
- Create: `fixtures/slice-3-device-frame/assets/shot.png` (generated)
- Create: `e2e/device-frame-parity.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `startWebServer`, `renderScreenToPng`, `stripAlpha`, `PNG`, `pixelmatch` — same imports as
  `e2e/screenshot-parity.test.ts`. Drives the same `/render` route, now with a `device-frame` screen.

- [ ] **Step 1: Generate the fixture asset**

Run once to write a 400×400 solid-red PNG (pngjs is a root dependency):

```bash
node -e '
const { PNG } = require("pngjs");
const { writeFileSync, mkdirSync } = require("node:fs");
mkdirSync("fixtures/slice-3-device-frame/assets", { recursive: true });
const png = new PNG({ width: 400, height: 400 });
for (let i = 0; i < png.data.length; i += 4) { png.data[i]=220; png.data[i+1]=40; png.data[i+2]=40; png.data[i+3]=255; }
writeFileSync("fixtures/slice-3-device-frame/assets/shot.png", PNG.sync.write(png));
console.log("wrote shot.png");
'
```

Expected: `wrote shot.png`.

- [ ] **Step 2: Write the fixture project**

Create `fixtures/slice-3-device-frame/app-store-screenshots.json`:

```json
{
  "meta": { "name": "Slice 3 Device Frame", "schemaVersion": 1 },
  "platforms": ["apple"],
  "locales": ["en"],
  "fonts": [],
  "screens": [
    {
      "id": "framed",
      "name": "Framed",
      "platform": "apple",
      "device": "iphone",
      "locale": "en",
      "artboard": { "width": 660, "height": 1434 },
      "background": { "type": "solid", "color": "#101010" },
      "elements": [
        {
          "id": "hero-frame",
          "type": "device-frame",
          "x": 80,
          "y": 200,
          "width": 500,
          "height": 1000,
          "deviceType": "iphone",
          "assetUrl": "assets/shot.png",
          "fit": "cover"
        }
      ]
    }
  ]
}
```

- [ ] **Step 3: Write the parity e2e (with a POSITIVE-content assertion)**

The framed content covers the slot centre, so a working render paints the asset (red) there; a broken
Group (image not composited) leaves the black slot background. Box centre in artboard coords is
(80 + 500/2, 200 + 1000/2) = (330, 700); at `pixelRatio 2` that is PNG pixel (660, 1400) in the
1320×2868 image.

Create `e2e/device-frame-parity.test.ts`:

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
 * Slice 3 gate: proves the device-frame Group is parity-safe. (1) headed vs headless renders of a
 * screen with a device-frame match within tolerance; (2) the framed image's pixels are provably
 * present (red at the slot centre) — a Group that failed to composit the image would fail this;
 * (3) the image is live — a missing asset (black slot placeholder) differs by many pixels.
 */
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureDir = resolve(repoRoot, "fixtures/slice-3-device-frame");
const fixturePath = resolve(fixtureDir, "app-store-screenshots.json");
const tmpDir = resolve(repoRoot, "e2e/.tmp");
const screenId = "framed";
const pixelRatio = 2;
const target = { width: 1320, height: 2868 };
const PER_PIXEL_THRESHOLD = 0.1;
const MAX_MISMATCH_FRACTION = 0.001;

let server: RunningServer;

beforeAll(async () => {
  mkdirSync(tmpDir, { recursive: true });
  server = await startWebServer(3126);
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

describe("Slice 3 device-frame parity", () => {
  it("headed and headless match, and the framed image is present (red at slot centre)", async () => {
    const headed = stripAlpha(await renderScreenToPng({
      baseUrl: server.url, projectPath: fixturePath, screenId, pixelRatio, headless: false,
    }));
    const headless = stripAlpha(await renderScreenToPng({
      baseUrl: server.url, projectPath: fixturePath, screenId, pixelRatio, headless: true,
    }));

    const px = PNG.sync.read(headless);
    expect(px.width).toBe(target.width);
    expect(px.height).toBe(target.height);

    // Positive content: the asset (red) must actually be painted at the slot centre — not the black
    // slot background. This is what a broken Group composit fails; the diff check cannot catch it.
    const i = (1400 * px.width + 660) * 4;
    expect(px.data[i]).toBeGreaterThan(150);     // R high
    expect(px.data[i + 1]).toBeLessThan(100);    // G low
    expect(px.data[i + 2]).toBeLessThan(100);    // B low

    const fraction = mismatch(headed, headless) / (target.width * target.height);
    console.log(`[frame-parity] headed vs headless: ${(fraction * 100).toFixed(4)}%`);
    expect(fraction).toBeLessThan(MAX_MISMATCH_FRACTION);
  });

  it("proves the framed image is live: render differs from a missing-asset placeholder", async () => {
    const project = JSON.parse(readFileSync(fixturePath, "utf8"));
    project.screens[0].elements[0].assetUrl = "assets/does-not-exist.png";
    // Written INTO the fixture dir so the asset route's base (dirname of the project) still points at
    // the fixture's assets/ — the point is that does-not-exist.png 404s → black slot placeholder.
    const missingInDir = resolve(fixtureDir, "_missing.json");
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
fixtures/slice-3-device-frame/_missing.json
```

- [ ] **Step 5: Run the device-frame parity e2e**

Run: `pnpm test:e2e -- device-frame-parity`
Expected: PASS (2 tests). The `[frame-parity]` mismatch logs well under 0.1%. **If the red-pixel
assertion fails**, the image loaded but the Group did not composit it (child order or slot geometry) —
inspect the `Group` children in the mapper (Task 1) and re-run.

- [ ] **Step 6: Run the full e2e suite (all gates green together)**

Run: `pnpm test:e2e`
Expected: `parity.test.ts`, `editor.test.ts`, `screenshot-parity.test.ts`, and
`device-frame-parity.test.ts` all PASS.

- [ ] **Step 7: Commit**

```bash
git add fixtures/slice-3-device-frame e2e/device-frame-parity.test.ts .gitignore
git commit -m "test: add device-frame parity gate and fixture"
```

---

## Self-Review

**Spec coverage** (spec §-by-§):
- §1 thesis (multi-node composition stays pure/sync in the single map; native shapes; one geometry spec) → Task 1 (Group variant built by the pure map + `DEVICE_FRAME_SPECS`), Task 3 (both hosts realise the Group).
- §2 in-scope: `device-frame` additive + schemaVersion 1 → Task 1; `DEVICE_FRAME_SPECS` → Task 1; Group variant + native shapes + shared `computeImageFit` → Task 1; preloader collects device-frame assets via the existing `/api/asset` gate → Task 2; Group render in both hosts → Task 3; missing content → slot placeholder → Task 1 (child-drop) + Task 4 (live proof).
- §2 out-of-scope (other device types, bezel asset, authorable slot, inspector) → absent from all tasks.
- §3 components 1–7 (schema, geometry module, fit helper, Group map, render+readiness, preloader, Transformer sizing) → Task 1 (1–4), Task 3 (5, 7), Task 2 (6).
- §4 data flow (collectImageUrls incl. device-frame; both paths await; geometry from spec × box) → Task 2 + Task 1.
- §5 errors (missing content → slot placeholder, gate still fires; invalid → strict validator) → Task 1 (child-drop) + Task 2 (preloader omits failed asset).
- §6 interfaces → the Interfaces block of each task.
- §7 tests (schema, fit-helper regression, map, preloader-collect, transformer sizing, parity-e2e live + positive content) → Tasks 1, 1 (screenshot cases preserved), 1, 2, 3 (existing gates), 4.
- §8 DoD → satisfied across Tasks 1–4.

**§7 "Transformer sizing" test — deliberately covered by the existing editor gate, not a new unit test.**
The spec calls for a "resize a device-frame → correct committed width/height" check. The mechanism
(full-box body child + explicit `width`/`height` attrs on the Group) is realised in Tasks 1 and 3; its
runtime correctness rides on `e2e/editor.test.ts` (the existing Transformer gate) plus the Task 3 build
step. If a reviewer wants an isolated unit test, add it against the editor store — but the current gate
already exercises transform-commit on a mapped node, and the box-local geometry is unit-tested in Task 1.

**Ordering integrity:** the union widening and the mapper that handles it land together in Task 1, so the
tree type-checks after every task's final commit — no interim red. `collectImageUrls` (Task 2) depends
only on the schema (Task 1). The Group render (Task 3) depends on the `NodeConfig` Group variant (Task 1).
The e2e (Task 4) depends on all of the above. No import cycle: `engine/render` and `assets` depend on
`engine/node-config` and `model` (type-only), never the reverse; `node-config` imports `DEVICE_FRAME_SPECS`
from `model/device-frames` (value), a leaf module with no engine dependency.

**Placeholder scan:** none — every code step is complete; every run step has an exact command + expected result.

**Type consistency:** `NodeConfig` Group variant `{ konva: "Group"; config; children: NodeConfig[] }`
(Task 1) is consumed by `buildNode` (Task 3, `nc.konva === "Group"` → `nc.children`) and `EditorStage`
(Task 3, `<Group>` → `nc.children.map`). `collectImageUrls` (Task 2) replaces `collectScreenshotUrls`
at its only call site in `loadProjectImages` and its only test. `DeviceFrameElement` fields
(`deviceType`, `assetUrl`, `fit`) are consistent between the schema (Task 1), the mapper (Task 1), the
collector (Task 2), the unit tests (Tasks 1–2), and the fixture JSON (Task 4). `DEVICE_FRAME_SPECS` shape
(`bezelColor`, `frameCornerRadius`, `slotInset`, `slotCornerRadius`, `notch`) is defined once (Task 1)
and read once (the mapper, Task 1).
