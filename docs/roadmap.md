# Roadmap & Execution Plan

Scope, sequencing, and risks. This is the part that changes often.
Version 0.9, 10 July 2026.

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
  transforms, serialization, and z-order edge cases, so it stays out of the thin slice). Phase 6
  closes undo/redo, snapping, and insertion of existing media types; Phase 7 owns multi-select and
  grouping.
- **Export (Phase 2).** Verified store bundles from `store-specs.json`, alpha-channel removal,
  Vitest dimension tests, zip by platform/device/locale.
- **Fonts & themes (Phase 3).** Google + custom upload UI; theme tokens applied across
  all screens; a template library of reusable layouts. (Minimal font *embedding* ships earlier
  with export — see architecture.md §5.)
- **Locales & RTL (Phase 4).** Per-language screenshot sets; mirrored layout/alignment for
  Arabic/Hebrew so slides are RTL-native, not just translated.
- **AI (Phase 5).** A bonus on top of a deterministic core, never a prerequisite.
- **Advanced editing (Phase 7).** Multi-select and marquee selection first, then a parity-proven
  group model and group authoring. New `image`, `icon`, and `badge` primitives follow as independent
  render-risk slices rather than one broad schema expansion. Completing Phase 7 closes the baseline
  product scope; it is not itself a public release gate.

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

**Phase 4 — Locales & RTL — complete.**
Multi-locale sets, RTL-native layouts. Sliced in §3e.

**Phase 5 — Agent workflows — complete.**
Project-local `AGENTS.md` recipes for copy generation, baked auto-layout, and locale translation via
the CLI agent (subscription, no keys) ship from `screenshots init`. Deterministic local auto-crop and
flat/near-uniform background removal ship through the non-destructive asset CLI. Sliced in §3f.

**Phase 6 — Connected canvas + completion foundations — complete.**
Cross-screen elements with precise export crops, a distributable CLI with its shared render host,
baseline undo/redo, snapping, media insertion, the optional skill installer, and community
polish (README GIF, `CONTRIBUTING.md`, example projects, SPDX headers on source files). Sliced in
§3g.

Distribution decisions closed in this phase:
- **Packaged, not published.** Source contributors still use `pnpm screenshots`; the built
  installable artifact exposes a JavaScript `screenshots` bin outside the checkout. It has not been
  published to a registry, which remains a later release action.
