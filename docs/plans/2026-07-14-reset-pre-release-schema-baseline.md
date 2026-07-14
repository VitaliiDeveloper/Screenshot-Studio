# Reset Pre-release Schema Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the complete current project document the only supported pre-release schema v1, remove internal migrations, and normalize active fixtures without changing rendered output.

**Architecture:** `parseProject()` remains the single UI/CLI load seam, but it rejects unsupported numeric versions before validating the raw object directly with the strict `Project` Zod schema. Active fixtures become complete v1 documents under behavior-based paths; tests that need broken assets build isolated temporary project roots rather than writing beside tracked fixtures.

**Tech Stack:** TypeScript, Zod, Vitest, Playwright-backed parity harness, pnpm.

## Global Constraints

- Preserve the complete current schema shape and all strict validation invariants.
- `schemaVersion: 1` means the first supported complete project format; historical internal formats are unsupported.
- Preserve Zod defaults in parsed return values while never mutating or migrating the caller's raw object.
- Preserve renderer/export behavior, IDs, ordering, assets, dimensions, locales, platforms, directions, and canvas modes.
- Keep existing Zod enums and literal unions; do not add a TypeScript native enum.
- Do not run the full local `pnpm test:e2e` aggregate.
- Do not rewrite historical archives, plans, or specs solely to erase accurate historical references.

---

### Task 1: Enforce the complete strict v1 load contract

**Files:**
- Modify: `packages/core/src/model/schema.ts`
- Modify: `packages/core/src/model/index.ts`
- Modify: `packages/core/src/model/schema.test.ts`
- Delete: `packages/core/src/model/migrate.ts`
- Delete: `packages/core/src/model/migrate.test.ts`
- Modify: `packages/cli/src/init.test.ts`

**Interfaces:**
- Consumes: strict `Project` Zod schema and `ProjectValidationError`.
- Produces: `SCHEMA_VERSION = 1` and `parseProject(raw: unknown): Project` with the dedicated unsupported numeric-version error.

- [ ] Add focused tests proving a complete v1 document parses, versions 2 and 10 throw `Unsupported project schema version X. This build accepts version 1 only.`, missing and non-numeric versions fail strict validation, historical incomplete v1 input is not migrated, and the raw object is not mutated.
- [ ] Run `rtk pnpm exec vitest run packages/core/src/model/schema.test.ts packages/core/src/model/migrate.test.ts packages/cli/src/init.test.ts` and confirm the new expectations fail against the migration chain.
- [ ] Set `SCHEMA_VERSION` to `1`, remove `migrateToCurrent` imports/exports and migration code, and make `parseProject()` check unsupported numeric versions before `Project.safeParse(raw)`.
- [ ] Delete the migration implementation/tests and update stale test imports and comments.
- [ ] Re-run `rtk pnpm exec vitest run packages/core/src/model/schema.test.ts packages/cli/src/init.test.ts` and confirm green.
- [ ] Commit as `refactor: reset pre-release schema baseline`.

### Task 2: Normalize and rename retained fixtures

**Files:**
- Move: `fixtures/phase-0-sample/` to `fixtures/sample/`
- Move: `fixtures/phase-4-rtl/` to `fixtures/regressions/rtl-parity/`
- Move: `fixtures/phase-4-multi-locale/` to `fixtures/regressions/multi-locale-export/`
- Move: `fixtures/slice-2-screenshot/` to `fixtures/regressions/screenshot-parity/`
- Move: `fixtures/slice-3-device-frame/` to `fixtures/regressions/device-frame-parity/`
- Move: `fixtures/phase-6-connected/` to `fixtures/regressions/connected-canvas/`
- Move: `fixtures/phase-7-group/` to `fixtures/regressions/group-parity/`
- Create: `packages/core/src/model/fixtures.test.ts`
- Modify: active production, unit, and E2E references returned by the old-path search.

**Interfaces:**
- Consumes: strict exported `Project` schema.
- Produces: every retained tracked fixture as a complete, directly valid v1 document.

