# Moderate Project Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve maintainability and documentation accuracy without changing schema v10, rendered output, export behavior, or editor interaction behavior.

**Architecture:** Preserve the single core renderer and existing public facades while extracting typed mutation, traversal, filesystem-publication, packaged-host, and UI-composition boundaries. Historical documentation moves behind an indexed archive boundary; current contract documents become strictly as-built.

**Tech Stack:** TypeScript 5.7, React 19, Next.js 16, Zustand, Immer, Zod, Vitest, Playwright-backed export.

## Global Constraints

- Preserve strict schema v10 and all validation messages and issue paths.
- Preserve the single `elementToNodeConfig`/Konva render path and exact UI/CLI export parity.
- Do not add TypeScript enums for JSON literals already modeled by Zod enums or literal unions.
- Do not delete fixtures, examples, tests, scripts, closure evidence, or referenced architectural contracts.
- Use `rtk` for every shell command.
- Follow red-green-refactor for code behavior and type-boundary changes.
- Do not run `pnpm test:e2e` locally; use only exact browser files when observable interaction changes.

---

### Task 1: Type-safe editor mutations and shared selection traversal

**Files:**
- Modify: `apps/web/lib/editor-store.ts`
- Modify: `apps/web/lib/editor-store.test.ts`
- Create: `apps/web/lib/editor-element-patch.ts`
- Create: `apps/web/lib/editor-selection-mutations.ts`
- Test: `apps/web/lib/editor-store.test.ts`

**Interfaces:**
- Produce `ElementPatchFor<T extends Element["type"]>` and an exhaustive `applyElementPatch` boundary that rejects fields belonging to another element type at compile time.
- Produce an owner-aware selected-element index/traversal helper based on `SelectionRef`, not NUL-delimited string keys.
- Preserve existing editor-store action signatures unless a typed generic is needed for `updateElement`.

- [ ] Add compile-time assertions using `@ts-expect-error` proving text rejects `fill`, icon rejects `crop`, and shape accepts `fill`; add runtime tests proving each valid type-specific patch still applies.
- [ ] Run `rtk pnpm exec vitest run apps/web/lib/editor-store.test.ts` and confirm RED from the missing typed boundary or unused `@ts-expect-error`.
- [ ] Extract patch types/application into `editor-element-patch.ts`, using a discriminated mapping from element type to legal partial fields and an exhaustive switch.
- [ ] Add tests for structured selection indexing across top-level elements and group children, including owner-screen disambiguation.
- [ ] Run the focused test, implement `editor-selection-mutations.ts`, and replace the repeated move/delete/lock/visibility traversal while keeping each action's existing policy.
- [ ] Run `rtk pnpm exec vitest run apps/web/lib/editor-store.test.ts` and `rtk pnpm --filter @screenshot-studio/web typecheck`.
- [ ] Commit as `refactor: type editor mutations and selection traversal`.

### Task 2: Single store-ready export path and isolated bundle publication

**Files:**
- Modify: `packages/cli/src/export.ts`
- Modify: `packages/cli/src/export.test.ts`
- Create: `packages/cli/src/store-ready-png.ts`
- Create: `packages/cli/src/bundle-publisher.ts`
- Create: `packages/cli/src/bundle-publisher.test.ts`

**Interfaces:**
- Produce `renderStoreReadyPng({ screen, target, render }): Promise<Buffer>` where `render(pixelRatio)` supplies raw PNG bytes.
- Move `writeBundleOutputs` and its injected filesystem dependencies to `bundle-publisher.ts` without changing its exported signature or errors.
- Leave `exportScreenToPng`, `exportBundle`, and `resolveTarget` as orchestration APIs.

