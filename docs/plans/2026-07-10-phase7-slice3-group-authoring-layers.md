# Phase 7 Slice 3 — Group authoring and Layers

Status: complete. The editor can create, inspect, transform, duplicate, manage, and dissolve the
strict one-level v3 groups ratified in Slice 2 without introducing a second rendering contract.

## Goal

Expose the persisted group contract through owner-aware editor actions and Layers while preserving
local child geometry, top-level z-order, bounded history, durable save, and shared UI/CLI rendering.

## Contract

1. Grouping accepts at least two top-level leaf elements from one owner screen. Cross-owner,
   child, existing-group, and nested selections are rejected without a project/history mutation.
2. The new group uses the selected leaves' rotation-aware aggregate AABB, stores children in
   group-local coordinates, and occupies the frontmost selected z-order slot.
3. Groups move, rotate, rename, lock, hide, delete, and duplicate as one top-level element.
   Resize is uniform and bakes scale into child geometry and type-specific dimensional fields.
4. Ungroup composes group translation, rotation, opacity, lock, and visibility into its children,
   replacing the group at its exact top-level slot. It does not create nested transforms.
5. Duplication gives the group and every child fresh IDs, offsets the copy by 20 logical pixels,
   and selects the copy. IDs are unique across each complete screen element tree.
6. Layers remains active-owner scoped, presents group children as one indented level, and allows
   child selection/inspection plus child lock, visibility, and deletion. Child canvas transforms
   remain group-owned; the canvas selects the top-level group.
7. `Ctrl`/`Cmd`+`G`, `Shift`+`Ctrl`/`Cmd`+`G`, and `Ctrl`/`Cmd`+`D` invoke group, ungroup, and
   duplicate through the normal history/save path.

## Verification

- Core group-operation and strict-schema tests cover AABB grouping, z-order, transform baking,
  uniform resize, fresh IDs, nested-group refusal, and screen-tree ID uniqueness.
- Editor store tests cover owner guards, nested child editing/removal, undo, uniform resize,
  group duplication, and ungroup selection.
- `e2e/group-authoring.test.ts` covers Layers grouping, nested inspection/editing, uniform resize,
  rename/lock, duplication, keyboard ungroup, undo/redo, persistence, and reload.
- Existing group parity remains green with the authored-group inspector surface.
- Slice gate: `pnpm test:core`, `pnpm test:web`, focused group parity/authoring E2E,
  `pnpm lint`, `pnpm typecheck`, and `git diff --check`.

Completion evidence:

1. `pnpm test:core` — 17 files / 156 tests passed.
2. `pnpm test:web` — 17 files / 100 tests passed.
3. Focused group/schema/theme/store/selection tests — 5 files / 112 tests passed.
4. Group authoring, group parity, and multi-select E2E — 3 files / 3 tests passed.
5. Workspace package typecheck (`pnpm -r run typecheck`), `pnpm lint`, and
   `git diff --check` passed.
