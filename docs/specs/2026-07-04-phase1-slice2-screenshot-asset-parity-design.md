# Phase 1 · Slice 2 — `screenshot` element + asset-loading parity

Design spec. Version 1.0, 4 July 2026.

This is **slice 2 of 5** in the Phase 1 decomposition (`docs/roadmap.md` §3a). Slice 1 (interactive
canvas + render-reuse) has landed; this slice builds directly on its `elementToNodeConfig` map and
readiness pattern. Read `docs/architecture.md` §2/§3/§5 and `docs/editor.md` §5/§7 first; where they
disagree with this spec, they win.

---

## 1. Goal — the thesis this slice retires

Slice 1 proved the interactive editor and the export renderer share one **pure, synchronous**
element→Konva map. A `screenshot` breaks the synchronous assumption: `screenshot → Konva.Image`
needs an **async-decoded `HTMLImageElement`**, and the export renderer screenshots the stage the
moment it is "ready".

> **The thesis: asset loading is parity-safe in the single render path.** Every image decodes
> **before** `window.__stageReady` fires — the exact analog of the Phase 0 font-load race — so the
> CLI export can never capture a frame with a missing image, and the editor and export load the
> *same* asset URL. The `elementToNodeConfig` map stays pure: it looks images up in a preloaded
> cache, it never performs I/O.

The schema is widened **additively** — a new discriminated-union member — so no migration is needed
and existing v1 projects stay valid.

---

## 2. Scope

**In:**

- A new `screenshot` element type: base fields + `assetUrl` (string), `fit: "cover" | "contain"`,
  `cornerRadius` (number ≥ 0, default 0). Added as a member of the existing
  `discriminatedUnion("type", …)`. **`schemaVersion` stays `1`** — additive change, no migration.
- A `core` image preloader (`loadProjectImages`) that decodes every `screenshot.assetUrl` into an
  `HTMLImageElement` cache, awaited before render — mirroring `registerProjectFonts`.
- A web-host **asset route** that serves the project's asset files over HTTP, so `/editor` and
  `/render` resolve the *same* URL for a given `assetUrl`.
- `elementToNodeConfig(element, images?)` — the map gains an **optional** image-cache argument (a
  pure lookup; unused by `text`/`shape`, so their existing call sites are unchanged). `screenshot`
  maps to a `Konva.Image` config, computing `crop` for
  `cover` and a fitted centred box for `contain` from the loaded image's natural size.
- `renderScreen(container, project, screenId, images)` and the editor stage both pass their
  preloaded cache. `RenderStage` and `/editor` `await loadProjectImages` (alongside fonts) before
  drawing / before `__stageReady`.
- **Missing asset** → a visible placeholder (grey rect) on the canvas; never crash (editor.md §7).

**Out (later slices / follow-ups):**

- `device-frame` — Slice 3 (depends on this slice; bundled bezel + screen-slot compositing).
- `crop` (arbitrary crop rect authored in the document) — a follow-up; `cover`/`contain` covers the
  MVP need and `cover` already uses Konva's crop internally.
- Widening `Screen.platform` / `Screen.device` beyond `apple` / `iphone` (e.g. android, ipad) — that
  *would* be structural and require a migration; explicitly not in this slice.
- The inspector's missing-asset **warning** and screenshot property controls — Slice 5 (inspector).
  This slice ships only the canvas placeholder.

**Chosen defaults** (decided during brainstorming; documented so they can be revisited):

- **Served path, not base64.** `assetUrl` is a reference resolved by the asset route
  (architecture §3), not embedded base64. Fonts are base64 because a single font is small and must
  be self-contained (§5); screenshots are multi-MB and embedding them would bloat the git-tracked
  source-of-truth JSON. Same served URL feeds both render paths → parity by construction.
- **No schema-version bump.** Adding union members is backward-compatible; a no-op version-bump
  migration is ceremony with no payoff (YAGNI). The first *structural* change earns the first
  migration.

---

## 3. Architecture & components

1. **Schema (`model/schema.ts`).** `ScreenshotElement = elementBase + { type: "screenshot",
   assetUrl: string.min(1), fit: enum(["cover","contain"]).default("cover"), cornerRadius:
   number.min(0).default(0) }`, `.strict()`. Add it to `Element = discriminatedUnion("type",
   [TextElement, ShapeElement, ScreenshotElement])`. Nothing else in the schema changes.

