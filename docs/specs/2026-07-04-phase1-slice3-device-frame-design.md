# Phase 1 · Slice 3 — `device-frame` element

Design spec. Version 1.0, 4 July 2026.

This is **slice 3 of 5** in the Phase 1 decomposition (`docs/roadmap.md` §3a). Slices 1 (interactive
canvas + render-reuse) and 2 (`screenshot` + asset-loading parity) have landed; this slice builds
directly on Slice 2's `screenshot` compositing and the `elementToNodeConfig` map. Read
`docs/architecture.md` §2/§3 and `docs/editor.md` §7 first; where they disagree with this spec, they
win.

---

## 1. Goal — the thesis this slice retires

Slice 2 proved async image loading is parity-safe: one preloaded image maps to one `Konva.Image` in
the single render path. A `device-frame` adds the next risk: it is **one element that composites
several nodes** — a phone bezel wrapping a screenshot **clipped** to the bezel's screen slot — and
that composition must render identically in the editor and the export.

> **The thesis: multi-node composition stays pure and synchronous in the single render path.**
> `elementToNodeConfig` gains a `Group` variant whose children are computed by the *same pure map*
> from the *same preloaded image cache* — no I/O, no second render tree. The frame is drawn with
> **native Konva vector shapes** (rounded rects + a notch), not a rasterized bezel image, so it is
> resolution-independent at any zoom or export `pixelRatio`, and the frame body and the screen slot
> derive from **one geometry spec** and therefore cannot drift apart.

The schema is widened **additively** — a new discriminated-union member — so no migration is needed
and existing v1 projects stay valid. `schemaVersion` stays `1`.

---

## 2. Scope

**In:**

- A new `device-frame` element type (self-contained): base fields + `deviceType: "iphone"`,
  `assetUrl` (the screenshot placed in the slot), `fit: "cover" | "contain"`. Added as a member of
  the existing `discriminatedUnion("type", …)`. **`schemaVersion` stays `1`** — additive, no
  migration.
- A hardcoded `DEVICE_FRAME_SPECS` map (`core/model/device-frames.ts`): per `deviceType`, the frame
  geometry expressed as **fractions of the element's own box** (bezel color, frame + slot corner
  radii, slot inset, notch size/position) so the whole frame scales with the element and the slot is
  always aligned to the frame body by construction.
- A `Group` variant on `NodeConfig` and a native-shape `device-frame` mapping in
  `elementToNodeConfig`: frame body rect, slot-background rect, the clipped content image (reusing
  the extracted fit helper), and the notch — all vector, all box-local.
- A shared `computeImageFit(image, box, fit)` helper extracted from the current inline `screenshot`
  cover/contain math, reused by both `screenshot` and `device-frame` (DRY). Returns coords relative
  to `(0,0)` of the given box; callers add the absolute origin.
- The `Group` render case in both hosts: `renderScreen` (export) and `EditorStage` (editor) recurse
  into `children`.
- The image preloader also collects `device-frame.assetUrl` (rename `collectScreenshotUrls` →
  `collectImageUrls`). No new asset channel — the content screenshot flows through the **existing**
  `/api/asset` route and the existing readiness gate.
- **Missing content asset** → the slot shows its background placeholder inside the frame; never a
  crash or a hang (editor.md §7).

**Out (later slices / follow-ups):**

- Other device types (`ipad`, `android-phone`, `tablet`) — `deviceType` is a `z.literal("iphone")`
  for now; widening it also needs `Screen.platform`/`device` widened, which is structural and out of
  Phase 1's slice scope (see Slice 2 spec §2).