- [ ] Add a focused test that calls the shared helper with a render spy and verifies calculated ratio, alpha stripping, exact dimensions, and dimension failures.
- [ ] Run `rtk pnpm exec vitest run packages/cli/src/export.test.ts` and confirm RED because the helper does not exist.
- [ ] Implement `store-ready-png.ts` and route both single and bundle exports through it.
- [ ] Move publication tests from `export.test.ts` where applicable and add rollback/recovery coverage in `bundle-publisher.test.ts` before moving production code.
- [ ] Run the two focused test files, move safe-path/staging/rollback code into `bundle-publisher.ts`, and re-export only if an existing consumer requires it.
- [ ] Run `rtk pnpm exec vitest run packages/cli/src/export.test.ts packages/cli/src/bundle-publisher.test.ts` and `rtk pnpm --filter @screenshot-studio/cli typecheck`.
- [ ] Commit as `refactor: isolate export rendering and publication`.

### Task 3: Validated CLI flags and separated packaged-host preparation

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/index.test.ts`
- Modify: `packages/cli/src/server.ts`
- Modify: `packages/cli/src/server.test.ts`
- Create: `packages/cli/src/command-flags.ts`
- Create: `packages/cli/src/packaged-render-host.ts`

**Interfaces:**
- Produce a command-aware parser accepting an explicit spec of value and boolean options, rejecting unknown options and missing values.
- Preserve current supported CLI syntax and semantic combination validation.
- Preserve `startWebServer` and `RunningServer`; move packaged runtime discovery, archive validation/extraction, and Sharp dependency materialization behind an internal preparation API.

- [ ] Add CLI tests for unknown flags, missing values, and invalid platform/device filters; retain coverage for every existing supported option.
- [ ] Run `rtk pnpm exec vitest run packages/cli/src/index.test.ts` and confirm RED.
- [ ] Implement `command-flags.ts`, define per-command option specs, and validate platform/device through existing store-spec/core values instead of unchecked casts.
- [ ] Add or relocate server tests that directly exercise packaged-host preparation and malicious archive/path rejection.
- [ ] Run the focused server test, extract `packaged-render-host.ts`, and leave process startup/readiness/termination in `server.ts`.
- [ ] Run `rtk pnpm exec vitest run packages/cli/src/index.test.ts packages/cli/src/server.test.ts` and `rtk pnpm --filter @screenshot-studio/cli typecheck`.
- [ ] Commit as `refactor: validate cli flags and isolate packaged host`.

### Task 4: Named project validators and durable production wording

**Files:**
- Modify: `packages/core/src/model/schema.ts`
- Modify: `packages/core/src/model/schema.test.ts`
- Modify: `packages/core/src/model/project-ops.ts`
- Modify: `packages/core/src/model/index.ts` if the dead wrapper is re-exported there
- Modify: `packages/cli/src/init.ts`
- Modify: `packages/core/src/assets/index.ts`
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/app/render/page.tsx`

**Interfaces:**
- Keep the exported `Project` Zod schema and every current issue message/path unchanged.
- Create named internal validation functions for manifests, variants, locale direction, element IDs, and font identities.
- Remove `isScreenPlacement` only after repository/public export reference verification.

- [ ] Add a table-driven schema test snapshotting representative issue message/path pairs from every validation category.
- [ ] Run `rtk pnpm exec vitest run packages/core/src/model/schema.test.ts` and confirm the characterization test passes before refactoring.
- [ ] Extract named validators plus a shared derived-manifest/set helper without changing observable validation results.
- [ ] Run `rtk rg -n "isScreenPlacement" . --glob '!node_modules' --glob '!pnpm-lock.yaml'`; remove the wrapper/export only if the definition is the sole result.
- [ ] Replace Phase/Slice-only production comments and `Phase 0 render host` metadata with durable descriptions of current responsibilities.
- [ ] Run `rtk pnpm exec vitest run packages/core/src/model/schema.test.ts` plus core, CLI, and web package typechecks.
- [ ] Commit as `refactor: clarify project validation boundaries`.

### Task 5: Moderate editor component decomposition

