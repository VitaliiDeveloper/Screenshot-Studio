# Structural Constants and Menu Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace brittle editor layout heuristics and duplicated contract literals with measured, typed, testable shared behavior while removing stale extraction seams.

**Architecture:** Pure menu placement and keyboard navigation live in one editor-UI model module; React components only measure DOM rectangles and delegate decisions. Cross-package font rules stay in core, CLI filename policy stays in CLI, and extracted editor APIs expose only values they actually use.

**Tech Stack:** TypeScript 5.7, React 19, Next.js 15, Vitest 2, Zod 3, pnpm 11.

## Global Constraints

- Preserve schema v10 and shared UI/CLI render-export parity.
- Add no dependency and no global `no-magic-numbers` lint rule.
- Keep existing menu markup, styling, focus restoration, click-outside behavior, and public component props.
- Do not touch or stage `fixtures/phase-0-sample/app-store-screenshots.json` or `.superpowers/`.
- Use targeted Vitest files; do not run the full local E2E suite.

---

### Task 1: Shared measured menu behavior

**Files:**
- Create: `apps/web/components/editor-ui/menu-behavior.ts`
- Create: `apps/web/components/editor-ui/menu-behavior.test.ts`
- Modify: `apps/web/components/editor-ui/AddMenu.tsx`
- Modify: `apps/web/components/editor-ui/MenuSelect.tsx`
- Modify: `apps/web/components/LayersSection.tsx`

**Interfaces:**
- Produces: `shouldOpenMenuUpward(input: MenuPlacementInput): boolean`
- Produces: `handleMenuKeyboardNavigation(event, selector): boolean`
- Consumes: rendered trigger/menu rectangles and the existing menu item roles.

- [ ] **Step 1: Write failing pure-behavior tests**

Add tests that import the not-yet-created helpers and verify:

```ts
expect(shouldOpenMenuUpward({
  triggerTop: 620,
  triggerBottom: 652,
  menuHeight: 180,
  viewportHeight: 700,
})).toBe(true);

expect(shouldOpenMenuUpward({
  triggerTop: 80,
  triggerBottom: 112,
  menuHeight: 180,
  viewportHeight: 700,
})).toBe(false);
```

