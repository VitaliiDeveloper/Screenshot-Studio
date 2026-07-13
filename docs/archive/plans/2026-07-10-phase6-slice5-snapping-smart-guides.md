# Phase 6 Slice 5 — Snapping and smart guides

Status: complete. Pure snapping geometry, zoom-correct connected guides, persistence, and affected
drag/history regressions have passed.

## Goal

Give one dragged element deterministic alignment help in isolated and connected authoring without
persisting guides, changing the schema, or creating export/layout behavior.

## Contract

- Dragging one unlocked selected element snaps its rotation-aware axis-aligned bounds to active
  group, artboard, and visible nearby-element edges/centres.
- Connected calculations run in active strip space but return owner-local coordinates; ownership
  never changes at a boundary.
- The threshold is six screen pixels at every zoom. The closest match wins; exact ties prefer
  element, then artboard, then group targets and remain stable in project/anchor order.
- At most one vertical and one horizontal guide appear. They are non-listening Konva chrome,
  one screen pixel wide, and disappear before the drag is persisted.
- Hidden/fully transparent targets do not participate. Locked elements may act as targets but
  cannot themselves be dragged.
- Snapping does not run during static render/export, mutate project JSON independently, or become a
  responsive constraint system.

## Implementation

- Add a pure editor snapping module over screen projections and rotation-aware element bounds.
- Integrate it into `EditorStage` drag movement, updating transient Konva guide refs rather than
  React state on every pointer event.
- Persist only the final snapped owner-local position through the existing mutation/history/save
  path.
- Add geometry/unit coverage and one exact browser scenario proving zoom threshold, connected guide
  position, final persistence, and guide cleanup.

## Verification

1. Focused snapping geometry — 5 tests passed.
2. `pnpm test:web` — 13 files / 74 tests passed.
3. `editor`, `editor-snapping`, `connected-editor`, and `editor-history` E2E — 4 files / 8 tests
   passed.
4. `pnpm lint` passed.
5. `pnpm typecheck` passed through raw RTK proxy output.
6. `git diff --check` passed.

The guide loop uses Konva refs rather than React state, following the local React performance skill's
transient-value guidance so pointer movement does not trigger component rerenders.