- A rasterized / photo-real bezel asset — a later fidelity upgrade. The native frame proves the
  compositing/clipping mechanism; a nicer bezel can swap in behind the same element contract without
  reworking it. (This is a deliberate, ratified deviation from the roadmap's literal "bundled iPhone
  bezel *asset*" wording — see §9.)
- Authorable slot geometry, per-element frame color, `cornerRadius` on the frame element itself — the
  bundled spec owns geometry; the SVG-free frame already draws rounded corners.
- Inspector controls / missing-asset warning UI — Slice 5.

**Chosen defaults** (decided during brainstorming; documented so they can be revisited):

- **Native Konva shapes, not a bezel image.** A decoded SVG/PNG bezel is a fixed-size raster;
  upscaling it at export `pixelRatio` (e.g. a ~1200px box → ~3600 device-px at 3×) is bitmap scaling,
  and headed-vs-headless SVG rasterization is exactly the kind of thing that drifts — the opposite of
  what parity wants. Native rects/notch stay vector in the scene graph: crisp at any ratio. They also
  add **zero** new asset-loading surface, so this slice does not re-prove Slice 2's already-retired
  "asset must decode before `__stageReady`" risk.
- **Self-contained element.** One `device-frame` = one framed screenshot. The element owns its
  content `assetUrl`; there is no separate underlying `screenshot` to keep manually aligned.
- **No schema-version bump.** Adding a union member is backward-compatible (same rationale as Slice
  2). The first *structural* change earns the first migration.

---

## 3. Architecture & components

1. **Schema (`model/schema.ts`).** `DeviceFrameElement = elementBase + { type: "device-frame",
   deviceType: z.literal("iphone"), assetUrl: z.string().min(1), fit: z.enum(["cover","contain"])
   .default("cover") }`, `.strict()`. Add it to `Element = discriminatedUnion("type", [TextElement,
   ShapeElement, ScreenshotElement, DeviceFrameElement])`. Nothing else in the schema changes.

2. **Frame geometry (`core/model/device-frames.ts` — new).**
   `DEVICE_FRAME_SPECS: Record<"iphone", DeviceFrameSpec>` where a spec is, all as **fractions of the
   element box** (so the frame scales and the slot always sits inside the body):
   ```
   DeviceFrameSpec {
     bezelColor: string          // hex, the frame body fill
     frameCornerRadius: number   // fraction of box width — outer silhouette
     slotInset: { top; right; bottom; left }   // fractions of box W/H
     slotCornerRadius: number    // fraction of slot width — the screen corners
     notch: { widthFrac; heightFrac; topFrac; cornerRadius }  // the top pill
   }
   ```
   Pure data; no URL, no I/O.

3. **Fit helper (`core/engine/node-config.ts`).** Extract the current inline cover/contain math into
   `computeImageFit(image, box: { width; height }, fit): { x; y; width; height; crop? }`, **relative
   to `(0,0)` of `box`**. The `screenshot` branch keeps its behaviour by adding `element.x/y` to the
   helper's result; the `device-frame` content child adds only the slot's local offset (the Group
   carries `element.x/y`). A regression test asserts a `screenshot`'s rendered geometry is unchanged
   after the extraction.

4. **Map (`core/engine/node-config.ts`).** `NodeConfig` gains
   `{ konva: "Group"; config: Konva.GroupConfig; children: NodeConfig[] }`.
   `elementToNodeConfig(deviceFrame, images?)` returns a `Group` whose `config` sets `x/y/rotation/
   opacity` **and explicit `width`/`height` = the element box** (see §3.6 for why both matter), with
   children in **box-local** coords, bottom-to-top:
   1. **Frame body** — a full-box (`0,0 → w,h`) rounded `Rect`, `fill: bezelColor`,
      `cornerRadius: frameCornerRadius·w`. This is the outer silhouette *and* the full-box child the
      Transformer measures.
   2. **Slot background** — a rounded `Rect` at the slot inset, `fill: "#000"`. Gives a `contain`
      screenshot something to letterbox on and gives a **missing asset** a slot-shaped placeholder
      inside the frame.
   3. **Content image** — present only if `images.get(assetUrl)` hit: a `Konva.Image` sized/cropped
      to the **slot box** via `computeImageFit`, `cornerRadius: slotCornerRadius·slotWidth`. `cover`
      crops to fill the slot; `contain` centres within it. Absent asset → this child is omitted and
      the slot background shows through (no crash, no hang).
   4. **Notch** — a small rounded `Rect` (pill), `fill: bezelColor`, centred near the top from the
      `notch` fractions, drawn on top of the content.
   `text`/`shape`/`screenshot` are unchanged (they never return `Group`).

5. **Render + readiness.** `renderScreen` (export) and `EditorStage` (editor) each add a `Group`
   case beside their `Text`/`Rect`/`Image` cases: build a `Konva.Group` / react-konva `<Group>` from
   `config` and recurse into `children`. In the editor, interaction props (`draggable`, `ref`,
   `onClick`, `onDragEnd`, `onTransformEnd`) attach to the **outer Group only** — identical to every
   other element — so the frame moves/resizes as one unit. No change to `__stageReady`: the content
   image already flows through the existing preload gate.

6. **Preloader (`core/assets`).** Rename `collectScreenshotUrls` → `collectImageUrls`; it now also
   adds each `device-frame.assetUrl`. `loadProjectImages` and the `/api/asset` resolve path are
   otherwise unchanged — the framed screenshot uses the exact same asset channel proven in Slice 2.

7. **Transformer sizing (the one interaction subtlety).** A `Konva.Group`'s `getClientRect` is the
   union of its children, so the full-box **frame body** child is what gives the Transformer the
   right visual box; the explicit **`width`/`height` attrs** on the Group are what make
   `onTransformEnd`'s `node.width() * scaleX` read the right committed size. Both are required. On
   transform-end the store commits new `width`/`height`; the re-render recomputes every child from
   the new box (fractions of the box), so the frame re-lays-out correctly.

---

## 4. Data flow

```
project ─▶ collectImageUrls(project)          # now includes device-frame.assetUrl
        ─▶ loadProjectImages(project, resolve) ─┐  (awaited on BOTH paths, unchanged gate)
        ─▶ registerProjectFonts(project.fonts)  ─┤
                                                 ▼
   render:  renderScreen(container, project, id, images)
              └▶ elementToNodeConfig(deviceFrame, images)
                   ─▶ Group { children: [frameBody, slotBg, contentImage?, notch] }
   ready:   window.__stageReady = true   (only after images + fonts resolve — unchanged)
```

Geometry: `DEVICE_FRAME_SPECS[deviceType]` × the element box → box-local children. The frame body and
the slot come from one spec, so they cannot misalign; `computeImageFit` against the **slot** box
clips the screenshot to the screen.

## 5. Error handling & states (editor.md §7)

- **Missing / failed content asset** → the content child is omitted; the slot background rect shows a
  slot-shaped placeholder inside an otherwise-complete frame. The render still completes and
  `__stageReady` still fires (a missing asset must not hang the export).
- **Invalid project** (unknown key, bad `deviceType`/`fit`) → the existing strict validator rejects
  it loudly, unchanged.

## 6. Interfaces (contracts between units)

- `DeviceFrameElement` (Zod) + its inferred type — the document contract.
- `DEVICE_FRAME_SPECS: Record<"iphone", DeviceFrameSpec>` — pure geometry data.
- `computeImageFit(image, box, fit): { x; y; width; height; crop? }` — pure, box-relative; shared by
  `screenshot` and `device-frame`.
- `elementToNodeConfig(element, images?): NodeConfig` — pure; `NodeConfig` now includes `Group`.
- `collectImageUrls(project): string[]` — screenshot **and** device-frame asset urls, deduped.
- `renderScreen(container, project, screenId, images): Konva.Stage` — export/render entry, unchanged
  signature; gains a `Group` case internally.

## 7. Testing

- **Schema unit** — a valid `device-frame` parses; unknown key, bad `deviceType`, bad `fit` are
  rejected; `fit` defaults to `"cover"`.
- **Fit-helper regression** — `computeImageFit` extraction leaves `screenshot`'s rendered geometry
  identical (cover crop + contain box unchanged for the existing cases).
- **Map unit** — `device-frame` + a stub image → a `Group` with children `[frameBody, slotBg,
  contentImage, notch]`: frame body is full-box with `frameCornerRadius`; the content image is sized
  to the slot box with `slotCornerRadius`; a **missing** image drops the content child (frame + slot
  bg + notch remain). Children coords are box-local (Group carries `x/y`).
- **Preloader unit** — `collectImageUrls` collects and dedups both `screenshot` and `device-frame`
  asset urls across multiple elements.
- **Transformer sizing** — resizing a `device-frame` via the Transformer commits the correct
  `width`/`height` (the full-box child + width/height-attr combination reads back right).
- **Parity e2e (the real gate)** — extend the harness with a fixture screen containing a
  `device-frame`: headed vs headless renders match within tolerance **and** the framed image is
  provably present (the render differs from the same screen with the content asset removed — the
  Slice 2 "asset live" assertion, now through the Group path). This proves the composited frame is
  parity-safe.

## 8. Definition of done

- `device-frame` is a valid element type; `schemaVersion` is still `1`; existing v1 fixtures load
  unchanged.
- `DEVICE_FRAME_SPECS` owns the frame geometry; the frame is drawn with native Konva shapes; the slot
  and body come from one spec and stay aligned.
- `elementToNodeConfig` stays pure and gains the `Group` variant; `computeImageFit` is shared and the
  `screenshot` regression passes; both hosts render the `Group` from the same map.
- The preloader collects device-frame assets through the existing `/api/asset` gate; `__stageReady`
  is unchanged.
- The Transformer resizes a `device-frame` as one unit with correct committed dimensions.
- Missing content assets show a slot placeholder, never crash or hang; the parity e2e with a
  device-frame passes and proves the framed image is live. Out-of-scope items (§2) are absent.

## 9. Deviation note (roadmap alignment)

`docs/roadmap.md` §3a describes Slice 3 as a "bundled iPhone bezel **asset**." This spec draws the
frame with **native Konva vector shapes** instead, ratified during brainstorming. Rationale: the
slice's stated risk is "bezel fidelity + slot alignment … **separable from asset-loading**," and
asset-loading was Slice 2's already-retired risk. A rasterized bezel would (a) re-prove that solved
risk through a new preload path and (b) introduce SVG/PNG upscaling at export `pixelRatio`, a parity
liability. Native shapes retire the *actual* net-new risk — pure multi-node composition/clipping in
the single render path — more directly, and a photo-real bezel can later swap in behind the same
element contract without reworking it.
