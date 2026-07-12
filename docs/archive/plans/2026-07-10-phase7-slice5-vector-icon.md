# Phase 7 Slice 5 — Vector icon element

Status: complete. Contract ratified in
`docs/archive/specs/2026-07-10-phase7-vector-icon-design.md`.

## Goal

Ship a safe, deterministic, editable vector icon leaf without allowing project JSON or the browser
to interpret arbitrary SVG markup.

## Implementation

1. Add schema v5 `IconElement` plus guarded recursive v4→v5 migration.
2. Add the trusted `24×24` core path registry and shared Konva Path node mapping.
3. Add factory, Add-shelf insertion, Inspector icon/colour/stroke controls, and Layers icon.
4. Route grouped resize and generic templates/themes/cloning/RTL through the existing leaf helpers.
5. Add exact headed/headless/static/UI parity plus Add/Inspector/reload authoring coverage.
6. Update current-schema/generated-guide/editor/architecture/roadmap truth after the gate is green.

## Verification

- Focused schema/migration/registry/factory/node-config/group/template/theme/store/workspace tests.
- `pnpm test:core`, `pnpm test:cli`, and `pnpm test:web` for the shared schema bump.
- New icon parity/authoring E2E plus affected group/connected parity.
- `pnpm lint`, workspace package typecheck, and `git diff --check`.

Completion evidence:

1. `pnpm test:core` — 18 files / 182 tests passed.
2. `pnpm test:cli` — 17 files / 82 tests passed.
3. `pnpm test:web` — 17 files / 102 tests passed.
4. Icon parity/authoring plus affected image/group/connected parity E2E — 5 files / 5 tests passed.
5. Workspace package typecheck (`pnpm -r run typecheck`), `pnpm lint`, and
   `git diff --check` passed.
