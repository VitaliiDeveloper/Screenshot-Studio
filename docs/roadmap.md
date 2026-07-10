# Roadmap & Execution Plan

Scope, sequencing, and risks. This is the part that changes often.
Version 0.6, 10 July 2026.

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
- **Fonts & themes (Phase 3).** Google + custom upload UI; theme tokens applied across
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

Phase 2 was split by export risk. The bundle path landed before UI affordances and before the
dogfood CLI commands, so the later surfaces reuse the same verified orchestration.

| Slice | Delivers | Risk it retires |
|-------|----------|-----------------|
| **1 — Schema widening** ✅ | `Screen.platform` / `Screen.device` widen from literals to the platform-keyed union `apple → iphone/ipad`, `android → phone`; `Project.platforms` becomes a derived manifest; schema and `store-specs.json` stay in lockstep. | Unblocks Apple + Google bundle targets without a migration. |
| **2 — Bundle export orchestration** ✅ | Reuse one web server and one browser/context per export run, choose a free render-host port, export lead-size bundles grouped by `platform/device/locale`, zip the result, and add dimension/no-alpha tests. | Removes per-PNG cold starts and fixed-port collisions while proving the CLI can produce store-ready bundles. |
| **3 — Artboard target validation + UI export** ✅ | Validate/snap editable artboards to store targets and add the editor export button/dialog on top of the same bundle export path. | Prevents late `exportPixelRatio` failures and closes the UI/CLI parity exit criterion without introducing a second renderer. |
| **4 — Dogfood CLI management** ✅ | `screenshots dev`, `import`, and `screen add/list/rm/reorder`. | Makes the end-to-end project workflow manageable from the CLI after export is already trustworthy. |

Carry-ins resolved during Phase 2 (surfaced during the Phase 0/1 readiness review):
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
- **Editable artboard needs store-target validation — resolved in Slice 3.** The inspector now
  shows exact/proportional/invalid target status and offers explicit exact-size presets.
- **UI export button — resolved in Slice 3.** The editor exports through `POST /api/export`, which
  reuses the same headless `/render` path and bundle writer as the CLI.
- **Bulk export must reuse the server + browser + context — resolved in Slice 2.** Bundle export
  builds all matching entries and renders them through one web host and one browser context.
- **Drop the hardcoded `startWebServer` port — resolved in Slice 2.** The CLI render host chooses
  a free localhost port unless a caller supplies one.

**Phase 3 — Themes / templates / fonts UI — complete.**
Theme tokens, template library, font-management UI (upload, preview, Google). CLI
`font add <file>` and `theme set <id>` land here; font ingest precedes its UI in Slices 2–3. **System fonts are cut**
— see §3c. Sliced in §3c.

**Phase 3.5 — Editor UI polish — complete.**
One visual workbench system across toolbar, panels, inspector, resource dialogs, and empty states.
This is deliberately presentation-only: schema, renderer, storage, APIs, and workflows stay unchanged.

**Phase 3.6 — Editor workspace foundation — complete.**
The editor now has a compact permanent tool rail with collapsible Structure, Resources, and Add
shelves; `Focus` and isolated-artboard `Overview` modes; pointer-centred wheel/pinch zoom, Hand /
Space-drag pan, Fit, and canvas-owned zoom controls; `Dots | Grid | None` editor backgrounds; a
responsive inspector/layout contract; a data-driven Add catalog; and a realistic three-screen
dogfood project. Project schema and the public render/export/persistence contracts stay unchanged.
Sliced in §3d.

**Phase 4 — Locales & RTL.**
Multi-locale sets, RTL-native layouts. Sliced in §3e.

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

## 3c. Phase 3 execution slices

Phase 3 is three independent subsystems (fonts, themes, templates). It is sliced so the
contract-level change in each subsystem lands *before* the CLI that writes it and the UI that
drives it — the ordering Phase 2 used (bundle orchestration before the export button).

| Slice | Delivers | Risk it retires |
|-------|----------|-----------------|
| **1 — Font assets become files** ✅ | `FontAsset.data` (base64) → `FontAsset.path`; fonts served by the existing asset route; `source` widens to `uploaded \| google`; `registerProjectFonts` takes an injected resolver. | The storage model changing under features that already shipped. Touches the parity gate, so it goes first and alone. |
| **2 — Font ingest CLI** ✅ | `font add <file>`, `font add --google <family>`, `font list`, `font rm`; `findUnresolvedFonts` guards the no-system-fonts rule at CLI and UI export. | Network enters the toolchain. Confines it to `add`-time, never render/export. |
| **3 — Font management UI** ✅ | Upload / list / preview / apply; Google add-time materialization; font picker in the text inspector. | Low — sits on the schema and core that Slices 1–2 proved. |
| **4 — Theme model + `theme set`** ✅ | `themes/*.json` with its own Zod schema; pure `applyTheme(project, theme) → Project`; element `role?` field; CLI `theme set <id>`. | The token-resolution model. Baking keeps `elementToNodeConfig` untouched. |
| **5 — Theme UI** ✅ | Theme picker, role dropdown in the inspector, apply through the existing serialized project persistence boundary. | Low. |
| **6 — Template library** ✅ | Strict `templates/*.json`; create and select a fresh-id screen through the shared project persistence path. | Lowest; deliberately last. |

Decisions taken up front (they set the slice boundaries above):