Use structural fake buttons to verify `ArrowDown`, `ArrowUp`, `Home`, and `End` focus the correct item, unsupported keys return `false`, and empty menus do not call `preventDefault`.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
pnpm vitest run apps/web/components/editor-ui/menu-behavior.test.ts
```

Expected: FAIL because `menu-behavior.ts` does not exist.

- [ ] **Step 3: Implement the pure helpers**

Implement the placement decision using measured height:

```ts
export function shouldOpenMenuUpward(input: MenuPlacementInput): boolean {
  const below = input.viewportHeight - input.triggerBottom;
  return below < input.menuHeight && input.triggerTop > below;
}
```

Implement one keyboard helper that recognizes the four navigation keys, queries the caller-provided selector, computes the wrapped index, prevents default only when it handles a non-empty menu, focuses the next button, and returns whether it handled the event.

- [ ] **Step 4: Run the tests and verify GREEN**

Run the same Vitest command. Expected: all menu-behavior tests pass.

- [ ] **Step 5: Wire measured placement into all menus**

In `AddMenu` and `MenuSelect`, add a menu ref and replace `options.length * ...` with `menuRef.current.getBoundingClientRect().height`. In `LayersSection`, add `openActionsUpward` state, measure the active action button and menu in the existing animation frame, and replace `rowIndex >= rows.length - 2` with that state. Delegate all three `onKeyDown` handlers to `handleMenuKeyboardNavigation` with `[role='menuitem']` or `[role='menuitemradio']`.

- [ ] **Step 6: Verify the wired components**

Run:

```bash
pnpm vitest run apps/web/components/editor-ui/menu-behavior.test.ts apps/web/components/editor-ui/editor-ui-compatibility.test.ts apps/web/lib/panel-helpers.test.ts
pnpm --filter @screenshot-studio/web typecheck
```

Expected: all tests pass and web typecheck exits 0.

- [ ] **Step 7: Commit checkpoint**

```bash
git add apps/web/components/editor-ui/menu-behavior.ts apps/web/components/editor-ui/menu-behavior.test.ts apps/web/components/editor-ui/AddMenu.tsx apps/web/components/editor-ui/MenuSelect.tsx apps/web/components/LayersSection.tsx
git commit -m "refactor: measure shared editor menu placement"
```

---

### Task 2: Remove stale editor extraction seams and clarify names

**Files:**
- Modify: `apps/web/components/canvas-viewport/CanvasSurface.tsx`
- Modify: `apps/web/components/canvas-viewport/canvas-viewport-model.ts`
- Modify: `apps/web/components/canvas-viewport/canvas-viewport-model.test.ts`
- Modify: `apps/web/components/canvas-viewport/use-canvas-pan-zoom.ts`
- Modify: `apps/web/components/editor-stage/marquee-selection-model.ts`
- Modify: `apps/web/components/editor-stage/marquee-selection-model.test.ts`
- Modify: `apps/web/components/editor-stage/use-marquee-selection.ts`
- Modify: `apps/web/components/editor-stage/element-transform-model.ts`
- Modify: `apps/web/lib/editor-workspace.ts`
- Modify: `apps/web/lib/editor-workspace.test.ts`
- Modify: `apps/web/components/CanvasViewport.tsx`
- Rename: `apps/web/components/canvas-viewport/OutputFamilyRow.tsx` to `OutputFamilySection.tsx`
- Modify: `apps/web/components/canvas-viewport/ConnectedOutputRow.tsx`
- Modify: `apps/web/components/canvas-viewport/use-canvas-viewport-metrics.ts`

**Interfaces:**
- `nextAnchoredScroll` no longer accepts `leftInset` or `rightInset`.
- `stagePointerPosition(stage)` no longer accepts `baseX`.
- Data types become `OutputFamily` and `WorkspaceOutputFamily` with `editing: boolean`.
- React component becomes `OutputFamilySection`.

- [ ] **Step 1: Update characterization tests to the desired helper signatures**

Remove inset fields from the `nextAnchoredScroll` test input and call `stagePointerPosition(stage)` with one argument. Preserve the existing numerical expectations so behavior remains characterized.

- [ ] **Step 2: Run the focused characterization tests**

```bash
pnpm vitest run apps/web/components/canvas-viewport/canvas-viewport-model.test.ts apps/web/components/editor-stage/marquee-selection-model.test.ts apps/web/lib/editor-workspace.test.ts
```

Expected: existing behavior assertions pass before the signature-only production refactor.

- [ ] **Step 3: Remove dead inputs and legacy code**

Remove `contentWidth`/`contentHeight` from `CanvasSurface`, remove unused inset fields from `nextAnchoredScroll`, remove `_baseX` from `stagePointerPosition`, and delete production-dead `fitZoom` plus its two tests. Replace local interaction literals with:

```ts
const MIN_ELEMENT_SIZE = 5;
const MARQUEE_DRAG_THRESHOLD_PX = 3;
const WHEEL_ZOOM_SENSITIVITY = 0.002;
```

- [ ] **Step 4: Rename output-family concepts consistently**

Rename the data interfaces and component, replace `row.active` with `row.editing`, and remove the redundant `interactive` prop from `ConnectedOutputRow`; the component derives interactivity from `row.editing`.

- [ ] **Step 5: Verify the refactor**

```bash
pnpm vitest run apps/web/components/canvas-viewport/canvas-viewport-model.test.ts apps/web/components/editor-stage/marquee-selection-model.test.ts apps/web/lib/editor-workspace.test.ts
pnpm --filter @screenshot-studio/web typecheck
```

Expected: all focused tests pass and web typecheck exits 0.

- [ ] **Step 6: Commit checkpoint**

Stage only the listed editor files and commit:

```bash
git commit -m "refactor: tighten editor workspace contracts"
```

---

### Task 3: Type element labels against schema truth

**Files:**
- Modify: `apps/web/lib/panel-helpers.ts`
- Modify: `apps/web/lib/panel-helpers.test.ts`

**Interfaces:**
- `elementLabel(element: Pick<Element, "type" | "name">): string`
- `TYPE_LABELS` is exhaustive over `Element["type"]`.

- [ ] **Step 1: Expand current-type behavior coverage**

Add one table-driven test covering text, shape, screenshot, image, icon, device-frame, and group fallback labels.

- [ ] **Step 2: Run the focused test**

```bash
pnpm vitest run apps/web/lib/panel-helpers.test.ts
```

Expected: current runtime labels pass; this is characterization before a type-safety refactor.

- [ ] **Step 3: Tighten the types**

Import `Element`, change the function input to `Pick<Element, "type" | "name">`, define the label record with `satisfies Record<Element["type"], string>`, and delete the impossible `badge` entry.

- [ ] **Step 4: Verify type and behavior**

```bash
pnpm vitest run apps/web/lib/panel-helpers.test.ts
pnpm --filter @screenshot-studio/web typecheck
```

Expected: test and typecheck pass.

- [ ] **Step 5: Commit checkpoint**

```bash
git add apps/web/lib/panel-helpers.ts apps/web/lib/panel-helpers.test.ts
git commit -m "refactor: type layer labels from element schema"
```

---

### Task 4: Centralize the font-weight contract

**Files:**
- Modify: `packages/core/src/model/schema.ts`
- Modify: `packages/core/src/model/schema.test.ts`
- Modify: `packages/core/src/themes/index.ts`
- Modify: `packages/cli/src/font-service.ts`
- Modify: `packages/cli/src/font-service.test.ts`
- Modify: `packages/cli/src/font-commands.ts`
- Modify: `apps/web/components/FontManagerDialog.tsx`

**Interfaces:**
- Produces from `@screenshot-studio/core/model`: `FONT_WEIGHT_MIN`, `FONT_WEIGHT_MAX`, `FONT_WEIGHT_STEP`, `DEFAULT_FONT_WEIGHT`, and `FontWeight` Zod schema.

- [ ] **Step 1: Write failing shared-contract tests**

Import the new constants and schema in `schema.test.ts`. Assert exact values `100`, `900`, `100`, and `400`; assert `FontWeight` accepts boundaries/default and rejects out-of-range/non-integer values.

- [ ] **Step 2: Verify RED**

```bash
pnpm vitest run packages/core/src/model/schema.test.ts
```

Expected: FAIL because the shared exports do not exist.

- [ ] **Step 3: Implement and consume the core contract**

Define the constants once in `schema.ts`, build `FontWeight` from them, and replace the repeated TextElement, FontAsset, and ThemeFont schemas. Use the constants in CLI validation/errors and the web input defaults/bounds/step.

- [ ] **Step 4: Verify GREEN across consumers**

```bash
pnpm vitest run packages/core/src/model/schema.test.ts packages/core/src/themes/index.test.ts packages/cli/src/font-service.test.ts packages/cli/src/font-commands.test.ts
pnpm --filter @screenshot-studio/core typecheck
pnpm --filter @screenshot-studio/cli typecheck
pnpm --filter @screenshot-studio/web typecheck
```

Expected: tests pass and all three packages typecheck.

- [ ] **Step 5: Commit checkpoint**

```bash
git add packages/core/src/model/schema.ts packages/core/src/model/schema.test.ts packages/core/src/themes/index.ts packages/cli/src/font-service.ts packages/cli/src/font-service.test.ts packages/cli/src/font-commands.ts apps/web/components/FontManagerDialog.tsx
git commit -m "refactor: centralize font weight contract"
```

---

### Task 5: Centralize the CLI project filename

**Files:**
- Modify: `packages/cli/src/project-io.ts`
- Modify: `packages/cli/src/project-io.test.ts`
- Modify: `packages/cli/src/export-command.ts`
- Modify: `packages/cli/src/init.ts`

**Interfaces:**
- Produces: `DEFAULT_PROJECT_FILENAME = "app-store-screenshots.json"` from `project-io.ts`.
- `runExportCommand` consumes `resolveProjectPath(flags)`.

- [ ] **Step 1: Write a failing constant test**

Import `DEFAULT_PROJECT_FILENAME` from `project-io.ts`, assert its exact value, and retain coverage that `resolveProjectPath({})` resolves it from the current directory.

- [ ] **Step 2: Verify RED**

```bash
pnpm vitest run packages/cli/src/project-io.test.ts
```

Expected: FAIL because the constant is not exported.

- [ ] **Step 3: Implement one filename source**

Export the constant, use it in `resolveProjectPath`, import it in `init.ts`, and replace the direct `resolve(flags.project ?? ...)` expression in `export-command.ts` with `resolveProjectPath(flags)`.

- [ ] **Step 4: Verify GREEN**

```bash
pnpm vitest run packages/cli/src/project-io.test.ts packages/cli/src/export.test.ts
pnpm --filter @screenshot-studio/cli typecheck
```

Expected: tests pass and CLI typecheck exits 0.

- [ ] **Step 5: Commit checkpoint**

```bash
git add packages/cli/src/project-io.ts packages/cli/src/project-io.test.ts packages/cli/src/export-command.ts packages/cli/src/init.ts
git commit -m "refactor: centralize cli project filename"
```

---

### Task 6: Final scoped verification

**Files:**
- Modify only if a check exposes a defect in this plan's files.

- [ ] **Step 1: Search for removed brittle patterns**

```bash
rg -n "estimatedMenuHeight|rowIndex >= rows.length - 2|void contentWidth|void contentHeight|_baseX|padding = 112" apps/web packages/cli/src packages/core/src
```

Expected: no matches.

- [ ] **Step 2: Run affected package suites**

```bash
pnpm test:web
pnpm test:cli
pnpm test:core
```

Expected: all affected package tests pass.

- [ ] **Step 3: Run static verification**

```bash
pnpm lint
pnpm typecheck
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 4: Review final scope**

Confirm `git status -sb` still shows the pre-existing fixture and `.superpowers/` changes as unrelated, and confirm no implementation commit contains them.

- [ ] **Step 5: Commit any verification-only correction**

Only if Step 2 or 3 required a scoped correction, stage the exact corrected files and commit with an imperative conventional subject. Otherwise create no empty commit.
