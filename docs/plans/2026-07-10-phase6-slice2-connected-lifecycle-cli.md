# Phase 6 Slice 2 — Connected lifecycle and CLI

Status: complete. Connected mode transitions, lifecycle regressions, the CLI surface, and affected
core/CLI verification have passed.

## Goal

Make connected mode an explicit, non-lossy project workflow and prove that existing screen, locale,
theme, and template operations preserve the v2 ownership/order contract.

## Contract

- `screenshots canvas mode` prints the current project-wide mode.
- `screenshots canvas mode isolated|connected` is the only new structural CLI mutation.
- Repeating the current mode is an idempotent no-op.
- Isolated→connected is explicit and preserves every literal; previously clipped overflow may become
  visible by design.
- Connected→isolated refuses when any rendered element's rotation-aware logical bounds cross its
  owner artboard. Invisible and fully transparent elements cannot contribute pixels and do not block.
- Screen add/duplicate/reorder/remove, locale clone/direction/remove, template creation, theme
  application, fonts/assets traversal, and manifests continue to operate on screen-owned elements
  and preserve `Project.mode`.
- Mode changes never reassign element ownership, normalize coordinates, reorder screens/elements, or
  add a second render/layout path.

## Implementation

- Extend the framework-agnostic connected-canvas model helper with rotation-aware logical bounds,
  overflow discovery, and guarded `setCanvasMode`.
- Add `packages/cli/src/canvas-commands.ts` and route it through the main CLI without duplicating
  project IO or validation.
- Exercise connected projects through existing core/CLI lifecycle suites and add exact command,
  idempotency, rotation, non-rendering overflow, and no-write-on-refusal tests.
- Update the root/generated guides, architecture, roadmap, and README with only the shipped command
  and guard semantics.

## Verification

1. Focused connected model/lifecycle and canvas-command tests.
2. `pnpm test:core`
3. `pnpm test:cli`
4. `pnpm lint`
5. `pnpm typecheck`
6. `git diff --check`

No browser gate is required: this slice adds pure model/CLI lifecycle behavior and does not change
rendered pixels or editor interaction. Slice 1 already closure-verified the unchanged connected
renderer/export boundary.
