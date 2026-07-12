# Deep Structure Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split six oversized production modules into focused, testable ownership boundaries without changing editor behavior, schema v10, persisted JSON, render/export output, CLI syntax, or public package surfaces.

**Architecture:** Keep each current entrypoint as the stable composition or compatibility surface, and move implementation behind pure helpers, focused hooks, and domain modules. Preserve one-way dependencies: leaf modules may depend on shared models, while barrels and composition roots depend on leaf modules and are never imported back by them.

**Tech Stack:** TypeScript, React 19, Next.js, Zustand vanilla, Immer, Konva/react-konva, Zod, Vitest, Playwright, pnpm.

## Global Constraints

- Work only in `codex/deep-structure-cleanup`, stacked on `codex/moderate-project-cleanup`.
- Do not add features, schema fields, commands, output formats, dependencies, or TypeScript enums.
- Preserve schema v10, strict validation, public exports, error strings, CLI output, save/history grouping, connected owner-local coordinates, and shared-renderer parity.
- Keep `editor-store.ts`, `editor-ui.tsx`, `project-ops.ts`, and CLI `index.ts` as compatibility/composition entrypoints.
- Never introduce a second renderer or split the Konva node-mapping tree into a parallel render path.
- Run shell commands through `rtk`; do not run the full local `pnpm test:e2e` aggregate.
- Commit each task independently with an English conventional subject and no attribution trailer.

---

## File Structure

### Web store

- `apps/web/lib/editor-history.ts`: bounded history transitions and selection reconciliation.
- `apps/web/lib/editor-screen-mutations.ts`: pure screen/resource/artboard project transitions.
- `apps/web/lib/editor-project-actions.ts`: pure adapters for canvas, locale, and store-output operations.
- `apps/web/lib/editor-store.ts`: public `EditorState`, patch types, Zustand wiring, and owner-aware element actions.

### Canvas and stage

- `apps/web/components/canvas-viewport/canvas-viewport-model.ts`: pure viewport coordinate and anchored-scroll calculations.
- `apps/web/components/canvas-viewport/use-canvas-viewport-metrics.ts`: measurement and fit lifecycle.
- `apps/web/components/canvas-viewport/use-canvas-pan-zoom.ts`: Space/Hand panning and pointer-centred zoom.
- `apps/web/components/canvas-viewport/CanvasSurface.tsx`: presentation-only surface shell.
- `apps/web/components/editor-stage/element-transform-model.ts`: pure transformed-dimension calculation.
- `apps/web/components/editor-stage/use-element-transform.ts`: drag, snap, transform, and persistence controller.
- `apps/web/components/editor-stage/marquee-selection-model.ts`: pure marquee geometry and owner-aware hit resolution.
- `apps/web/components/editor-stage/use-marquee-selection.ts`: marquee event lifecycle.
- `apps/web/components/editor-stage/inline-text-editing-model.ts`: pure inline-editor geometry/style derivation.
- `apps/web/components/editor-stage/use-inline-text-editing.ts`: textarea lifecycle and single-commit guard.
- `apps/web/components/CanvasViewport.tsx`: store-backed workspace composition and view transitions.
- `apps/web/components/EditorStage.tsx`: single Konva stage/layer/node mapping tree.

### Shared editor UI

- `apps/web/components/editor-ui/styles.ts`: `cx` and `editorUi` class tokens.
- `apps/web/components/editor-ui/AddMenu.tsx`: add-menu types and behavior.
- `apps/web/components/editor-ui/MenuSelect.tsx`: select-menu types and behavior.
- `apps/web/components/editor-ui/DialogShell.tsx`: dialog focus, Escape, backdrop, and layout.
- `apps/web/components/editor-ui/EmptyResourceState.tsx`: empty-state presentation.
- `apps/web/components/editor-ui.tsx`: compatibility barrel with the same public names.

### Core model

- `packages/core/src/model/project-manifest.ts`: derived manifest recomputation shared by domain operations.
- `packages/core/src/model/project-font-ops.ts`: unresolved-font discovery and assertions.
- `packages/core/src/model/project-screen-ops.ts`: naming/id helpers, placement parsing, and screen lifecycle.
- `packages/core/src/model/project-artboard-ops.ts`: fit and resize operations.
- `packages/core/src/model/project-output-ops.ts`: output-family and store-target variant lifecycle.
- `packages/core/src/model/project-locale-ops.ts`: locale cloning, removal, and direction changes.
- `packages/core/src/model/project-ops.ts`: public compatibility barrel only.

