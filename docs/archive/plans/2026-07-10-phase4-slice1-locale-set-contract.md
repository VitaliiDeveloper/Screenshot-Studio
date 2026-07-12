# Phase 4 Slice 1 — Locale-set Contract Implementation Plan

**Goal:** Make locale sets a validated core concept and add pure whole-set clone/remove operations
without changing render output or introducing RTL fields yet.

**Architecture:** Keep `Project.locales` as a derived string manifest over `Screen.locale`. Locale
creation clones ordinary screens with fresh ids and shared asset references, appends them in source
order, and revalidates once through `recomputeManifests`.

## File structure

Modify:

- `packages/core/src/model/schema.ts` — validate locale-manifest uniqueness and set equality.
- `packages/core/src/model/schema.test.ts` — cover duplicate, missing, and unused locale entries.
- `packages/core/src/model/project-ops.ts` — add locale clone/remove helpers.
- `packages/core/src/model/project-ops.test.ts` — cover ordering, ids, assets, manifests, and guards.
- `docs/architecture.md` — define locale sets as ordinary screens plus a derived manifest.
- `docs/roadmap.md` — mark Slice 1 complete only after its checks pass.

## Task 1: Locale manifest invariant

- [ ] Add failing schema tests for duplicate locale declarations, a screen locale missing from the
  manifest, and a declared locale with no screen.
- [ ] Run `rtk pnpm exec vitest run packages/core/src/model/schema.test.ts` and confirm the new
  assertions fail for the intended reason.
- [ ] Extend `Project.superRefine` so `locales` is duplicate-free and set-equal to
  `screens[].locale`, mirroring the existing platform validation without constraining string format.
- [ ] Re-run the focused schema test.

## Task 2: Pure locale-set operations

- [ ] Add failing project-op tests for:
  - cloning every source-locale screen in relative order;
  - fresh screen and element ids;
  - target locale appended once to the manifest;
  - shared asset paths and otherwise unchanged literals;
  - rejection of empty targets, unknown sources, and existing targets;
  - removal of all screens in one locale, unknown-locale rejection, and last-locale protection.
- [ ] Run `rtk pnpm exec vitest run packages/core/src/model/project-ops.test.ts` and confirm the new
  assertions fail.
- [ ] Implement `cloneLocaleSet` and `removeLocaleSet` in `project-ops.ts`. Reuse
  `cloneScreenWithFreshIds`; do not add pairing metadata, copy files, or call filesystem APIs.
- [ ] Recompute manifests once per operation and parse the final project through the existing core
  boundary.
- [ ] Re-run the schema and project-op tests.

## Task 3: Contract documentation

- [ ] Amend the project-model section of `docs/architecture.md` so `locales` is explicitly a
  duplicate-free derived manifest and locale sets are ordinary screens grouped by exact locale.
- [ ] Mark Phase 4 Slice 1 complete in `docs/roadmap.md` only after verification succeeds.
- [ ] Run `rtk git diff --check`.

## Verification

Run:

```bash
rtk pnpm exec vitest run packages/core/src/model/schema.test.ts packages/core/src/model/project-ops.test.ts
rtk pnpm --filter @screenshot-studio/core typecheck
rtk git diff --check
```

This slice does not alter rendering, export grouping, CLI routing, or UI behavior, so E2E is not
part of its scoped gate. The shared render/parity gate becomes mandatory in Slice 2.
