# Phase 7 Slice 1 — Multi-select foundation

Status: complete. Owner-aware modified-click/marquee selection, aggregate translation, atomic batch
actions, single-item compatibility, and affected browser regressions have passed without changing
schema v2, rendering, export, or project JSON.

## Goal

Establish one owner-aware multi-selection model for isolated and connected editing before persisted
groups widen the document contract.

## Contract

- A selected item is identified by the composite `{ screenId, elementId }` pair. Selection is a
  duplicate-free ordered set plus one primary item (the most recently selected item) used for
  single-item Inspector behavior and keyboard focus.
- Selection remains ephemeral. It is excluded from project JSON, undo/redo snapshots, save payloads,
  static rendering, and export.
- Plain click replaces the selection. Shift-click or the platform primary modifier toggles one item
  without losing the others. Clicking an empty editable area clears selection; a modified marquee
  adds/toggles against the starting selection.
- A marquee begins only from an empty editable canvas area after a small pointer-movement threshold,
  is rendered as non-listening workspace chrome, and selects visible elements whose rotation-aware
  stage-space bounds intersect the marquee. In connected Overview, element bounds include the owner
  screen origin; duplicate element ids on different owners remain unambiguous.
- Selection is limited to the currently editable workspace: the active screen in isolated mode or
  the active exact platform/device/locale group in connected Overview. Screen, locale, mode, load,
  and project-replacement transitions reconcile or clear items that leave that scope.
- One Transformer may show aggregate bounds for selected visible items. Slice 1 supports batch
  translation only: resize and rotate remain single-item operations until Slice 2 ratifies persisted
  group transforms. A multi-drag applies one stage-space delta to every unlocked selected element,
  converts it back to each unchanged owner-local coordinate, and records one history/save mutation.
- Batch delete, lock, and visibility changes are atomic project mutations and therefore one undo
  step each. Locked elements remain selectable and can be unlocked; locked elements do not move.
  Hidden elements cannot be acquired from the canvas but remain addressable from Layers.
- Deleting a mixed selection removes every selected item, matching the existing element-delete
  semantics. Hiding selected items clears them after the mutation; locking keeps them selected.
- Multi-selection exposes only common batch actions and aggregate geometry. Type-specific Inspector
  controls remain available only when exactly one primary item is selected.
- Text double-click editing first reduces selection to that text item. Snapping remains a
  single-element feature in this slice; a multi-drag preserves the group's relative geometry and
  does not show misleading single-element snap guides.
- Cmd/Ctrl+A, keyboard nudging, multi-resize/rotate, cross-workspace selection, persisted selection,
  and grouping are explicitly out of scope.

## Implementation

1. Add a small selection identity/helper module for stable composite keys, ordered toggle/replace,
   primary-item derivation, scope reconciliation, and aggregate rotation-aware stage bounds.
2. Replace the store's scalar selected ids with the owner-aware selection model. Add atomic
   `moveSelected`, `removeSelected`, `setSelectedLocked`, and `setSelectedVisible` actions while
   preserving one-item call-site convenience during migration.
3. Update history reconciliation so undo/redo retains only still-existing, in-scope identities and
   never records selection itself. Ensure every batch mutation produces one history entry and one
   durable save request.
4. Update `EditorStage` click/tap behavior, attach the Transformer to the selected node set, add the
   marquee overlay, and implement owner-local batch translation without single-item snapping.
5. Update Inspector, Layers, toolbar/keyboard deletion, font application, and other selection
   consumers so single-item behavior is unchanged and multi-item state has explicit batch controls.
6. Add focused unit/component coverage and one isolated plus one connected browser scenario. Add the
   new E2E file to exactly the root `test:e2e:editor` group if a new file is introduced.

## Verification

During implementation:

1. `pnpm exec vitest run apps/web/lib/editor-selection.test.ts apps/web/lib/editor-store.test.ts`
   — composite identity, deterministic ordering, scope reconciliation, aggregate bounds, atomic
   batch mutation, locked-item movement, and undo/redo behavior.
2. Run the exact affected component tests for `EditorStage`, `Inspector`, and `LayersSection` if
   those seams are extracted or already covered; do not substitute a missing test path for success.
3. `pnpm exec vitest run --config vitest.e2e.config.ts e2e/editor-multi-select.test.ts`
   — modified click, marquee, aggregate translation, delete/lock/visibility, reload persistence, and
   history in isolated and connected Overview, including duplicate ids across owners.

At slice completion:

4. `pnpm test:web` because the selection-store contract is shared by the complete editor surface.
5. Re-run `e2e/editor-multi-select.test.ts` plus only directly affected existing editor E2E files
   (expected: `editor.test.ts`, `connected-editor.test.ts`, `editor-history.test.ts`, and
   `connected-workspace.test.ts`).
6. `pnpm lint`, `pnpm typecheck`, and `git diff --check`.

No core, CLI, export, or parity suite is required for Slice 1 because schema and renderer contracts
do not change. Any implementation that needs a schema or static-renderer edit has crossed into
Slice 2 and must stop for the v3 design decision.

Completion evidence:

1. Focused selection/store tests — 2 files / 45 tests passed.
2. `pnpm test:web` — 17 files / 95 tests passed.
3. Multi-select plus affected editor/connected/history/workspace E2E — 5 files / 10 tests passed.
4. `pnpm lint`, `pnpm typecheck`, and `git diff --check` passed.

## Slice handoff

- Base from the completed Phase 6 checkpoint and confirm a clean worktree before implementation.
- Start with `apps/web/lib/editor-store.ts`, `apps/web/components/EditorStage.tsx`,
  `apps/web/components/Inspector.tsx`, `apps/web/components/LayersSection.tsx`, and the existing
  editor/history/connected E2E tests.
- Preserve owner-local coordinates, exact connected workspace scope, bounded history, and the one
  durable save path.
- Do not edit `packages/core/src/model/schema.ts`, schema version/migrations, the static renderer,
  or export code in this slice.