### CLI

- `packages/cli/src/cli-runtime.ts`: server race and cleanup/error aggregation.
- `packages/cli/src/export-command.ts`: single and bundle export orchestration.
- `packages/cli/src/dev-command.ts`: dev/import options and execution.
- `packages/cli/src/command-dispatch.ts`: command-aware option helpers, handler table, usage, and service routing.
- `packages/cli/src/index.ts`: package-path defaults, argument parsing, dispatch invocation, executable guard, terminal error reporting, and compatibility re-exports.

---

### Task 1: Extract editor history and pure project transitions

**Files:**
- Create: `apps/web/lib/editor-history.ts`
- Create: `apps/web/lib/editor-history.test.ts`
- Create: `apps/web/lib/editor-screen-mutations.ts`
- Create: `apps/web/lib/editor-screen-mutations.test.ts`
- Create: `apps/web/lib/editor-project-actions.ts`
- Create: `apps/web/lib/editor-project-actions.test.ts`
- Modify: `apps/web/lib/editor-store.ts`
- Test: `apps/web/lib/editor-store.test.ts`

**Interfaces:**
- Consumes: core `Project`, `Element`, `Background`, `FontAsset`, `LayoutDirection`, `CanvasMode`, `StoreSize`, and `SelectionRef`.
- Produces:

```ts
export interface EditorHistorySnapshot {
  project: Project | null;
  activeScreenId: string | null;
  selectedItems: SelectionRef[];
  historyPast: Project[];
  historyFuture: Project[];
  historyGroupKey: string | null;
}

export function recordProjectChange(
  state: EditorHistorySnapshot,
  project: Project,
  historyGroupKey?: string | null,
  extra?: Partial<EditorHistorySnapshot>,
): EditorHistorySnapshot | Partial<EditorHistorySnapshot>;
export function undoProjectChange(state: EditorHistorySnapshot): EditorHistorySnapshot;
export function redoProjectChange(state: EditorHistorySnapshot): EditorHistorySnapshot;

export interface ProjectMutationResult {
  project: Project;
  activeScreenId?: string | null;
  selectedItems?: SelectionRef[];
}
```

- `editor-screen-mutations.ts` exports `reorderProjectScreens`, `appendClonedScreen`, `appendBlankScreen`, `removeProjectScreen`, `reorderScreenElements`, `removeScreenElement`, `appendScreenElement`, `setScreenBackground`, `resizeProjectArtboards`, and `replaceProjectFonts`.
- `editor-project-actions.ts` exports `changeCanvasMode`, `createStoreOutputFamily`, `createStoreTargetVariant`, `deleteStoreTargetVariant`, `cloneProjectLocale`, `changeProjectLocaleDirection`, and `deleteProjectLocale`.
- None of the three helper modules imports `EditorState`, `editorStore`, Zustand, or the durable save wrapper.

- [ ] **Step 1: Add RED characterization tests for the extracted history boundary**

```ts
import { describe, expect, it } from "vitest";
import { recordProjectChange, redoProjectChange, undoProjectChange } from "./editor-history.js";

describe("editor history transitions", () => {
  it("coalesces equal non-null group keys and bounds history at 50 projects", () => {
    const first = recordProjectChange(makeHistoryState(projectA), projectB, "element:s1:e1");
    const second = recordProjectChange({ ...makeHistoryState(projectB), ...first }, projectC, "element:s1:e1");
    expect(second.historyPast).toEqual([projectA]);
    expect(second.historyFuture).toEqual([]);
  });

  it("undoes and redoes while reconciling active screen and owner-aware selection", () => {
    const undone = undoProjectChange(makeUndoableHistoryState());
    expect(undone.project).toBe(projectA);
    expect(undone.selectedItems).toEqual([{ screenId: "screen-a", elementId: "text-a" }]);
    expect(redoProjectChange(undone).project).toBe(projectB);
  });
});
```

- [ ] **Step 2: Run the history test and confirm the missing-module failure**

Run: `rtk pnpm exec vitest run apps/web/lib/editor-history.test.ts`

Expected: FAIL because `./editor-history.js` does not exist.

- [ ] **Step 3: Implement the history helpers by moving the existing limit, grouping, undo/redo, and selection reconciliation unchanged**

