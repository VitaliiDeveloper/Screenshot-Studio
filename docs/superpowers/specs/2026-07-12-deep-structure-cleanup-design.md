# Deep Structure Cleanup Design

## Status

Approved direction for the second cleanup pass. This work is stacked on
`codex/moderate-project-cleanup` and is delivered through a separate pull request so the already
reviewed moderate cleanup remains unchanged.

## Goal

Give the six remaining large production modules explicit, testable ownership boundaries without
changing editor behavior, schema v10, persisted JSON, CLI syntax, render/export output, or public
package surfaces.

The cleanup covers:

1. editor store state and mutations;
2. canvas viewport lifecycle and navigation;
3. editor-stage authoring interactions;
4. shared editor UI primitives;
5. core project operations;
6. CLI entrypoint and command orchestration.

## Non-goals

- No new feature, UI control, schema field, command, or output format.
- No second renderer and no split of `elementToNodeConfig` by element type.
- No change to connected ownership, selection semantics, history grouping, save timing, keyboard
  shortcuts, zoom behavior, snapping, or inline text behavior.
- No conversion of serializable literals to TypeScript `enum`.
- No file-count or line-count quota. A module moves only when it gains one understandable reason to
  change and an independently testable interface.
- No renaming of fixtures, repository identity, phase-labelled evidence, or other candidates from
  the deferred 7–12 list.
- No addition to PR #5. This branch remains a separate stacked change.

## Architecture

### 1. Editor store

`apps/web/lib/editor-store.ts` remains the public Zustand store entrypoint and the only place that
binds actions to `set`. It should become composition/wiring rather than the owner of every mutation.

Extract pure boundaries:

- `editor-history.ts` owns history limits, grouping, undo/redo transitions, and selection
  reconciliation after a project transition.
- `editor-screen-mutations.ts` owns pure screen, element-order, background, artboard, and resource
  replacement transitions.
- `editor-project-actions.ts` owns pure locale, output-family, and store-target transitions that
  delegate to core project operations.

Selection traversal and typed element patching stay in their existing focused modules. The exported
`EditorState`, `PatchElementRequest`, and `editorStore` interfaces remain source-compatible. Pure
transition helpers return project/state fragments; they do not import the Zustand store or durable
save wrapper.

### 2. Canvas viewport

`CanvasViewport` remains the component that composes workspace chrome, canvas surface, and
`EditorStage`. Extract hooks by lifecycle:

- `useCanvasViewportMetrics` owns container measurement, fit calculation, and stage placement.
- `useCanvasPanZoom` owns pointer-centred wheel/pinch zoom, Space/Hand panning, and transient pan
  state.
- `CanvasSurface` owns presentation-only pattern/background/empty/loading overlays.

Hooks consume explicit inputs and return state/event handlers. They must not read the global editor
store directly. Pointer coordinate conversion has one pure helper shared by wheel and pan paths.

### 3. Editor stage interactions

The Konva `<Stage>/<Layer>` composition, background mapping, element mapping, guides, and Transformer
remain in `EditorStage` so render-parity review stays local.

Extract interaction controllers:

- `useElementTransform` owns drag start/move/end, multi-selection movement, snapping integration,
  and transform persistence.
- `useMarqueeSelection` owns marquee lifecycle and owner-aware hit resolution.
- `useInlineTextEditing` owns textarea lifecycle, placement, commit/cancel, and focus cleanup.

Each hook receives explicit project/stage/store callbacks. It may keep refs for high-frequency
transient state, but cannot create a parallel persisted state model or mutate project objects.
Interaction boundaries return handlers consumed by the unchanged stage node tree.

### 4. Editor UI primitives

Split `editor-ui.tsx` by consumer-facing responsibility:

- `editor-ui/styles.ts` — `cx` and stable shared class tokens;
- `editor-ui/AddMenu.tsx` — add-menu types and component;
- `editor-ui/MenuSelect.tsx` — select-menu types and component;
- `editor-ui/DialogShell.tsx` — dialog focus, Escape, backdrop, and layout contract;
- `editor-ui/EmptyResourceState.tsx` — empty resource presentation.

