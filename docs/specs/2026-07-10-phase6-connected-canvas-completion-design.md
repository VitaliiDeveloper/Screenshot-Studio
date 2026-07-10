# Phase 6 — Connected canvas and completion foundations

Status: active. Slices 1–4 are complete and verified; six execution slices remain. The
enforced project contract is v2 with lossless v1→v2 isolated migration.

## Goal

Let one element cross adjacent store screenshots while every screen still exports as an exact,
independently useful crop through the existing shared browser renderer. Then make the same product
usable outside a source checkout and close the Phase 6 baseline foundations without claiming a
public release.

## Baseline at phase start

- The strict v1 project stores elements inside isolated screens and has no canvas mode.
- `renderScreen` draws one screen, while the editor Overview places independent `EditorStage`
  instances beside one another with a visual gap.
- Export is already grouped and numbered by exact `platform/device/locale`, uses one web host and
  browser context, strips alpha, and has parity/dimension coverage.
- Screen, locale, theme, template, font, asset, and export workflows all assume screen-owned
  elements. Keeping that ownership avoids a second document model.
- The `screenshots` bin still points at TypeScript source and the render host lives in `apps/web`,
  so the CLI is not installable as a standalone package.
- Add exposes text/shape only; existing `screenshot` and `device-frame` schema members still require
  hand-authored JSON because project assets have no picker/insertion surface.
- `LICENSE` exists, but the optional skill, `CONTRIBUTING.md`, `NOTICE`, example projects, README
  demo GIF, and source SPDX pass do not.

## Connected document contract

### Version and mode

Slice 1 raises the current schema to v2 and adds a required project-level
`mode: "isolated" | "connected"` field. `parseProject` remains the public load boundary and applies
a pure v1→v2 migration that writes `mode: "isolated"` and updates `meta.schemaVersion`. That
migration is pixel-preserving: no screen, element, id, order, coordinate, or literal changes.

The mode is project-level deliberately. It keeps one authoring model and one migration decision;
each compatible screen group is still projected independently. Per-group modes, a second global
element array, persisted viewport positions, and responsive constraints are not introduced.

### Connected groups and coordinates

A connected group is the project-order sequence of screens with the same exact
`platform`, `device`, and `locale`. The active screen determines the group shown by the editor.
Screens from another platform, device, or locale never contribute pixels to its crop.

Within a connected group:

1. Screens are top-aligned in a gapless horizontal strip.
2. A screen origin is the sum of the widths of all earlier screens in that group; its `y` origin
   is zero. Different widths/heights remain legal.
3. An element stays in its owner screen's `elements` array. Its strip position is
   `ownerOrigin.x + element.x`, `element.y`; negative or beyond-artboard coordinates are legal.
4. Backgrounds for every screen are painted first at their strip rectangles. Visible elements are
   then painted in group screen order and each screen's element-array order. This is the connected
   z-order contract.
5. Selection identifies both owner screen id and element id. Connected mode does not require
   project-global element ids and does not rewrite existing ids.

Screen ownership is stable while dragging across a boundary. Coordinates remain local to that
owner even when the whole element is visible on a neighbour. Reassigning ownership automatically
would also change its global z-band and make ordinary drags destructive, so it is out of scope.

### Render and crop parity

`renderScreen(container, project, screenId, images)` remains the single static rendering entry
point. In isolated mode its output stays unchanged. In connected mode it derives the requested
screen's group and origin, paints group backgrounds/elements with the inverse crop translation, and
returns a stage whose dimensions are exactly the requested screen artboard. The stage boundary is
the crop; no second stitched-image or post-export slicing path is added.

The CLI and UI continue to request one screen id at a time through the same headless `/render`
route. Bundle grouping, numbering, pixel ratio validation, alpha stripping, zip layout, and render
host reuse remain unchanged. Slice 1 proves a cross-boundary element contributes the expected
pixels to two neighbouring outputs while both PNGs keep their exact target dimensions.