Use `HISTORY_LIMIT = 50`, preserve `slice(-HISTORY_LIMIT)`, preserve project identity no-op behavior, and return state fragments suitable for Zustand `set` without importing the store.

- [ ] **Step 4: Add RED characterization tests for screen and project action result metadata**

```ts
it("removing an active root removes its variants and chooses the locale fallback", () => {
  const result = removeProjectScreen(project, "root-a", "root-a", [
    { screenId: "variant-a", elementId: "text-a" },
  ]);
  expect(result.project.screens.map((screen) => screen.id)).toEqual(["root-b"]);
  expect(result.activeScreenId).toBe("root-b");
  expect(result.selectedItems).toEqual([]);
});

it("creating a target variant activates the returned variant and clears selection", () => {
  const result = createStoreTargetVariant(project, rootId, target);
  expect(result.activeScreenId).toBe(result.project.screens.find((screen) => screen.storeTargetId === target.id)?.id);
  expect(result.selectedItems).toEqual([]);
});
```

- [ ] **Step 5: Run the mutation tests and confirm the missing-module failures**

Run: `rtk pnpm exec vitest run apps/web/lib/editor-screen-mutations.test.ts apps/web/lib/editor-project-actions.test.ts`

Expected: FAIL because the new modules do not exist.

- [ ] **Step 6: Move the existing pure transition bodies and rewire `editorStore`**

Keep the public declaration unchanged:

Keep the source-compatible `EditorState`, `PatchElementRequest`, patch-type re-exports, and
`editorStore` declarations in `editor-store.ts`. Each moved action becomes a thin
`set(state => recordProjectChange(state, transition(...)))` adapter; no public action signature
changes.

Leave owner-aware patch/move/group/ungroup/duplicate element actions in `editor-store.ts`; do not widen casts or duplicate core operations.

- [ ] **Step 7: Run focused and package checks**

Run: `rtk pnpm exec vitest run apps/web/lib/editor-history.test.ts apps/web/lib/editor-screen-mutations.test.ts apps/web/lib/editor-project-actions.test.ts apps/web/lib/editor-store.test.ts`

Expected: PASS.

Run: `rtk pnpm --filter @screenshot-studio/web typecheck`

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
rtk git add apps/web/lib/editor-history.ts apps/web/lib/editor-history.test.ts apps/web/lib/editor-screen-mutations.ts apps/web/lib/editor-screen-mutations.test.ts apps/web/lib/editor-project-actions.ts apps/web/lib/editor-project-actions.test.ts apps/web/lib/editor-store.ts
rtk git commit -m "refactor: split editor store transitions"
```

### Task 2: Extract CanvasViewport lifecycle boundaries

**Files:**
- Create: `apps/web/components/canvas-viewport/canvas-viewport-model.ts`
- Create: `apps/web/components/canvas-viewport/canvas-viewport-model.test.ts`
- Create: `apps/web/components/canvas-viewport/use-canvas-viewport-metrics.ts`
- Create: `apps/web/components/canvas-viewport/use-canvas-pan-zoom.ts`
- Create: `apps/web/components/canvas-viewport/CanvasSurface.tsx`
- Modify: `apps/web/components/CanvasViewport.tsx`
- Test: `apps/web/lib/editor-workspace.test.ts`
- Browser test: `e2e/editor-workspace.test.ts`

**Interfaces:**

```ts
export interface ClientPoint { x: number; y: number }
export function clientToViewportPoint(rect: DOMRectReadOnly, point: ClientPoint): ClientPoint;
export function nextAnchoredScroll(input: {
  scrollLeft: number; scrollTop: number; anchor: ClientPoint;
  previousZoom: number; nextZoom: number; leftInset: number; rightInset: number;
}): { scrollLeft: number; scrollTop: number };

