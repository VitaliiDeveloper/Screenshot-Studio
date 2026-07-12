# Phase 7 Slice 6 — Badge primitives

Status: complete. Representation decision ratified in
`docs/archive/specs/2026-07-11-phase7-badge-primitives-design.md`.

## Goal

Ship useful rating, “as seen on”, and official store badge authoring through existing v5 group/image
primitives, without a redundant render-state union member.

## Implementation

1. Add strict core factories that return fresh-id ordinary group compositions for rating and
   “as seen on” badges using a registered font identity.
2. Add the three Library catalog actions and a no-font guard for text-bearing badges.
3. Reuse the secure asset picker in Store badge mode to insert a named contain-fit image.
4. Prove child editing, group lifecycle, history/save/reload, and renderer parity through existing
   contracts.
5. Keep `SCHEMA_VERSION = 5`, add explicit badge-union refusal, and update public/docs truth.

## Verification

- Focused badge factory, schema refusal, RTL/traversal, workspace/store tests.
- `pnpm test:core` and `pnpm test:web`; CLI tests remain required at the slice checkpoint because
  generated guidance and shared project validation are public surfaces.
- Badge authoring/parity E2E plus affected group/image parity.
- `pnpm lint`, workspace package typecheck, and `git diff --check`.

Completion evidence:

1. `pnpm test:core` — 19 files / 186 tests passed.
2. `pnpm test:cli` — 17 files / 82 tests passed.
3. `pnpm test:web` — 17 files / 102 tests passed.
4. Badge authoring/parity plus affected group/image parity E2E — 4 files / 4 tests passed.
5. Workspace package typecheck (`pnpm -r run typecheck`), `pnpm lint`, and
   `git diff --check` passed.
