# Roadmap & Execution Plan

Scope, sequencing, and risks. This is the part that changes often.
Version 0.5, 6 July 2026.

The guiding principle: ship a **thin vertical slice** first, and prove the riskiest thesis
before building on top of it. Everything visually impressive (connected canvas, AI, themes,
templates) lives *after* the MVP.

---

## 1. MVP scope (thin slice: import → edit → export)

What makes the cut for the first usable, dogfoodable version:

- Elements: `text`, `screenshot`, `device-frame`, `shape`.
- A basic inspector (type-specific properties).
- A screen list — **isolated artboards only** (no connected canvas).
- Save / load the project JSON (strict Zod validation).
- Apple + Google export at verified sizes.
- CLI: `init`, `dev`, `export`.

**Out of the MVP (post-MVP):** snapping & smart guides, undo/redo *UI*, element grouping, the
font-management UI, themes, templates, locales / RTL, connected canvas, AI assistance.

**State model is the one exception we design up front.** The editor store uses immutable
state / patches (Zustand + Immer) from day 0 so undo/redo can be added later without a
rewrite. We ship without the undo *buttons*, but not without the architecture for them.

---

## 2. Feature scope (where each area lands)

- **Editor (Phase 1).** Konva stage with zoom/pan; move/resize/rotate with handles; a layers
  panel (z-order, lock, hide, rename — **no grouping**); inspector. Snapping, undo/redo UI, and
  element grouping come once the basics are stable (grouping pulls in a selection model, nested
  transforms, serialization, and z-order edge cases, so it stays out of the thin slice).
- **Export (Phase 2).** Verified store bundles from `store-specs.json`, alpha-channel removal,
  Vitest dimension tests, zip by platform/device/locale.
- **Fonts & themes (Phase 3).** System + Google + custom upload UI; theme tokens applied across
  all screens; a template library of reusable layouts. (Minimal font *embedding* ships earlier
  with export — see architecture.md §5.)
- **Locales & RTL (Phase 4).** Per-language screenshot sets; mirrored layout/alignment for
  Arabic/Hebrew so slides are RTL-native, not just translated.
- **AI (Phase 5).** A bonus on top of a deterministic core, never a prerequisite.

---

## 3. Phased plan

**Phase 0 — Schema + renderer parity spike (the de-risking phase).**
Project schema + validator (Zod), a sample project, CLI `init` / `export`, and the
**render/export parity proof**: one JSON → a pixel-correct PNG from both the UI button and
`cli export`. Decide and wire the export renderer (headless Playwright vs node-canvas — see
architecture.md §2). Includes minimal font embedding, since text is the hardest parity case.
*This phase must pass before anything else is built.*

**Phase 1 — Web editor (basics).**
Elements (`text`, `shape`, `screenshot`, `device-frame`), inspector, layers panel (no
grouping), screen management (isolated). Immutable state model in place; undo/redo UI,
snapping, and grouping deferred.

**Phase 2 — Verified export.**
`store-specs.json` as the source of truth, alpha removal, dimension tests, zip bundles by
platform/device/locale. Export is now "rock-solid." Also completes the export-adjacent CLI
surface: `dev` (run the editor), `import` (ingest raw captures by directory convention), and
`screen add / list / rm / reorder` — the commands the bundle workflow needs to be dogfoodable
end to end.

## 3b. Phase 2 execution slices

Phase 2 is split by export risk. The bundle path lands before UI affordances and before the
remaining dogfood CLI commands, so every later surface reuses the same verified orchestration.

| Slice | Delivers | Risk it retires |
|-------|----------|-----------------|
| **1 — Schema widening** ✅ | `Screen.platform` / `Screen.device` widen from literals to the platform-keyed union `apple → iphone/ipad`, `android → phone`; `Project.platforms` becomes a derived manifest; schema and `store-specs.json` stay in lockstep. | Unblocks Apple + Google bundle targets without a migration. |
| **2 — Bundle export orchestration** ✅ | Reuse one web server and one browser/context per export run, choose a free render-host port, export lead-size bundles grouped by `platform/device/locale`, zip the result, and add dimension/no-alpha tests. | Removes per-PNG cold starts and fixed-port collisions while proving the CLI can produce store-ready bundles. |
| **3 — Artboard target validation + UI export** ✅ | Validate/snap editable artboards to store targets and add the editor export button/dialog on top of the same bundle export path. | Prevents late `exportPixelRatio` failures and closes the UI/CLI parity exit criterion without introducing a second renderer. |
| **4 — Dogfood CLI management** | `screenshots dev`, `import`, and `screen add/list/rm/reorder`. | Makes the end-to-end project workflow manageable from the CLI after export is already trustworthy. |

Carry-ins to resolve as Phase 2 opens (surfaced during the Phase 0/1 readiness review):
- **Schema must widen beyond apple/iphone/solid — resolved in Slice 1.** The Zod schema now
  supports the Phase 2 target set (`apple/iphone`, `apple/ipad`, `android/phone`) and the schema
  device set is pinned to `store-specs.json`. This was additive (`z.literal` → `z.enum`), so
  existing v1 documents stayed valid and no migration was required. Reserve migrations for
  genuine structural changes (e.g. `mode: isolated | connected`).
- **Bundle strategy: one lead size per device (the "scale down" premise doesn't hold within
  Apple).** Apple's accepted iPhone sizes have *slightly different aspect ratios*
  (1320×2868 ≈ 0.4603 vs 1284×2778 ≈ 0.4622 …), so a single artboard cannot export to all of
  them — `exportPixelRatio` correctly throws. Since Apple down-scales the lead size to smaller
  slots itself, the Phase 2 bundle targets **the lead size per device** (6.9″ iPhone, 13″ iPad,
  the Google presets); other accepted sizes stay in `store-specs.json` as opt-in explicit
  targets, never implicit bundle members.