- [ ] Add `fixtures.test.ts` that enumerates tracked `fixtures/**/app-store-screenshots.json`, reads each raw JSON object, and asserts `Project.safeParse(raw).success` without `parseProject()`.
- [ ] Run the new test and confirm it fails on the five incomplete historical fixtures.
- [ ] Use `git mv` for all seven behavior-based paths, set every retained document to version 1, and add only missing required current-shape fields such as the intended `mode`.
- [ ] Update production, unit, E2E, and active-doc path references without changing historical archives/plans/specs.
- [ ] Re-run the fixture test and confirm every retained project validates directly.
- [ ] Compare the living sample before/after after normalizing only `meta.schemaVersion`, and confirm its six screens plus `mode: isolated` are unchanged.
- [ ] Commit as `refactor: normalize active project fixtures`.

### Task 3: Remove generated and single-use fixture state

**Files:**
- Modify: `e2e/screenshot-parity.test.ts`
- Modify: `e2e/device-frame-parity.test.ts`
- Modify: `apps/web/app/api/export/route.test.ts`
- Delete: `fixtures/phase-2-bundle/`
- Create or modify: focused test support local to `apps/web/app/api/export/route.test.ts` only if a helper is shared inside that file.

**Interfaces:**
- Consumes: complete strict v1 project literals and Node temporary-directory APIs.
- Produces: negative parity projects with copied asset context under unique temporary roots, cleaned in `finally`, plus a local complete export-route test project.

- [ ] Change the two negative parity tests first so their assertions require temporary project roots and cleanup, then run both exact files to observe failure before helper implementation is complete.
- [ ] Implement `mkdtemp`/`cp`/`rm` setup in `try/finally`; never write `_missing.json` inside tracked fixture directories.
- [ ] Replace the export-route test's `phase-2-bundle` dependency with a small complete v1 project literal/factory local to the test and delete that fixture directory.
- [ ] Run `rtk pnpm exec vitest run apps/web/app/api/export/route.test.ts` and the exact screenshot/device-frame parity files.
- [ ] Search tracked files for `_missing.json` and `phase-2-bundle`; confirm no active dependency remains.
- [ ] Commit as `test: isolate generated fixture state`.

### Task 4: Align active documentation with the v1 baseline

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/editor.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/releasing.md`
- Modify: `packages/cli/src/project-agent-guide.md`
- Modify: active community/status guards only where their enforced wording or paths changed.

**Interfaces:**
- Consumes: implemented v1 parser and behavior-based fixture paths.
- Produces: active documentation stating that complete strict v1 is the only supported pre-release format and migrations begin only after a published compatibility boundary exists.

- [ ] Update active schema/version wording and fixture paths while preserving accurate historical references.
- [ ] Search production and active docs for `migrateToCurrent`, active schema-v10 wording, and every old fixture path.
- [ ] Inspect remaining matches individually and retain only historical archive/spec/plan references.
- [ ] Run `rtk pnpm run check:community`, `rtk pnpm run check:spdx`, and `rtk git diff --check`.
- [ ] Commit as `docs: document pre-release schema baseline`.

### Task 5: Verify the complete behavioral boundary

**Files:**
- Review: all changed files.

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: green targeted evidence without a full local E2E aggregate.

- [ ] Run `rtk pnpm run test:core`, `rtk pnpm run test:cli`, and `rtk pnpm run test:web`.
- [ ] Run `rtk pnpm run typecheck`, `rtk pnpm run lint`, `rtk pnpm run check:community`, `rtk pnpm run check:spdx`, and `rtk git diff --check`.
- [ ] Run exact browser files: `rtl-parity`, `bundle-export`, `ui-export`, `screenshot-parity`, `device-frame-parity`, `parity`, `connected-canvas-parity`, and `group-parity` through `vitest.e2e.config.ts`.
- [ ] Re-run stale-reference searches and inspect each remaining historical match.
- [ ] Review `rtk git diff --stat`, `rtk git diff`, and sample semantic equivalence evidence.
- [ ] Push `codex/reset-schema-baseline` and open a draft PR against the live resolved base branch with commits, checks, risks, and publication non-goals documented.
