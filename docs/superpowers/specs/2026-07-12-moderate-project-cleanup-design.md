# Moderate Project Cleanup Design

## Status

Approved direction for the first cleanup pass. This pass improves current maintainability without
redesigning the editor, changing project schema v10, or creating a second render path.

## Goals

- Make invalid editor element patches fail at compile time instead of becoming silent no-ops.
- Remove duplicated selection traversal and store-ready PNG post-processing.
- Split filesystem publication and packaged-render-host preparation from orchestration modules.
- Reduce the responsibilities of the largest editor components through focused helpers, hooks, and
  type-specific inspector sections.
- Turn current documentation into an accurate v10/as-built contract.
- Move completed implementation history behind an indexed archive boundary without deleting useful
  decision records.
- Remove only code proven unused and replace phase-only production wording with durable intent.

## Non-goals

- No schema, persistence, rendering, export-output, or editor-interaction behavior changes.
- No second Konva renderer and no element-by-element renderer split.
- No wholesale rewrite of `EditorStage`, `Inspector`, the editor store, or CLI parsing.
- No conversion of serializable literal unions to TypeScript `enum` merely for style.
- No deletion of fixtures, examples, tests, scripts, closure evidence, or ratified architectural
  contracts that still have active references.
- No full local E2E run; browser coverage remains targeted by behavioral risk.

## Design

### Typed editor mutations

Replace the all-fields `ElementPatch` intersection with an element-type-aware patch API. Common
transform/layer fields remain shared, while text, shape, media, icon, and device-frame fields are
accepted only for their matching element type. `applyElementPatch` remains exhaustive and the store
continues to be the sole project writer.

Create one owner-aware selected-element traversal/index boundary for move, delete, lock, and
visibility actions. Each action keeps its own policy, but no longer reconstructs encoded composite
keys or independently walks the element tree.

### Export and CLI boundaries

Create one store-ready PNG helper for pixel-ratio calculation, render delegation, alpha stripping,
and dimension assertion. Single and bundle export supply their respective render callbacks to this
helper.

Move atomic bundle publication into a dedicated module responsible for safe output paths, symlink
checks, staging, backup, publication, rollback, and recovery retention. `export.ts` remains the
render/export orchestrator.

Introduce a small command-aware flag parser that knows allowed option names and whether each option
requires a value. Existing command resolution functions remain responsible for semantic option
combinations. Platform and device filters are validated through core/store-spec domain values rather
than unchecked casts.

Split packaged render-host discovery/materialization from server process lifecycle while preserving
the existing `startWebServer` public facade.

### Editor component boundaries

Keep the parity-facing Konva node tree in `EditorStage`. Extract only pure stage-model derivation and
focused interaction hooks where the behavior can retain its existing tests. Do not move rendering
into a parallel component tree.

Split `Inspector` into owner-aware selection derivation, shared media fields, type-specific element
sections, and artboard/background sections. The existing `Inspector` remains the composition entry
point.

Extract editor bootstrap/resource loading and keyboard command routing from `EditorPage`. Consolidate
overlay state only where the current UI permits exactly one overlay; do not change simultaneous-panel
behavior as part of cleanup.

### Schema validation and dead code

Keep one strict exported Zod `Project` schema, but move its cross-field refinement into named internal
validators for manifests, variants, locale direction, element IDs, and font identities. Validation
messages and paths remain unchanged.

Remove `isScreenPlacement` only after a final repository and public-export reference check confirms it
has no consumer. Replace phase/slice comments and application metadata with descriptions of durable
runtime responsibilities.

### Documentation lifecycle

Correct `architecture.md`, `editor.md`, and `releasing.md` against enforced v10 and Phase 8/9 closure.
Reduce `roadmap.md` to current status, enduring sequencing/decision boundaries, and links to evidence.

Move completed task-by-task plans and superseded implementation-oriented specs to `docs/archive/`
with an index explaining retention and status. Retain closure/release evidence and any spec still cited
as a non-obvious current contract. Update every affected local link and rerun the Markdown link check.

## Verification

- Follow red-green-refactor for behavior/type-boundary changes.
- Run exact Vitest files for editor store, schema, CLI parsing/export/server, and any extracted helper.
- Run package typechecks for `core`, `cli`, and `web` after their respective changes.
- Run `git diff --check` and the repository documentation/community checks.
- Use only an exact browser test when an extracted UI boundary changes observable interaction; do not
  run the full local E2E suite.

## Delivery

Keep the work on `codex/moderate-project-cleanup` with logical commits separated by concern. The final
handoff must include a second, non-implemented list of naming and deeper-refactor candidates discovered
during the pass so the next cleanup decision is evidence-based.