export function useCanvasViewportMetrics(input: CanvasViewportMetricsInput): {
  contentWidth: number; contentHeight: number; fitLayoutKey: string; fit(): void;
};
export function useCanvasPanZoom(input: CanvasPanZoomInput): {
  spacePressed: boolean; panning: boolean;
  zoomAt(value: number, clientPoint?: ClientPoint): void;
  pointerHandlers: Pick<React.HTMLAttributes<HTMLDivElement>,
    "onPointerDownCapture" | "onPointerMove" | "onPointerUp" | "onPointerCancel">;
};
```

- Initial reveal, Focus/Overview transition ordering, active-artboard auto-scroll, screen/output-row composition, and `EditorStage` selection remain in `CanvasViewport`.
- Hooks take explicit refs/values/callbacks and never import the editor store.

- [ ] **Step 1: Add RED pure model tests for coordinate conversion and anchored zoom**

```ts
it("keeps the pointer's content coordinate stable across zoom", () => {
  expect(nextAnchoredScroll({
    scrollLeft: 120, scrollTop: 80, anchor: { x: 240, y: 180 },
    previousZoom: 1, nextZoom: 2, leftInset: 48, rightInset: 0,
  }));
  expect(result.scrollLeft).toBe(480);
  expect(result.scrollTop).toBe(340);
});
```

- [ ] **Step 2: Run the model test and confirm the missing-module failure**

Run: `rtk pnpm exec vitest run apps/web/components/canvas-viewport/canvas-viewport-model.test.ts`

Expected: FAIL because the model module does not exist.

- [ ] **Step 3: Implement pure model helpers and move metric/pan-zoom logic into hooks**

Preserve the current zoom clamp, wheel `preventDefault`, Space filtering for editable controls, pointer capture, scroll reset, `fitArtboardRowsZoom`/`fitArtboardsZoom` choice, and current layout-effect/RAF ordering.

- [ ] **Step 4: Add `CanvasSurface` and recompose `CanvasViewport`**

```tsx
<CanvasSurface
  viewportRef={viewportRef}
  pattern={canvasPattern}
  contentWidth={contentWidth}
  contentHeight={contentHeight}
  pointerHandlers={pointerHandlers}
>
  {workspaceContent}
</CanvasSurface>
```

Keep all data attributes, empty/loading overlays, controls placement, and DOM ordering unchanged.

- [ ] **Step 5: Run focused unit, type, and exact browser checks**

Run: `rtk pnpm exec vitest run apps/web/lib/editor-workspace.test.ts apps/web/components/canvas-viewport/canvas-viewport-model.test.ts`

Expected: PASS.

Run: `rtk pnpm --filter @screenshot-studio/web typecheck`

Expected: exit 0.

Run: `rtk pnpm exec vitest run --config vitest.e2e.config.ts e2e/editor-workspace.test.ts`

Expected: PASS for fit, stale-frame prevention, pattern, zoom, Hand/Space pan, and panel insets.

- [ ] **Step 6: Commit**

```bash
rtk git add apps/web/components/CanvasViewport.tsx apps/web/components/canvas-viewport apps/web/lib/editor-workspace.test.ts
rtk git commit -m "refactor: split canvas viewport lifecycle"
```

### Task 3: Extract EditorStage interaction controllers

**Files:**
- Create: `apps/web/components/editor-stage/element-transform-model.ts`
- Create: `apps/web/components/editor-stage/element-transform-model.test.ts`
- Create: `apps/web/components/editor-stage/use-element-transform.ts`
- Create: `apps/web/components/editor-stage/marquee-selection-model.ts`
- Create: `apps/web/components/editor-stage/marquee-selection-model.test.ts`
- Create: `apps/web/components/editor-stage/use-marquee-selection.ts`
- Create: `apps/web/components/editor-stage/inline-text-editing-model.ts`
- Create: `apps/web/components/editor-stage/inline-text-editing-model.test.ts`
- Create: `apps/web/components/editor-stage/use-inline-text-editing.ts`
- Modify: `apps/web/components/editor-stage/stage-model.ts`
- Modify: `apps/web/components/EditorStage.tsx`
- Test: `apps/web/components/editor-stage/stage-model.test.ts`
- Browser tests: `e2e/editor.test.ts`, `e2e/editor-multi-select.test.ts`, `e2e/editor-snapping.test.ts`

**Interfaces:**

```ts
export function transformedDimensions(
  element: Element,
  scaleX: number,
  scaleY: number,
): { width: number; height: number };

export function useElementTransform(input: ElementTransformInput): {
  verticalGuideRef: React.MutableRefObject<Konva.Line | null>;
  horizontalGuideRef: React.MutableRefObject<Konva.Line | null>;
  onDragMove(screenId: string, elementId: string): void;
  onDragEnd(screenId: string, elementId: string): void;
  onTransformEnd(screenId: string, elementId: string): void;
};

