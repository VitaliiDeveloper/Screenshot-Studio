# Phase 6 Slice 3 — Connected editor stage

Status: complete. The connected Overview authoring stage, exact Focus crop, owner-aware selection,
and focused web/browser verification have passed.

## Goal

Author the v2 connected document directly in the editor without forking the element mapper, losing
screen ownership, or changing export pixels.

## Contract

- Isolated mode keeps the existing per-screen Focus/Overview behavior.
- Connected Overview shows one gapless, top-aligned stage for the active exact
  `platform/device/locale` group; unrelated groups are absent.
- Every element still renders through `elementToNodeConfig` inside an owner-offset Group. Drag and
  transform results therefore remain owner-local even when the node crosses screen boundaries.
- Selection is transient and composite (`screenId + elementId`), so duplicate ids on different
  owner screens are unambiguous. Selecting a connected element activates its owner for Layers and
  Inspector behavior.
- Connected text editing uses strip-space overlay placement but persists content to the owner.
- Connected Focus is non-interactive and uses the same group projection translated to the active
  artboard crop. It renders cross-screen pixels but no editor-only boundary chrome.
- Project JSON, static render/export ordering, and the Slice 1 crop contract remain unchanged.

## Implementation

- Extend the editor store with `selectedScreenId` and owner-explicit patch/remove selection paths.
- Generalize the existing `EditorStage` over isolated, connected Overview, and connected Focus
  projections; do not add a second React/Konva element mapper.
- Scope connected Overview and Fit to the active exact group, render screen labels/boundaries as
  ephemeral chrome, and keep unrelated locales/devices/platforms out.
- Make Inspector, Fonts, and Layers resolve the composite selection owner.
- Add store regression coverage and one dedicated connected editor E2E in the targeted editor group.

## Verification

1. `apps/web/lib/editor-store.test.ts`
2. `pnpm test:web`
3. Existing `e2e/editor.test.ts` and `e2e/editor-workspace.test.ts`
4. New `e2e/connected-editor.test.ts` covering exact group scope, cross-boundary owner selection,
   owner-local drag persistence, connected inline text, and Focus crop pixel/aspect.
5. `pnpm lint`
6. `pnpm typecheck`
7. `git diff --check`

No full browser gate is required at this slice checkpoint: the exact affected editor scenarios run,
while Slice 1 already closure-verified static render/export parity.