- **Fonts are files, not base64 blobs.** `architecture.md` §5 previously justified base64 as making the
  deck "self-contained", but the project already is not: screenshots live in `screenshots/` and
  resolve by path through `apps/web/app/api/asset/route.ts`, and `AGENTS.md` already documents
  `assets/fonts/`. One font weight costs ~422 KB of base64 — `fixtures/phase-0-sample` is 440 KB,
  of which 439 KB is one Pacifico blob. Fonts adopt the model images already use. **Slice 1
  amended §5** to describe file-backed fonts.
- **System fonts are rejected, not deferred.** A system font is not embedded, so the same JSON
  renders different pixels in headless Chromium in CI than on the author's Mac. That breaks the
  §1 parity rule by construction. `architecture.md` §5 documents the file-backed-only rule.
- **Google fonts materialize at `add`-time.** `font add --google` fetches the bytes once, writes
  them to `assets/fonts/`, and records `source: "google"` as provenance. Render and export stay
  offline and deterministic, and `source` never becomes a branch in the renderer. Requesting
  `css2` **without** a browser User-Agent returns one full-coverage `.ttf` per weight; a modern
  UA returns `.woff2` split into ~7 `unicode-range` subsets, which would need a schema field and
  would break non-Latin locales in Phase 4.
- **Themes are baked, and `role` is the reference.** `theme set <id>` rewrites literals
  (`color`, `fontFamily`) into elements, so the renderer stays dumb and no migration is needed.
  Elements carry an optional `role?` (`heading` / `body` / `accent` / `surface`), set explicitly
  in the inspector; the literal is a materialized cache of that role. An element **without** a
  role is never touched by a theme — that is how a unique element opts out. Because `role`
  persists, re-running `theme set` with another theme still works: baking does not mean one-shot.
  This contradicts `architecture.md` §3 ("unknown theme ids fall back to defaults", which implies
  reference resolution at render time); **Slice 4 amends §3**. `role?` is additive and optional,
  so `schemaVersion` stays `1`.
- **Theme and template definitions live in `themes/*.json` and `templates/*.json`,** not in
  `Project`. They are inputs to a transformation, not something the renderer reads — so they do
  not belong in the render contract. `screenshots init` already scaffolds both directories.

---

## 3d. Phase 3.6 execution slices

Phase 3.6 deliberately strengthens the editor workspace before Phase 4 without widening the
render contract. Overview is a UI projection of `Project.screens`, not connected-canvas state.

| Slice | Delivers | Contract kept |
|-------|----------|---------------|
| **1 — Responsive workspace shell** ✅ | Compact permanent rail, collapsible Structure/Resources/Add shelves, stable top bar, and collapsible inspector that never covers canvas-owned zoom controls. | Workspace state is ephemeral; project JSON and persistence APIs are unchanged. |
| **2 — Canvas viewport interactions** ✅ | `Focus / Overview`, shared `25%…400%` zoom, pointer-centred Ctrl/Cmd-wheel and trackpad pinch, Hand/Space pan, Fit, and `Dots / Grid / None`. | Every artboard remains isolated and still renders through `elementToNodeConfig`. |
| **3 — Extensible Add catalog** ✅ | Searchable Basic/Media/Frames/Library catalog; text/shape insert through existing factories; Templates bridge; honest asset-picker-gated entries. | No invalid asset element or future schema member is written. |
| **4 — Three-screen dogfood demo** ✅ | Hero, Save Fast, and Stay Organized artboards using v1 text/shape/screenshot/device-frame elements plus one project-local generated app asset. | The sample parses with the strict v1 schema and exercises the same UI/headless asset path. |
| **5 — Closure and interaction hardening** ✅ | Live-resize drawer behavior, accurate Fit math, logical screenshot transforms, locked-layer guards, positioned inline text editing, bounded Inspector input, visible save failures, keyboard menus/dialogs, and desktop/compact/phone QA. | The strict v1 JSON and exported pixels stay stable; editor, parity, and export gates cover the corrected behavior. |

The accepted visual target and detailed interaction/responsive contract live in
`docs/specs/2026-07-10-phase3-6-editor-workspace-foundation-design.md`.

---

## 3e. Phase 4 execution slices

Phase 4 turns the existing per-screen locale label into a complete set workflow, then widens the
render contract for explicit RTL direction before exposing either capability through CLI and UI.
Automatic translation remains Phase 5.

| Slice | Delivers | Risk it retires |
|-------|----------|-----------------|
| **1 — Locale-set core contract** ✅ | Duplicate-free/set-equal locale manifest; pure clone/remove of a complete source locale with fresh screen/element ids and stable source order. | Locale features building on a stale manifest or ad-hoc screen loops. |
| **2 — RTL direction + render parity** ✅ | Additive screen direction, baked placement/alignment conversion, explicit Konva direction, and a real Arabic-font parity fixture. | Editor/headless bidi or geometry divergence. |
| **3 — Locale CLI** | `locale list/add/direction/rm` plus direction-aware lower-level screen creation. | Agent workflows rewriting project JSON inconsistently. |
| **4 — Editor locale workspace** | Active-locale selector/manager, locale-filtered Screens and Overview, locale-scoped reorder, RTL-aware insertion/editing, and template inheritance. | Flat multi-locale UI mutating the wrong global screen indices. |
| **5 — Export hardening + closure** | Safe locale path segments, per-platform/device/locale numbering, multi-locale export coverage, docs truth, and the Phase 4 gate. | Unsafe/free-form paths and incorrect store-slot ordering across locales. |

The accepted data, RTL-transform, CLI, editor, and export contract lives in
`docs/specs/2026-07-10-phase4-locales-rtl-design.md`.

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
