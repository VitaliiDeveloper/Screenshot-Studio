# Phase 7 Slice 7 — Baseline completion dogfood + closure

Status: complete.

## Goal

Close the Phase 7 baseline with living v5 examples, connected-locale group workflow dogfood,
keyboard/accessibility evidence, truthful public documentation, and the repository-wide phase gate.
This completes the planned baseline; it does not claim public-release readiness.

## Implementation

1. Upgrade the living examples to schema v5 and make image, icon, badge, group, connected-crop,
   and RTL locale behavior directly inspectable and exportable.
2. Add a closure E2E that edits a copied connected multi-locale example entirely through named
   controls and documented keyboard shortcuts, then verifies persisted owner-local group state.
3. Keep each new E2E in exactly one targeted group and retain the existing exact, alpha-free
   example export checks.
4. Reconcile `AGENTS.md`, `README.md`, `docs/roadmap.md`, `docs/editor.md`, architecture, and the
   example guide with the shipped v5 contract and Phase 8 as the next stabilization phase.
5. Run the full phase-closure gate once: root tests, lint, package typecheck, and all E2E tests.

## Verification

- Living-example validation and exact export.
- Connected locale selection, multi-select, group, duplicate, ungroup, undo/redo, save/reload,
  keyboard shortcuts, and accessible control-name assertions.
- `pnpm test`, `pnpm lint`, `pnpm -r run typecheck`, `pnpm test:e2e`, and `git diff --check`.

Completion evidence:

1. `pnpm test` — 53 files / 370 tests passed.
2. `pnpm lint` passed.
3. Workspace package typecheck (`pnpm -r run typecheck`) passed for core, CLI, and web.
4. `pnpm test:e2e` — 33 files / 54 tests passed, including living-example validation/export,
   connected LTR/RTL keyboard dogfood, all shared-renderer parity paths, package installation, and
   optional-skill bootstrap.
5. `git diff --check` passed.
6. `pnpm check:community` verified eight required public surfaces/status assertions, and
   `pnpm check:spdx` verified 187 authored source files.