### Mode conversion and project operations

Opening v1 content is always safe because migration selects isolated mode. Switching an existing
project to connected mode is explicit: previously clipped overflow may become visible on a
neighbour. Switching back to isolated mode is allowed only when every visible element's transformed
bounds stay inside its owner artboard; otherwise the operation refuses rather than silently dropping
cross-screen pixels. Rotation-aware bounds are used for that guard.

Existing operations keep their ordinary meaning:

- screen order is both connected strip order and relative export slot order;
- add/duplicate creates another owner screen and fresh ids as today;
- remove deletes that screen and its owned elements after the existing final-screen/locale guards;
- reorder moves the screen, so its origin and connected composition intentionally change;
- locale clone copies every owner screen/element with fresh ids;
- baked LTR/RTL conversion mirrors each element about its owner artboard, including overflow, and
  never reflects pixels at render time;
- themes, fonts, templates, assets, and unresolved-font checks continue to traverse screen-owned
  elements and do not need a parallel connected-element path.

The CLI exposes `screenshots canvas mode [isolated|connected]`. Switching back to isolated refuses
while rendered rotation-aware bounds cross an owner artboard; no mode switch runs implicitly during
init, import, template creation, or locale cloning.

## Editor contract

Isolated mode keeps the current Focus/Overview behavior. Connected mode changes the projection, not
the persisted model:

- Overview becomes one gapless, editable Konva strip for the active exact group. Artboard boundary
  strokes and labels are editor chrome, never exported pixels.
- Every visible group element can be selected and transformed. The store persists the change to the
  owner screen after converting the strip-space result back to local coordinates.
- Focus is the exact crop preview for the active screen. It uses the same connected projection and
  clipping semantics as export; cross-boundary authoring happens in Overview.
- Clicking a background selects that screen. Selecting an element keeps an owner-aware composite
  selection so duplicate element ids across screens are unambiguous.
- Inspector edits target the selected element's owner. Layers remains owner-screen scoped and makes
  that ownership visible; screen-level actions stay scoped to the active screen.
- Fit, pan, zoom, keyboard interaction, responsive overlays, text-edit positioning, thumbnails, and
  locked-element guards receive connected-specific regression coverage.

No independent React/Konva element mapper is introduced. Static export and interactive editor keep
consuming `elementToNodeConfig`; connected code only supplies coordinate offsets, crop bounds, and
interaction props.

## Baseline editor fundamentals

Phase 6 closes three existing-editor gaps only after the connected mutation and coordinate model is
stable:

- **Undo/redo** stores a bounded ephemeral history of validated project states or Immer patches.
  Load and external project replacement reset history; selection/viewport state is not persisted;
  undo/redo mutations use the ordinary serialized save path and expose keyboard plus toolbar state.
- **Snapping/smart guides** operates in the active strip/artboard coordinate space for one selected
  element. Guides are ephemeral canvas chrome. Snapping never rewrites schema constraints, runs in
  export, or becomes a responsive layout engine.
- **Asset picker/media insertion** discovers safe project-local assets and creates only existing
  `screenshot` / `device-frame` elements through their current factories/loading path. The slice
  does not add the future decorative `image` union member or an external upload/storage service.

## Distribution contract

The zero-config path must preserve render parity, so the packaged CLI ships the prebuilt web render
host it needs rather than substituting node-canvas or a simplified exporter. Source contributors may
keep `pnpm screenshots` and Next dev mode; an installed package exposes a built JavaScript
`screenshots` bin that can init, manage, open, and export a project from outside the monorepo.

Slice 8 must ratify the exact build/package layout before implementation and prove the packed
artifact from a temporary install directory. The smoke scenario covers `init`, project validation,
and at least one headless export through the packaged host. Package contents must exclude source
fixtures, development-only docs, and caches while including every runtime asset and Next static
file required by editor/render routes.

