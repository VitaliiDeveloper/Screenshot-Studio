# Phase 7 Slice 4 — Decorative image element

Status: complete. Contract ratified in
`docs/specs/2026-07-10-phase7-decorative-image-design.md`.

## Goal

Ship one strict decorative raster leaf through schema, migration, traversal, shared rendering,
asset authoring, inspector, templates/groups, and exact UI/CLI parity.

## Implementation

1. Add schema v4 `ImageElement` and guarded sequential v3→v4 migration.
2. Add factory, image-cache collection, shared node mapping, group-resize, and traversal tests.
3. Enable Add → Image through the existing project asset picker and deterministic insertion path.
4. Add image inspector fields and Layers icon while preserving ordinary group/history/save behavior.
5. Add a connected v4 parity fixture generated in the E2E temp project and prove contain/cover,
   alpha composition, grouping, exact crops, and headed/headless parity.
6. Update current-schema/generated-guide/editor/architecture/roadmap truth after the gate is green.

## Verification

- Focused schema/migration/factory/assets/node-config/group/template/theme/store tests.
- `pnpm test:core`, `pnpm test:cli`, and `pnpm test:web` because current schema types are shared.
- New image parity/authoring E2E plus existing group and connected parity affected scenarios.
- `pnpm lint`, workspace package typecheck, and `git diff --check`.

Completion evidence:

1. `pnpm test:core` — 17 files / 170 tests passed.
2. `pnpm test:cli` — 17 files / 82 tests passed.
3. `pnpm test:web` — 17 files / 101 tests passed.
4. Image/asset/screenshot/group/connected parity E2E — 5 files / 6 tests passed.
5. Workspace package typecheck (`pnpm -r run typecheck`), `pnpm lint`, and
   `git diff --check` passed.