**Files:**
- Modify: `apps/web/components/EditorStage.tsx`
- Modify: `apps/web/components/Inspector.tsx`
- Modify: `apps/web/app/editor/page.tsx`
- Create focused files under `apps/web/components/editor-stage/`, `apps/web/components/inspector/`, and `apps/web/app/editor/` only where a responsibility is independently understandable and testable
- Modify exact existing unit tests covering extracted pure helpers; do not add broad browser tests for file movement alone

**Interfaces:**
- Keep the parity-facing Konva node composition in `EditorStage`.
- Extract pure stage-model/selection derivation and interaction hooks without changing store contracts.
- Keep `Inspector` as composition entry point; extract shared media fields and type-specific sections.
- Extract editor bootstrap/resource loading and keyboard routing while preserving current overlay/panel combinations.

- [ ] Characterize any pure derivation moved from `EditorStage` with focused unit tests before extraction.
- [ ] Extract the smallest coherent stage-model and interaction boundaries; run their exact tests and web typecheck after each move.
- [ ] Add focused tests for shared screenshot/image inspector field behavior before extracting `MediaInspectorFields`.
- [ ] Split type-specific inspector sections and artboard/background section without changing labels or controls.
- [ ] Extract page bootstrap/resource loading and keyboard command routing; keep overlay state unchanged unless a single-overlay invariant is already tested.
- [ ] Run `rtk pnpm test:web`, `rtk pnpm --filter @screenshot-studio/web typecheck`, and `rtk pnpm lint`.
- [ ] Run an exact editor E2E file only if tests or diff show an observable interaction change; document the justification either way.
- [ ] Commit as `refactor: decompose editor responsibilities`.

### Task 6: Current documentation and indexed history archive

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/editor.md`
- Modify: `docs/releasing.md`
- Modify: `docs/roadmap.md`
- Create: `docs/archive/README.md`
- Move: completed implementation plans and superseded implementation-oriented specs selected by current-reference analysis
- Modify: all Markdown files whose local links target moved documents

**Interfaces:**
- Current docs describe only enforced v10/as-built behavior.
- Archive index records why documents are retained, their completed/superseded status, and where current contracts live.
- Closure/release evidence and actively cited non-obvious contracts remain outside the archive.

- [ ] Build a reference inventory for all `docs/plans`, `docs/specs`, and `docs/superpowers` candidates; classify each as current contract, closure evidence, or implementation history.
- [ ] Correct architecture element literals, render decision tense, editor status/shadow/background/crop wording, and release limitations against schema v10 and Phase 8/9 closure.
- [ ] Reduce roadmap implementation narration while retaining current status, durable decision boundaries, and evidence links.
- [ ] Move only completed task-by-task plans and superseded implementation specs to `docs/archive/`, preserving relative grouping and Git history.
- [ ] Update local links and add `docs/archive/README.md` with retention rules and a map to current contracts.
- [ ] Run the repository Markdown local-link checker or an equivalent exact script, `rtk pnpm check:community`, and `rtk git diff --check`.
- [ ] Commit as `docs: align current contracts and archive history`.

### Task 7: Integrated verification and cleanup review

**Files:**
- Modify only defects found by verification in the files already scoped above
- Create no new planning artifact

**Interfaces:**
- Produce a verified cleanup branch and a separate follow-up list of names/deeper refactors not implemented in this pass.

- [ ] Run `rtk pnpm test:core`, `rtk pnpm test:cli`, and `rtk pnpm test:web` in one verification batch.
- [ ] Run `rtk pnpm typecheck`, `rtk pnpm lint`, `rtk pnpm check:community`, and `rtk pnpm check:spdx`.
- [ ] Run `rtk git diff --check` and review the full branch diff against this plan and the design non-goals.
- [ ] Dispatch a final whole-branch code review; fix all correctness, compatibility, or maintainability regressions and rerun covering checks.
- [ ] Record additional naming, ownership, and deeper-decomposition candidates separately without implementing them.
- [ ] Commit verification-driven fixes, if any, with the appropriate conventional prefix.
