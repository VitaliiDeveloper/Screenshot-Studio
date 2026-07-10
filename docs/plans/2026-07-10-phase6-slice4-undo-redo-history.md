# Phase 6 Slice 4 — Undo/redo history

Status: complete. Bounded project history, toolbar/keyboard controls, durable save integration, and
connected owner-local regression coverage have passed.

## Goal

Add the promised recovery path after connected mutation ownership is stable, without persisting
editor-only state or creating a second save mechanism.

## Contract

- History is ephemeral and bounded to the 50 most recent project states.
- Consecutive patches to the same owner element, background, or artboard form one undo step until
  selection/blur or another mutation ends that group. Structural mutations are discrete steps.
- Selection, active viewport, dialogs, save status, and other workspace state are never recorded.
- A new mutation after undo clears redo. Loading or externally replacing the project resets both
  stacks, so history never crosses a durable-resource boundary.
- Undo/redo retain active/selected ids only while those targets still exist and otherwise clear
  them safely.
- Toolbar buttons and Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z, and Ctrl+Y use the ordinary durable save path.
- Connected transforms restore the owner-local project state; ownership and crop semantics do not
  change.

## Implementation

- Extend `editor-store.ts` with bounded past/future stacks, coalescing keys, explicit group ending,
  selection reconciliation, and undo/redo actions.
- Route every project mutation through one history recorder while keeping load/replace reset
  semantics explicit.
- End inspector edit groups on blur, add disabled-aware toolbar controls, and wire global shortcuts
  outside interactive fields and modal dialogs.
- Preserve reference identity for no-op locale direction changes so they do not create history.
- Add store history tests and one connected-canvas browser scenario that proves toolbar, keyboard,
  persistence, owner-local coordinates, and reload reset behavior.

## Verification

1. `pnpm test:web` — 12 files / 69 tests passed.
2. Focused core/store tests — 3 files / 65 tests passed.
3. `editor-history`, `editor`, `inspector-toolbar`, and `connected-editor` E2E — 4 files / 10 tests
   passed.
4. `pnpm lint` passed.
5. `pnpm typecheck` passed through raw RTK proxy output.
6. `git diff --check` passed.

No full browser gate is required at this checkpoint: the exact affected editor/history scenarios
run here, while Phase 6 Slice 1 already closure-verified render/export parity.