2. **Image preloader (`core/assets` — new module).** `loadProjectImages(project, resolve):
   Promise<ImageCache>` where `ImageCache = Map<string, HTMLImageElement>` keyed by `assetUrl`, and
   `resolve(assetUrl) => string` turns a document `assetUrl` into a loadable URL. `core` stays
   network-agnostic: the host passes `resolve` (the asset-route URL builder); `core` only decodes.
   Each image loads via `new Image()` + `decode()`; the returned promise settles only when all have
   decoded (or failed — a failed asset is simply absent from the cache, surfaced as a placeholder).

3. **Asset route (`apps/web/app/api/asset/route.ts`).** `GET /api/asset?path=<relative>` reads a
   file from the project's asset base directory (derived from `PROJECT_PATH`'s directory, same
   local-file model as `/render` and `/api/project`) and streams it with the right content-type.
   Path traversal outside the base dir is rejected. This is the `resolve` target: `assetUrl` →
   `/api/asset?path=<assetUrl>`.

4. **Map (`core/engine/node-config.ts`).** `NodeConfig` gains a variant
   `{ konva: "Image"; config: Konva.ImageConfig }`. `elementToNodeConfig(element, images?)`:
   `screenshot` looks up `images.get(assetUrl)`; if present it returns an `Image` config with the
   decoded `image`, `cornerRadius`, and — from the image's natural size and the element box — a
   `cover` `crop` (Konva's object-fit-cover recipe) or a `contain` fitted/centred width/height. If
   absent it returns a placeholder `Rect` config (grey, so a missing asset is visible, never a
   crash). `text`/`shape` ignore the second argument and are unchanged.

5. **Render + readiness.** `renderScreen` takes the `images` cache and passes it through to the map.
   `RenderStage` and `/editor` `await loadProjectImages` **and** `registerProjectFonts` before
   drawing; `RenderStage` sets `window.__stageReady = true` only after both resolve — extending the
   Phase 0 gate so a screenshot render is never captured half-loaded.

---

## 4. Data flow

```
project ─▶ loadProjectImages(project, resolve)   ─┐  (awaited on BOTH paths)
        ─▶ registerProjectFonts(project.fonts)    ─┤
                                                   ▼
   render:  renderScreen(container, project, id, images)
              └▶ elementToNodeConfig(el, images) ─▶ Konva.Image | placeholder Rect
   ready:   window.__stageReady = true   (only after images + fonts resolve)
```

`resolve` maps `assetUrl → /api/asset?path=…`; the editor and the headless export use the same
route, so the same bytes render on both paths.

## 5. Error handling & states (editor.md §7)

- **Missing / failed asset** → the asset is absent from the cache; the map yields a grey placeholder
  rect at the element's box. The render still completes and `__stageReady` still fires (a missing
  asset must not hang the export). The inspector warning is Slice 5.
- **Invalid project** (unknown key, bad `screenshot` field) → the existing strict validator rejects
  it loudly, unchanged.

## 6. Interfaces (contracts between units)

- `ScreenshotElement` (Zod) + its inferred type — the document contract.
- `loadProjectImages(project, resolve): Promise<ImageCache>` — host-agnostic; `resolve` is injected.
- `elementToNodeConfig(element, images?): NodeConfig` — pure; `NodeConfig` now includes `Image`.
- `renderScreen(container, project, screenId, images): Konva.Stage` — export/render entry.
- `GET /api/asset?path=<relative> → 200 bytes | 400 | 404` — the browser/headless asset channel.

## 7. Testing

- **Schema unit** — a valid `screenshot` parses; unknown key and bad `fit` are rejected; defaults
  (`fit: "cover"`, `cornerRadius: 0`) apply.
- **Map unit** — `screenshot` + a stub image (natural size) → `Image` config with expected `crop`
  (cover) / fitted box (contain) and `cornerRadius`; missing image → placeholder `Rect`.
- **Preloader unit** — decodes a set into a full cache; a failed URL is absent, not thrown.
- **Parity e2e (the real gate)** — extend the harness with a fixture screen containing a
  `screenshot`: headed vs headless renders match within tolerance **and** the image is provably
  present (the render differs from the same screen with the asset removed — the direct analog of the
  Phase 0 font-live assertion). This proves the readiness gate covers images.

## 8. Definition of done

- `screenshot` is a valid element type; `schemaVersion` is still `1`; existing v1 fixtures load
  unchanged.
- `loadProjectImages` + the asset route serve one URL to both render paths; `elementToNodeConfig`
  stays pure and gains the `Image` variant; `renderScreen` threads the cache.
- `RenderStage` gates `__stageReady` on images **and** fonts; the parity e2e with a screenshot
  passes and proves the image is live.
- Missing assets render a placeholder, never crash or hang. Out-of-scope items (§2) are absent.
