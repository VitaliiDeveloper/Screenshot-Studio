# Phase 7 Slice 2 — Group model and render parity

Status: complete. The strict v3 model, sequential migration, grouped traversals, shared UI/static
node tree, connected crops, and headed/headless parity have passed. The ratified contract is in
`docs/specs/2026-07-10-phase7-group-model-design.md`.

## Goal

Prove that one-level persisted groups survive every existing document workflow and render through
the shared UI/CLI path with exact connected crops before editor authoring can write them.

## Implementation

1. Add strict schema v3 `LeafElement | GroupElement` types and sequential v1→v2→v3 migration.
2. Add core leaf traversal/mapping/fresh-id helpers and route fonts, assets, themes, templates,
   screen/locale cloning, RTL, and connected overflow through them.
3. Map persisted groups recursively through `elementToNodeConfig`, keeping groups non-clipping and
   preserving child z-order/visibility/opacity.
4. Make the interactive React renderer recurse through the same node tree so JSON-authored groups
   display/select as one top-level layer without adding group authoring UI.
5. Add a connected v3 fixture and exact crop/headed-headless parity coverage; add the new E2E file
   to exactly `test:e2e:parity`.
6. Update enforced-schema documentation and generated project guidance to v3 only after the gate is
   green.

## Verification

- Focused core files: schema/migration, element traversal, project ops, themes, templates, assets,
  node config, connected bounds, and static render tests.
- `pnpm test:core`, `pnpm test:cli`, and `pnpm test:web` because the schema type is shared broadly.
- New group parity E2E plus existing connected-canvas and RTL parity scenarios.
- Existing connected export scenario because groups change exact crop traversal.
- `pnpm lint`, `pnpm typecheck`, `git diff --check`.
- This shared schema/render checkpoint requires the full non-browser unit gate before commit. The
  complete browser gate remains reserved for Phase 7 closure after targeted parity/export proof.

Completion evidence:

1. `pnpm test:core` — 16 files / 150 tests passed.
2. `pnpm test:cli` — 17 files / 82 tests passed.
3. `pnpm test:web` — 17 files / 95 tests passed.
4. Group, connected-crop, RTL, and connected-export E2E — 4 files / 5 tests passed.
5. Full non-browser gate — 50 files / 327 tests passed.
6. `pnpm lint`, `pnpm typecheck`, and `git diff --check` passed.
