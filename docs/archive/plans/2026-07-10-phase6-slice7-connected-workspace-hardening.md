# Phase 6 Slice 7 — Connected workspace hardening

Status: complete. Exact-group workspace scope/reorder, owner surfaces, connected thumbnail
dependencies, guarded UI mode control, and desktop/compact composition coverage have passed.

## Goal

Close the remaining workspace ambiguity around connected group scope, ownership, thumbnails,
mode control, and compact keyboard behavior before distribution work begins.

## Contract

- One shared scope helper drives connected Overview and Screens: the active exact
  platform/device/locale group. Isolated mode continues to expose its active locale set.
- Screen reorder changes only slots belonging to the visible connected group; unrelated groups keep
  their indices. Final-locale deletion protection still counts the complete locale, not the visible
  group.
- Layers stays owner-screen scoped and labels that owner. Selecting a connected element or screen
  updates the same active boundary, Layers owner, and Inspector target.
- Connected thumbnails rerender when any exact-group screen or group order changes, because a
  neighbour-owned element may change the requested crop. Unrelated groups remain memoized.
- The toolbar exposes the persisted canvas mode. Guarded connected→isolated refusal is visible and
  leaves project/history/save state unchanged; successful mode changes use ordinary history/save.
- Existing history, snapping, and media insertion compose in the connected workspace; desktop and
  compact keyboard/overlay behavior remain usable without horizontal document overflow.

## Verification

1. Focused scope/reorder/mode/thumbnail tests — 3 files / 44 tests passed.
2. `pnpm test:web` — 16 files / 86 tests passed.
3. Connected workspace, connected editor, history, snapping, asset picker, isolated workspace, and
   left-panel E2E — 7 files / 14 tests passed.
4. `pnpm lint` passed.
5. `pnpm typecheck` passed through raw RTK proxy output.
6. `git diff --check` passed.