export function stagePointerPosition(stage: Konva.Stage, baseX: number): ClientPoint | null;
export function marqueeBounds(start: ClientPoint, current: ClientPoint): Rect;
export function marqueeHasMoved(start: ClientPoint, current: ClientPoint, zoom: number): boolean;
export function resolveMarqueeSelection(input: ResolveMarqueeSelectionInput): SelectionRef[];
export function useMarqueeSelection(input: MarqueeSelectionInput): MarqueeSelectionController;
export function useInlineTextEditing(input: InlineTextEditingInput): InlineTextEditingController;
```

- `EditorStage` retains the only `<Stage>/<Layer>` tree, background/element node mapping, guides, Transformer, and `renderNodeConfigChild`.
- Hooks accept explicit callbacks and refs; they do not import `editorStore` or mutate project objects.

- [ ] **Step 1: Add RED pure model tests**

```ts
it("uses the existing 3 / zoom movement threshold", () => {
  expect(marqueeHasMoved({ x: 0, y: 0 }, { x: 2, y: 0 }, 1)).toBe(false);
  expect(marqueeHasMoved({ x: 0, y: 0 }, { x: 4, y: 0 }, 1)).toBe(true);
});

it("keeps uniform group resize dimensions", () => {
  expect(transformedDimensions(makeGroup({ width: 100, height: 50 }), 1.5, 2))
    .toEqual({ width: 175, height: 87.5 });
});