The existing `editor-ui.tsx` becomes a compatibility barrel that re-exports the same names. Consumers
may migrate to direct imports only when doing so clarifies ownership; no mass import churn is
required.

### 5. Core project operations

Keep `packages/core/src/model/project-ops.ts` as the public compatibility barrel. Move implementations
into domain modules:

- `project-font-ops.ts` — unresolved-font discovery/assertion;
- `project-screen-ops.ts` — ids, placement parsing, create/add/remove/reorder/clone;
- `project-artboard-ops.ts` — element fitting and artboard resize;
- `project-output-ops.ts` — output-family and target-variant lifecycle;
- `project-locale-ops.ts` — locale clone/remove/direction transitions;
- `project-manifest.ts` — derived manifest recomputation shared by the domains.

There must be no circular imports. Domain modules may depend on schema/types and the manifest helper;
the barrel depends on domains, never the reverse. Every existing export, error string, and return
shape remains available through `@screenshot-studio/core/model`.

### 6. CLI entrypoint

`packages/cli/src/index.ts` remains the executable entrypoint and top-level command dispatcher. Move
orchestration into:

- `cli-runtime.ts` — server/session cleanup, failure races, and aggregate cleanup errors;
- `export-command.ts` — single/bundle export option resolution and execution;
- `dev-command.ts` — dev/import option resolution and execution;
- `command-dispatch.ts` — command-to-handler table and command-specific argument routing.

`index.ts` should own only package-path defaults, argument parsing, dispatch invocation, terminal
error reporting, and process exit status. Existing helper exports used by tests or consumers remain
re-exported. Command-specific modules call the already separated command/service modules; they do not
duplicate parsing or business logic.

## Data flow and errors

- UI event → focused hook/controller → typed store action → pure transition → one history/save path.
- CLI argv → command-aware flag parser → dispatcher → command orchestrator → existing core/service
  boundary.
- Core project operation → domain module → manifest recomputation → unchanged strict project value.

Existing thrown messages, validation paths, CLI stderr text, and cleanup aggregation semantics are
characterized before movement and remain unchanged. New internal helpers do not swallow errors or
translate them unless the current entrypoint already does so.

## Testing

- Characterization-first red/green extraction for every moved boundary.
- Editor store: complete `editor-store.test.ts` plus focused pure-transition tests and web typecheck.
- Canvas viewport: pure coordinate/fit tests plus exact existing editor interaction E2E only where
  wheel/pan/viewport event ownership moves.
- Editor stage: focused hook/model tests plus the smallest exact browser files covering transformed
  behavior (`editor.test.ts`, `editor-multi-select.test.ts`, or `connected-editor.test.ts` as
  justified by the changed handler).
- UI primitives: focused dialog/menu behavior tests when logic moves; presentation-only moves need
  typecheck/lint, not broad E2E.
- Core: `project-ops.test.ts`, new domain-local tests as needed, `test:core`, and core typecheck.
- CLI: `index.test.ts` plus affected export/server/command tests, `test:cli`, and CLI typecheck.
- Final branch gate: core/CLI/web unit suites, workspace typecheck, lint, community, SPDX, Markdown
  links, `git diff --check`, task reviews, and an exact-base whole-branch review.
- Do not run full local `pnpm test:e2e`.

## Delivery order

1. Store pure transitions and history.
2. Canvas viewport lifecycle.
3. Editor-stage interactions.
4. UI primitive families.
5. Core project-operation domains.
6. CLI orchestration.
7. Integrated verification and review.

Independent core/CLI work may run in parallel with web work only through scoped agents in this
isolated worktree. Commits remain separated by concern. The resulting draft PR targets
`codex/moderate-project-cleanup` until PR #5 is merged; it is then retargeted to `dev`.