- **Parity-preserving weight.** The export path keeps the full prebuilt `apps/web` Next host (the §2
  decision's accepted cost) instead of adding a second lightweight renderer.

**Phase 7 — Advanced editing + baseline completion — in progress; Slice 1 complete.**
Marquee/modified-click multi-selection, a persisted group model with shared render/export parity,
group authoring and nested transforms, then independently proven `image`, `icon`, and `badge`
primitives. Phase 7 completes the planned baseline product together with Phase 6; it does not imply
that the project is released. Its concrete v3 schema design starts only after the connected-canvas
v2 contract closes. Sliced in §3h.

**Phase 8 — Stabilization + release readiness — planned after baseline completion.**
Sustained dogfood, failure/recovery testing, cross-environment packaged-install checks, performance
and memory profiling, accessibility and browser coverage, long-running export reliability, and
release-candidate documentation. A first public release is considered only after this phase's gate;
Phase 6/7 completion alone is not a release claim. Detailed execution slices are intentionally
deferred until Phase 7 closes and real dogfood evidence exists.

**Phase 9 — Expansion + continuous improvement — direction after stabilization.**
Richer existing-type properties, additional frames/platform targets, workflow refinements,
performance improvements, and further creative capabilities driven by Phase 8 findings and real
use. This is a direction boundary, not a pre-approved catch-all implementation plan; each expansion
still needs a scoped design, parity impact, and verification plan.

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
| **4 — Left panel** ✅ | Screens section (dnd-kit reorder = project order and relative export-group order) + Layers section (z-order, lock, hide, rename). No grouping. | Medium — multi-screen state, reorder as the shared UI/CLI ordering source. |
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
| **3 — Locale CLI** ✅ | `locale list/add/direction/rm` plus direction-aware lower-level screen creation. | Agent workflows rewriting project JSON inconsistently. |
| **4 — Editor locale workspace** ✅ | Active-locale selector/manager, locale-filtered Screens and Overview, locale-scoped reorder, RTL-aware insertion/editing, and template inheritance. | Flat multi-locale UI mutating the wrong global screen indices. |
| **5 — Export hardening + closure** ✅ | Safe locale path segments, per-platform/device/locale numbering, multi-locale export coverage, docs truth, and the Phase 4 gate. | Unsafe/free-form paths and incorrect store-slot ordering across locales. |

The accepted data, RTL-transform, CLI, editor, and export contract lives in
`docs/specs/2026-07-10-phase4-locales-rtl-design.md`.

---

## 3f. Phase 5 execution slices

Phase 5 keeps AI outside the deterministic product core. Agent workflows edit ordinary v1 literals
and delegate structural changes to the shipped CLI; image preprocessing is explicit, local, and
non-destructive rather than a render-time effect.

| Slice | Delivers | Contract kept |
|-------|----------|---------------|
| **1 — Project agent guide scaffold** ✅ | `screenshots init` creates a project-local `AGENTS.md` plus `CLAUDE.md` forwarding file with copy, literal auto-layout, and locale-translation recipes. | No AI provider, schema field, prompt state, or second layout/render path. |
| **2 — Deterministic auto-crop CLI** ✅ | Non-destructive local crop output under `assets/processed/` with safe paths and collision handling. | Source assets and project JSON are unchanged until the caller explicitly uses the result. |
| **3 — Local background removal utility** ✅ | Deterministic edge-connected removal for flat/near-uniform backgrounds behind the asset-processing CLI boundary. | No hosted inference, API key, browser model, network request, or render/export dependency. |
| **4 — Dogfood and closure** ✅ | Generated-guide workflow coverage, asset-processing integration coverage, public docs truth, and the Phase 5 gate. | Agent help remains optional; deterministic CLI/editor/export behavior remains independently usable. |

The accepted workflow and local-processing boundary lives in
`docs/specs/2026-07-10-phase5-agent-workflows-design.md`.

---

## 3g. Phase 6 execution slices

Phase 6 separates the connected-canvas parity risk from distribution and community foundations.
Connected mode is one project-level choice, but every exact `platform/device/locale` export group
forms its own horizontal strip in project order. Elements stay owned by a screen and keep local
coordinates; the shared renderer projects them into strip coordinates and crops the requested
screen. This preserves the ordinary screen/element model while making cross-boundary pixels
deterministic.

| Slice | Delivers | Risk it retires |
|-------|----------|-----------------|
| **1 — Connected document + crop parity** ✅ | Schema v2 with explicit `isolated | connected` mode and a lossless v1→v2 isolated migration; pure group/origin projection; connected rendering and exact per-screen crops through the existing UI/CLI headless path; a JSON-authored two-screen parity fixture. | Proves the highest-risk claim before editor work: cross-screen pixels still use one renderer and exact store crops. |
| **2 — Connected lifecycle + CLI** ✅ | Guarded mode conversion, deterministic group helpers, and connected-safe add/duplicate/reorder/remove, locale clone/direction, template, theme, and CLI workflows. | Prevents ordinary management commands from corrupting ownership, ordering, or locale behavior after the schema widens. |
| **3 — Connected editor stage** ✅ | One gapless editable strip for the active platform/device/locale group; cross-boundary select/move/resize/rotate and inline text editing; composite owner-aware selection; exact Focus crop preview. | Replaces the isolated DOM projection without forking element rendering or losing element ownership. |
| **4 — Undo/redo history** ✅ | Bounded ephemeral history over validated project mutations, keyboard shortcuts, toolbar state, save integration, and explicit history reset at load/replace boundaries. | Adds the day-0 promised recovery path only after connected mutations have their final ownership semantics. |
| **5 — Snapping + smart guides** ✅ | Deterministic single-selection snapping to active group/artboard edges, centres, and nearby elements with zoom-correct ephemeral guides. | Prevents connected-space alignment from becoming a second persisted layout system or renderer concern. |
| **6 — Asset picker + existing media insertion** ✅ | Project-asset browsing plus insertion of the already-enforced `screenshot` and `device-frame` types from Add, with safe project-local paths and shared image loading. | Removes the current disabled media workflow without widening the element union or adding uploads outside project storage. |
| **7 — Connected workspace hardening** ✅ | Mode control, group-scoped Overview/Fit/Screens/Layers behavior, thumbnails, active-screen boundaries, history/snapping/media interaction coverage, and responsive/keyboard QA. | Closes interaction ambiguity around ownership, screen boundaries, z-order, reordering, and narrow viewports. |
| **8 — Standalone CLI distribution** ✅ | Built `screenshots` executable plus the prebuilt web render host required for editor/export parity; package contents and temp-directory install/export smoke coverage. | Removes the current repo-only `tsx` entry point without introducing a lighter second renderer. |
| **9 — Optional skill installer** ✅ | A thin installable skill that bootstraps the packaged CLI and then delegates to the generated project `AGENTS.md`; clean-folder install/init smoke coverage. | Adds zero-config agent discovery without duplicating the product contract or making AI mandatory. |
| **10 — Community polish + phase closure** ✅ | README demo GIF and install path, `CONTRIBUTING.md`, `NOTICE`, 2–3 validated/exportable example projects, scoped SPDX headers, public-doc truth, and the Phase 6 full gate. | Completes the OSS project foundation and catches drift across examples, packaging, docs, and licenses without claiming a public release. |

The target data, render, editor, distribution, and completion contract lives in
`docs/specs/2026-07-10-phase6-connected-canvas-completion-design.md`. The ten completed slice plans
and verification checkpoints are recorded in `docs/plans/`.

Phase 6 deliberately closes undo/redo, snapping, and insertion of existing media types because they
are baseline editor gaps over the final connected mutation/coordinate model. Multi-select,
grouping, and new render element types stay in the explicit Phase 7 boundary below.

---

## 3h. Phase 7 execution slices

Phase 7 is advanced editing after the Phase 6 completion foundation is stable. Selection remains
ephemeral; grouping is the first persisted/render-affecting change and therefore gets its own
schema/migration/parity slice before editor authoring. Each new element type then proves the shared
renderer independently.

| Slice | Delivers | Risk it retires |
|-------|----------|-----------------|
| **1 — Multi-select foundation** ✅ | Owner-aware selection set, Shift/Cmd click, marquee selection, aggregate bounds, and batch move/delete/lock/visibility over isolated and connected canvases. | Establishes one unambiguous selection model without persisting workspace state or prematurely adding groups. |
| **2 — Group model + render parity** | Ratified post-v2 schema/migration for one-level groups with local child coordinates; traversal updates for fonts/assets/themes/locales; shared renderer and exact export parity. | Proves serialization, nested transforms, clipping, z-order, RTL, and connected crops before group UI can write the model. |
| **3 — Group authoring + Layers** | Group/ungroup from multi-selection, group transform/duplicate/delete/lock/hide/rename, child inspection, keyboard behavior, and owner-aware Layers presentation. | Prevents editor-only grouping semantics from diverging from the persisted/rendered group contract. |
| **4 — Decorative image element** | Strict `image` element using the Phase 6 asset picker/loader, deterministic fit/crop behavior, inspector controls, templates/themes traversal, and parity coverage. | Adds the most general missing raster primitive without overloading the semantic `screenshot` type. |
| **5 — Vector icon element** | Deterministic built-in/SVG icon contract, safe project-local authoring, colour/stroke controls, shared Konva mapping, and parity coverage. | Avoids unsafe or browser-dependent SVG behavior and keeps icons editable rather than raster-only. |
| **6 — Badge primitives** | Rating, store, and “as seen on” badge authoring through the smallest validated representation; prefer ordinary grouped primitives/templates unless unique badge semantics justify a union member. | Resolves whether badges need schema state instead of committing to a redundant composite element up front. |
| **7 — Baseline completion dogfood + closure** | Multi-select/group workflows across connected locales, image/icon/badge examples, public docs truth, accessibility/keyboard QA, and the Phase 7 full gate. | Closes cross-feature traversal and parity gaps before declaring the baseline product complete, not publicly released. |

Phase 7 reserves product scope, not a premature v3 shape. Slice 2 must re-read the shipped Phase 6
schema and write its own design spec before implementation. Richer existing-type properties
(gradient/image backgrounds, text shadow, screenshot crop, additional frame variants, and expanded
shape styles) remain roadmap-governed Phase 9 expansion candidates; they are not hidden inside the
new-type slices.

The completed Slice 1 contract and verification checkpoint are recorded in
`docs/plans/2026-07-10-phase7-slice1-multi-select-foundation.md`.

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
4. **Scope creep.** The vision is large. *Mitigation:* Phase 6 and Phase 7 close the baseline in
   fixed order; Phase 8 owns stabilization/release evidence, while Phase 9 expansion still requires
   explicit scoped slices.