- **Editable artboard needs store-target validation.** Slice 5 made artboard `width/height`
  freely editable, but `exportPixelRatio` throws when the artboard aspect ratio ≠ the target's.
  Validate/snap artboards against store sizes at edit time, not only at export time.
- **UI export button.** The editor still has no export control — export is CLI-only today,
  while the parity exit criterion and `editor.md` §4/§6 are phrased around a UI export button.
  It lands in Phase 2 on the same bundle path as the CLI (one export path, not two).
- **Bulk export must reuse the server + browser + context.** Today `export` starts a web server
  and `render-driver` launches a fresh Chromium per call; N screens × M sizes × L locales would
  cold-start per PNG. Reuse one server and one browser context across the bundle.
- **Drop the hardcoded `startWebServer` port.** Default `3100` will collide once bundle/parallel
  export runs more than one server; pick a free port (or share one server) before parallelizing.

**Phase 3 — Themes / templates / fonts UI.**
Theme tokens, template library, full font-management UI (upload, preview, system/Google).
CLI `font add <file>` and `theme set <id>` land here, alongside their UI.

**Phase 4 — Locales & RTL.**
Multi-locale sets, RTL-native layouts.

**Phase 5 — Agent workflows.**
`AGENTS.md` recipes: copy generation, auto-layout, locale translation via the CLI agent
(subscription, no keys). Local image processing (background removal / auto-crop) via a WASM
model or a local utility.

**Phase 6 — Connected canvas + polish.**
Cross-screen elements with precise export crops, the optional skill installer, and community
polish (README GIF, `CONTRIBUTING.md`, example projects, SPDX headers on source files).

Distribution decisions parked for this phase (fine for the dogfood era, blocking for `npx`):
- **Package the CLI.** Today `pnpm screenshots` runs TypeScript via `tsx` inside the repo —
  there is no built/published binary. Zero-config use outside the repo needs a real build.
- **CLI weight.** The export path requires the full `apps/web` Next host (the §2 parity
  decision's accepted cost). Decide how distribution ships it: repo clone stays the primary
  channel, or the package bundles a prebuilt web host.

---

## 3a. Phase 1 execution slices

Phase 1 (the web editor) is 6–7 subsystems — too large for one spec. It is sliced by **risk**,
not by UI panel, and each slice is its own spec → plan → implementation cycle. Order is fixed;
a later slice may not start before the one it depends on lands.

| Slice | Delivers | Risk it retires |
|-------|----------|-----------------|
| **1 — Interactive canvas + render-reuse** ✅ | Konva editor stage (select/move/resize/rotate, inline text edit) over a Zustand+Immer patch store; save/load via a disk-backed API route; export still passes parity. Only `text` + `shape` (schema unchanged). | **Highest.** Proves the interactive editor shares the *single* render path instead of forking a second react-konva tree — the Phase 0 parity thesis applied to an interactive surface. |
| **2 — `screenshot` + asset-loading parity** ✅ | `screenshot` element type (additive union member, `assetUrl`/`fit`/`cornerRadius`); a `core` image preloader awaited before the render-ready gate; a web-host asset route feeding the same URL to `/editor` and `/render`. Schema stays v1 (additive — no migration). | Adds **asset-loading parity**: every image must decode before `__stageReady` or CLI export screenshots a missing-image frame — the direct analog of the Phase 0 font-load race. |
| **3 — `device-frame`** ✅ | `device-frame` element type: bundled iPhone bezel asset, screen-slot compositing/clipping over a `screenshot`. Depends on Slice 2. | Bezel fidelity + slot alignment as a new parity surface; separable from asset-loading. |
| **4 — Left panel** ✅ | Screens section (dnd-kit reorder = export order) + Layers section (z-order, lock, hide, rename). No grouping. | Medium — multi-screen state, reorder as the shared UI/CLI ordering source. |
| **5 — Inspector + toolbar** ✅ | Full per-type inspector, no-selection artboard/background editor, toolbar element tools (insert-on-click for `text`/`shape`) + zoom controls. | Low — sits on the store and mapper the earlier slices established. |

**The single source of truth for element rendering is `core/engine`'s `elementToNodeConfig`**
(introduced in Slice 1): a pure `element → Konva props` map consumed by both the static
`renderScreen` (export) and the interactive editor stage. Deferred to their own later phases,
not slices: snapping/guides, undo/redo *UI*, grouping, themes, templates, locales/RTL.

---

## 4. Technical risks

1. **Render/export parity (highest).** UI (browser Konva) vs CLI (headless) must produce the
   same pixels, especially for text. *Mitigation:* the Phase 0 spike; prefer a headless browser
   so parity is by construction. **Exit criterion: from the same project JSON, the UI export
   button and `cli export` produce a PNG with exact target dimensions, no alpha channel, and a
   visual diff within tolerance** (not byte-identical — PNG metadata/compression can differ).
   Do not proceed to Phase 1 until this holds.
2. **Store spec drift.** Apple/Google change sizes and rules. *Mitigation:* `store-specs.json` +
   tests, not hardcoded values.
3. **Font fidelity.** Custom fonts must embed and render identically across both renderers.
   *Mitigation:* ship minimal embedding with the Phase 0 spike, not as a late feature.
4. **Scope creep.** The vision is large. *Mitigation:* hold the line on the thin MVP; defer
   connected canvas and AI explicitly.