The optional skill lands only after that package contract is real. It is a thin discovery/bootstrap
layer: install or invoke the CLI, run initialization, and defer to the generated project `AGENTS.md`.
It does not duplicate the schema/recipes, add an AI SDK, or become necessary for normal CLI/editor
use.

## Community foundation contract

The final slice adds a truthful install path and editor GIF to README, contribution and license
notes, `NOTICE`, scoped SPDX headers on authored source files, and 2–3 small example projects with
different visual/locale coverage. Every example parses under the current schema and at least one
screen per example exports in the closure gate. Generated files, vendored assets, JSON fixtures,
lockfiles, and media binaries do not receive text headers. These are product/community foundations;
public release readiness remains a later stabilization phase.

## Execution slices

1. **Connected document + crop parity.** Ship the v2 migration, group/origin projection, shared
   connected renderer, exact screen crops, and the first headless parity/export fixture.
2. **Connected lifecycle + CLI.** Make mode conversion and all screen/locale/resource management
   semantics explicit and regression-tested; expose the canvas-mode CLI surface.
3. **Connected editor stage.** Add the gapless editable strip, owner-aware selection/transforms,
   inline text editing, and exact Focus crop.
4. **Undo/redo history.** Add bounded recoverable project mutation history after connected
   ownership semantics are stable.
5. **Snapping + smart guides.** Add single-selection connected-space alignment with ephemeral
   zoom-correct guides.
6. **Asset picker + existing media insertion.** Enable project-local screenshot/device-frame
   insertion without widening the element union.
7. **Connected workspace hardening.** Close mode control, group-scoped workspace surfaces,
   thumbnails, history/snapping/media interaction coverage, and responsive/keyboard behavior.
8. **Standalone CLI distribution.** Build and pack the CLI with its prebuilt shared render host;
   prove installation and export outside the checkout.
9. **Optional skill installer.** Add the minimal install/bootstrap skill and clean-folder smoke.
10. **Community polish + phase closure.** Add examples, README demo/install, contribution/license
   surfaces and SPDX headers, align public docs, and run the full phase gate.

## Verification policy

- Slice 1 uses focused schema/migration/geometry tests during implementation, then
  `test:core`, `test:cli`, the new connected parity/export E2E files, and the full
  `test + lint + typecheck + test:e2e` gate because it changes the Zod schema and shared renderer.
- Slice 2 uses focused core project-operation and CLI command tests, then the affected core/CLI
  package suites and typechecks. Browser coverage is required only for a user-visible mode or
  lifecycle path added in that slice.
- Slice 3 uses focused store/workspace unit tests plus one dedicated connected-editor E2E file,
  registered in exactly one targeted E2E group.
- Slice 4 uses focused history/store/save tests and exact undo/redo keyboard/toolbar scenarios.
- Slice 5 uses pure snapping geometry tests plus exact drag/zoom guide scenarios; guides are checked
  only in the editor because they never enter project JSON or export.
- Slice 6 uses safe-path/asset-discovery tests and exact screenshot/device-frame insertion scenarios.
- Slice 7 uses the affected web suite and connected workspace/lifecycle E2E scenarios across desktop
  and compact viewports; it does not default to every editor E2E file.
- Slice 8 proves the built artifact with a temporary packed install and a packaged-host export;
  the export E2E group runs because the runtime host boundary changes.
- Slice 9 uses an isolated temporary home/project smoke and verifies delegation to the generated
  guide without networked AI behavior.
- Slice 10 validates/exports examples, runs docs/license consistency checks, and runs one full
  repository closure gate.

## Out of scope

Marquee or multi-select, element grouping, automatic owner reassignment, per-group canvas modes,
persisted viewport state, responsive layout constraints, automatic translation, new
element/background types, semantic image segmentation, hosted AI, publishing credentials, and
release-channel promotion. Multi-select, grouping, and the first new element types are explicitly
reserved for Phase 7 rather than left unscheduled; release evidence and promotion belong after the
Phase 6/7 baseline.