it("derives textarea geometry from owner-local projection and zoom", () => {
  expect(deriveInlineTextStyle(makeInlineTextInput({ x: 20, y: 30, zoom: 2 })))
    .toMatchObject({ left: "40px", top: "60px", transformOrigin: "top left" });
});
```

- [ ] **Step 2: Run model tests and confirm missing-module failures**

Run: `rtk pnpm exec vitest run apps/web/components/editor-stage/element-transform-model.test.ts apps/web/components/editor-stage/marquee-selection-model.test.ts apps/web/components/editor-stage/inline-text-editing-model.test.ts`

Expected: FAIL because the new model modules do not exist.

- [ ] **Step 3: Implement model helpers and the three hooks by moving current behavior unchanged**

Preserve `6 / zoom` snapping, `3 / zoom` marquee threshold, modifier-toggle selection, owner-aware keys, connected owner-local persistence, locked-node rollback, one history/save step per completed gesture, and the Control+Enter/blur double-commit guard.

- [ ] **Step 4: Recompose `EditorStage` around the controllers**

Instantiate `useElementTransform` with `projections`, `selectedItems`, `zoom`, `stageSize`,
`nodeRefs`, `transformerRef`, `getLiveElement`, `patchElement`, and `moveSelected`. Instantiate
`useMarqueeSelection` with `canEdit`, `zoom`, `projections`, `baseX`, `selectedItems`, and
`setSelection`. Instantiate `useInlineTextEditing` with `projections`, `baseX`, `zoom`, `canEdit`,
`getLiveElement`, and the existing text commit callback.

Bind returned handlers to the existing node tree; do not move node mapping or create a second persisted state model.

- [ ] **Step 5: Run focused unit, type, and exact interaction checks**

Run: `rtk pnpm exec vitest run apps/web/components/editor-stage/stage-model.test.ts apps/web/components/editor-stage/element-transform-model.test.ts apps/web/components/editor-stage/marquee-selection-model.test.ts apps/web/components/editor-stage/inline-text-editing-model.test.ts`

Expected: PASS.

Run: `rtk pnpm --filter @screenshot-studio/web typecheck`

Expected: exit 0.

Run: `rtk pnpm exec vitest run --config vitest.e2e.config.ts e2e/editor.test.ts e2e/editor-multi-select.test.ts e2e/editor-snapping.test.ts`

Expected: PASS for text editing, drag/transform, multi-selection, and snapping.

- [ ] **Step 6: Commit**

```bash
rtk git add apps/web/components/EditorStage.tsx apps/web/components/editor-stage
rtk git commit -m "refactor: split editor stage interactions"
```

### Task 4: Split shared editor UI primitives

**Files:**
- Create: `apps/web/components/editor-ui/styles.ts`
- Create: `apps/web/components/editor-ui/AddMenu.tsx`
- Create: `apps/web/components/editor-ui/MenuSelect.tsx`
- Create: `apps/web/components/editor-ui/DialogShell.tsx`
- Create: `apps/web/components/editor-ui/EmptyResourceState.tsx`
- Modify: `apps/web/components/editor-ui.tsx`
- Browser tests: `e2e/accessibility.test.ts`, `e2e/editor-workspace.test.ts`, `e2e/locale-workspace.test.ts`

**Interfaces:**
- Produces the same public `cx`, `editorUi`, `AddMenuOption`, `AddMenu`, `MenuSelectOption`, `MenuSelect`, `DialogShell`, and `EmptyResourceState` names from `editor-ui.tsx`.
- Client components import `cx`/`editorUi` from `./styles.js`, never from the barrel.

- [ ] **Step 1: Add the compatibility barrel first and confirm type resolution fails until leaf modules exist**

```ts
"use client";
export { cx, editorUi } from "./editor-ui/styles.js";
export { AddMenu, type AddMenuOption } from "./editor-ui/AddMenu.js";
export { MenuSelect, type MenuSelectOption } from "./editor-ui/MenuSelect.js";
export { DialogShell } from "./editor-ui/DialogShell.js";
export { EmptyResourceState } from "./editor-ui/EmptyResourceState.js";
```

- [ ] **Step 2: Run typecheck and confirm missing-module errors**

Run: `rtk pnpm --filter @screenshot-studio/web typecheck`

Expected: FAIL with missing `./editor-ui/*` modules.

- [ ] **Step 3: Move each component verbatim into its focused module**

Preserve roles, ARIA attributes, focus restoration, Escape/outside-click behavior, dialog focus trap, backdrop handling, `data-placement`, `data-menu-select-value`, class tokens, and DOM order. Add `"use client"` to hook-using component modules.

- [ ] **Step 4: Run type, lint, and exact browser checks**

Run: `rtk pnpm --filter @screenshot-studio/web typecheck`

Expected: exit 0.

Run: `rtk pnpm exec eslint apps/web/components/editor-ui.tsx apps/web/components/editor-ui`

Expected: exit 0.

Run: `rtk pnpm exec vitest run --config vitest.e2e.config.ts e2e/accessibility.test.ts e2e/editor-workspace.test.ts e2e/locale-workspace.test.ts`

Expected: PASS for menu/dialog keyboard, focus, and selection behavior.

- [ ] **Step 5: Commit**

```bash
rtk git add apps/web/components/editor-ui.tsx apps/web/components/editor-ui
rtk git commit -m "refactor: split editor ui primitives"
```

### Task 5: Split core project operations by domain

**Files:**
- Create: `packages/core/src/model/project-manifest.ts`
- Create: `packages/core/src/model/project-font-ops.ts`
- Create: `packages/core/src/model/project-screen-ops.ts`
- Create: `packages/core/src/model/project-artboard-ops.ts`
- Create: `packages/core/src/model/project-output-ops.ts`
- Create: `packages/core/src/model/project-locale-ops.ts`
- Modify: `packages/core/src/model/project-ops.ts`
- Test: `packages/core/src/model/project-ops.test.ts`
- Consumer tests: `packages/core/src/templates/index.test.ts`, `packages/cli/src/import-command.test.ts`, `packages/cli/src/screen-commands.test.ts`, `packages/cli/src/locale-commands.test.ts`

**Interfaces:**
- `project-ops.ts` re-exports every existing function/type, including deprecated compatibility helper `isScreenPlacement`.
- Dependencies are one-way: screen/font domains may use `project-manifest`; output operations may use screen/artboard operations; locale operations may use screen/manifest operations; the barrel imports nothing for implementation.

- [ ] **Step 1: Add a public export characterization test**

```ts
it("keeps the project-ops compatibility surface", () => {
  expect(typeof slugify).toBe("function");
  expect(typeof isScreenPlacement).toBe("function");
  expect(typeof ensureStoreOutputFamily).toBe("function");
  expect(typeof setLocaleDirection).toBe("function");
});
```

- [ ] **Step 2: Run the current core and consumer characterization tests**

Run: `rtk pnpm exec vitest run packages/core/src/model/project-ops.test.ts packages/core/src/templates/index.test.ts packages/cli/src/import-command.test.ts packages/cli/src/screen-commands.test.ts packages/cli/src/locale-commands.test.ts`

Expected: PASS before movement.

- [ ] **Step 3: Move declarations and implementations without changing bodies**

Use explicit barrel exports:

```ts
export * from "./project-manifest.js";
export * from "./project-font-ops.js";
export * from "./project-screen-ops.js";
export * from "./project-artboard-ops.js";
export * from "./project-output-ops.js";
export * from "./project-locale-ops.js";
```

Keep all Zod parse backstops, error messages, fresh-id order, idempotency, screen order, and return shapes byte-for-byte equivalent.

- [ ] **Step 4: Run focused, type, and package checks**

Run: `rtk pnpm exec vitest run packages/core/src/model/project-ops.test.ts packages/core/src/templates/index.test.ts packages/cli/src/import-command.test.ts packages/cli/src/screen-commands.test.ts packages/cli/src/locale-commands.test.ts`

Expected: PASS.

Run: `rtk pnpm --filter @screenshot-studio/core typecheck && rtk pnpm --filter @screenshot-studio/cli typecheck && rtk pnpm --filter @screenshot-studio/web typecheck`

Expected: all exit 0.

Run: `rtk pnpm run test:core`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/core/src/model/project-ops.ts packages/core/src/model/project-manifest.ts packages/core/src/model/project-font-ops.ts packages/core/src/model/project-screen-ops.ts packages/core/src/model/project-artboard-ops.ts packages/core/src/model/project-output-ops.ts packages/core/src/model/project-locale-ops.ts packages/core/src/model/project-ops.test.ts
rtk git commit -m "refactor: split core project operations"
```

### Task 6: Split CLI executable orchestration

**Files:**
- Create: `packages/cli/src/cli-runtime.ts`
- Create: `packages/cli/src/cli-runtime.test.ts`
- Create: `packages/cli/src/export-command.ts`
- Create: `packages/cli/src/dev-command.ts`
- Create: `packages/cli/src/command-dispatch.ts`
- Modify: `packages/cli/src/index.ts`
- Test: `packages/cli/src/index.test.ts`
- Test: `packages/cli/src/export.test.ts`
- Test: `packages/cli/src/server.test.ts`
- Test: `packages/cli/src/render-driver.test.ts`
- Test: `packages/cli/src/bundle-publisher.test.ts`
- Browser/package test: `e2e/packaged-cli.test.ts`

**Interfaces:**

```ts
export interface DevOptions { projectPath: string; port?: number }
export interface ImportOptions { projectPath: string; inputDir: string }
export type ExportMode =
  | { kind: "single"; screenId: string; sizeId?: string }
  | { kind: "bundle"; filters: BundleFilters };
export function failWhenServerExits<T>(
  server: RunningServer,
  operation: Promise<T>,
): Promise<T>;
export function closeAll(actions: Array<() => Promise<void>>): Promise<void>;
export function runWithCleanup<T>(
  operation: () => Promise<T>,
  cleanup: () => Promise<void>,
): Promise<T>;
export function runExportCommand(
  flags: Record<string, string>,
  defaultStoreSpecsPath: string,
): Promise<void>;
export function dispatchCommand(
  command: string | undefined,
  argv: string[],
  defaults: { storeSpecsPath: string },
): Promise<void>;
```

- `index.ts` re-exports `positionalArgs`, `DevOptions`, `resolveDevOptions`, `ImportOptions`, `resolveImportOptions`, `ExportMode`, `resolveExportMode`, `singleExportFilename`, and `singleExportTargetId` from their focused command modules for source-import compatibility.
- `index.ts` remains the esbuild executable entry and direct-import guard; importing it in a test must not execute the CLI.

- [ ] **Step 1: Add RED lifecycle characterization tests**

```ts
it("preserves the primary operation error when cleanup also fails", async () => {
  await expect(runWithCleanup(() => Promise.reject(primaryError), rejectCleanup))
    .rejects.toMatchObject({ errors: [primaryError, cleanupError] });
});

it("rejects when the server exits before the operation settles", async () => {
  await expect(failWhenServerExits(exitingServer, pendingOperation))
    .rejects.toThrow("Web server exited unexpectedly with code 7");
});
```

- [ ] **Step 2: Run the lifecycle test and confirm the missing-module failure**

Run: `rtk pnpm exec vitest run packages/cli/src/cli-runtime.test.ts`

Expected: FAIL because `cli-runtime.ts` does not exist.

- [ ] **Step 3: Move option helpers and runtime lifecycle unchanged**

Preserve `AggregateError` ordering, server-exit race, browser/server close order, default values, platform/device guards, filenames, and target-id resolution.

- [ ] **Step 4: Move export orchestration and command routing**

`export-command.ts` owns export option resolution plus single/bundle orchestration.
`dev-command.ts` owns dev/import option resolution and execution. `command-dispatch.ts` owns the
command-to-handler table, usage text, and command-specific routing for
init/screen/dev/import/font/theme/locale/asset/canvas while reusing existing service modules.

- [ ] **Step 5: Reduce `index.ts` to executable composition and compatibility exports**

```ts
#!/usr/bin/env node
export { positionalArgs } from "./command-dispatch.js";
export { type DevOptions, type ImportOptions, resolveDevOptions, resolveImportOptions } from "./dev-command.js";
export { type ExportMode, resolveExportMode, singleExportFilename, singleExportTargetId } from "./export-command.js";

if (invokedDirectly) {
  dispatchCommand(command, argv, { storeSpecsPath: DEFAULT_STORE_SPECS }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
```

Keep the current `import.meta.url` direct-invocation comparison and terminal wording exactly as implemented today.

- [ ] **Step 6: Run focused, type, package, and packed-consumer checks**

Run: `rtk pnpm exec vitest run packages/cli/src/cli-runtime.test.ts packages/cli/src/index.test.ts packages/cli/src/export.test.ts packages/cli/src/server.test.ts packages/cli/src/render-driver.test.ts packages/cli/src/bundle-publisher.test.ts`

Expected: PASS.

Run: `rtk pnpm --filter @screenshot-studio/cli typecheck`

Expected: exit 0.

Run: `rtk pnpm run test:cli`

Expected: PASS.

Run: `rtk pnpm test:e2e:package`

Expected: PASS; this exact release-surface leaf is justified because the executable entrypoint changed.

- [ ] **Step 7: Commit**

```bash
rtk git add packages/cli/src/index.ts packages/cli/src/cli-runtime.ts packages/cli/src/cli-runtime.test.ts packages/cli/src/export-command.ts packages/cli/src/dev-command.ts packages/cli/src/command-dispatch.ts packages/cli/src/index.test.ts
rtk git commit -m "refactor: split cli orchestration"
```

### Task 7: Integrated verification, review, and stacked draft PR

**Files:**
- Modify only files required by verified review findings.
- Review range: `codex/moderate-project-cleanup..codex/deep-structure-cleanup` resolved to exact merge-base and head SHAs.

**Interfaces:**
- Consumes: all six independently green task commits.
- Produces: a clean, reviewed branch and a draft PR targeting `codex/moderate-project-cleanup` until PR #5 merges.

- [ ] **Step 1: Run final unit/package gates**

```bash
rtk pnpm run test:core
rtk pnpm run test:cli
rtk pnpm run test:web
rtk pnpm run typecheck
rtk pnpm run lint
```

Expected: all commands exit 0.

- [ ] **Step 2: Run repository policy checks**

```bash
rtk pnpm run check:community
rtk pnpm run check:spdx
rtk git diff --check codex/moderate-project-cleanup...HEAD
```

Expected: all commands exit 0 and no whitespace errors.

- [ ] **Step 3: Confirm the exact targeted browser/package checks from Tasks 2, 3, 4, and 6 are green**

Do not substitute the full local `pnpm test:e2e` aggregate. Rerun only a failing exact file after diagnosing it.

- [ ] **Step 4: Request task reviews and whole-branch review**

Review for public-surface drift, cyclic dependencies, stale closure/event-order regressions, changed error strings, and accidental behavior changes. Fix only evidence-backed findings and rerun their smallest exact checks.

- [ ] **Step 5: Verify branch topology and push**

```bash
rtk git status --short --branch
rtk git merge-base codex/moderate-project-cleanup HEAD
rtk git log --oneline codex/moderate-project-cleanup..HEAD
rtk git push -u origin codex/deep-structure-cleanup
```

Expected: clean worktree, intended stacked commits only, successful push.

- [ ] **Step 6: Create the stacked draft PR**

Create a draft PR titled `refactor: split large project modules`, with base `codex/moderate-project-cleanup`, listing exact checks and explaining that it must be retargeted to `dev` after PR #5 merges.
