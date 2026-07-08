# Phase 2 Slice 4 - Dogfood CLI Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `screenshots dev`, `screenshots import`, and `screenshots screen add/list/rm/reorder` so the Phase 2 workflow is manageable from the CLI.

**Architecture:** Keep all project mutation behind strict JSON load/write helpers in `packages/cli`. Reuse existing `core` schema/export helpers and the existing web server for `dev`; do not introduce a renderer, schema version, or UI-store dependency.

**Tech Stack:** TypeScript, Node.js fs/path APIs, Zod-backed `@screenshot-studio/core/model`, existing CLI test stack with Vitest.

---

## File Structure

Create:

- `packages/cli/src/project-io.ts` - resolves project paths and performs strict load/write.
- `packages/cli/src/project-io.test.ts` - verifies pretty JSON writes and validation.
- `packages/cli/src/screen-commands.ts` - screen list/add/rm/reorder helpers and runners.
- `packages/cli/src/screen-commands.test.ts` - TDD coverage for screen commands.
- `packages/cli/src/import-command.ts` - raw PNG import orchestration.
- `packages/cli/src/import-command.test.ts` - TDD coverage for import parsing and project mutation.

Modify:

- `packages/cli/src/index.ts` - dispatch `dev`, `screen`, and `import`.
- `packages/cli/src/index.test.ts` - command resolution tests.
- `packages/cli/src/server.ts` - accept project env/port options if the current API does not.
- `README.md`, `AGENTS.md`, `docs/roadmap.md` - mark shipped behavior only after verification.

## Task 1: Project IO helper

**Files:**
- Create: `packages/cli/src/project-io.ts`
- Create: `packages/cli/src/project-io.test.ts`

- [ ] **Step 1: Write failing tests for load/write**

Test that `loadProjectFile(path)` parses strict JSON and `writeProjectFile(path, project)` writes
pretty JSON with a trailing newline.

- [ ] **Step 2: Run the focused test**

Run: `rtk pnpm --filter @screenshot-studio/cli exec vitest run src/project-io.test.ts`

Expected: FAIL because `project-io.ts` does not exist.

- [ ] **Step 3: Implement minimal helper**

Add `resolveProjectPath(flags)`, `loadProjectFile(projectPath)`, and `writeProjectFile(projectPath, project)`.

- [ ] **Step 4: Verify green**

Run: `rtk pnpm --filter @screenshot-studio/cli exec vitest run src/project-io.test.ts`

Expected: PASS.

## Task 2: `screen list`

**Files:**
- Create/modify: `packages/cli/src/screen-commands.ts`
- Create/modify: `packages/cli/src/screen-commands.test.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/index.test.ts`

- [ ] **Step 1: Write failing list tests**

Test that `formatScreenList(project)` prints screens in array order as `index id platform/device locale name`.

- [ ] **Step 2: Verify red**

Run: `rtk pnpm --filter @screenshot-studio/cli exec vitest run src/screen-commands.test.ts`

Expected: FAIL because `formatScreenList` does not exist.

- [ ] **Step 3: Implement list formatter and dispatch**

Add `formatScreenList`, `runScreenCommand`, and `screen list` dispatch in `index.ts`.

- [ ] **Step 4: Verify green**

Run focused screen and index tests.

## Task 3: `screen add`

**Files:**
- Modify: `packages/cli/src/screen-commands.ts`
- Modify: `packages/cli/src/screen-commands.test.ts`

- [ ] **Step 1: Write failing add tests**

Cover required platform/device/locale, default lead-size artboard, optional id/name, unique ids, and recomputed `platforms`/`locales`.

- [ ] **Step 2: Verify red**

Run the focused screen command test and confirm missing `addScreenToProject` behavior.

- [ ] **Step 3: Implement add**

Use `leadStoreSizeId` + `findStoreSize` from `core/export`, parse `store-specs.json`, append a schema-valid screen with empty elements, and recompute manifests.

- [ ] **Step 4: Verify green**

Run focused tests.

## Task 4: `screen rm` and `screen reorder`

**Files:**
- Modify: `packages/cli/src/screen-commands.ts`
- Modify: `packages/cli/src/screen-commands.test.ts`

- [ ] **Step 1: Write failing rm/reorder tests**

Cover unknown ids, refusing to remove the final screen, 1-based reorder positions, and derived manifest recomputation.

- [ ] **Step 2: Verify red**

Run focused tests.

- [ ] **Step 3: Implement rm/reorder**

Mutate arrays through cloned project objects, then validate through `Project.parse`.

- [ ] **Step 4: Verify green**

Run focused tests.

## Task 5: `screenshots dev`

**Files:**
- Modify: `packages/cli/src/server.ts`
- Modify: `packages/cli/src/server.test.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/index.test.ts`

- [ ] **Step 1: Write failing dev dispatch/server option tests**

Cover project env injection and optional port forwarding.

- [ ] **Step 2: Verify red**

Run CLI server/index tests.

- [ ] **Step 3: Implement dev command**

Call `startWebServer({ projectPath, port })`, print `${server.url}/editor`, and keep the process alive until interrupted.

- [ ] **Step 4: Verify green**

Run CLI server/index tests.

## Task 6: `screenshots import <dir>`

**Files:**
- Create: `packages/cli/src/import-command.ts`
- Create: `packages/cli/src/import-command.test.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Write failing import tests**

Use a temporary directory containing `apple/iphone/en/01.png` and an unsupported folder. Assert copied asset path, appended screen, screenshot element, warnings, and manifest recomputation.

- [ ] **Step 2: Verify red**

Run the focused import test.

- [ ] **Step 3: Implement import**

Walk supported directories, copy PNGs to `assets/imports/...`, read PNG dimensions with `pngjs`, append screenshot screens, and write the strict project file.

- [ ] **Step 4: Verify green**

Run import tests.

## Task 7: Docs and final verification

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `docs/roadmap.md`

- [ ] **Step 1: Update shipped command docs**

Mark `dev`, `screen add/list/rm/reorder`, and `import` shipped only after tests pass.

- [ ] **Step 2: Run final verification**

Run:

```bash
rtk pnpm test
rtk proxy pnpm typecheck
rtk git diff --check
```

- [ ] **Step 3: Commit**

Commit the completed Slice 4 implementation with a concise `feat:` message.
