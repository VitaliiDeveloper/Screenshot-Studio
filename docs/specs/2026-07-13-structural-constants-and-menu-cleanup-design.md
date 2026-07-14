# Structural Constants and Menu Cleanup Design

## Goal

Remove brittle magic layout calculations, stale extracted APIs, duplicated contract literals, and ambiguous output-family naming without changing the project schema, render/export behavior, or editor information architecture.

## Scope

The cleanup has two checkpoints.

### 1. Contracts, names, and dead code

- Remove unused `CanvasSurface` dimensions, unused anchored-scroll inset fields, the unused marquee `baseX` argument, and the production-dead `fitZoom` helper.
- Type Layers element labels against the enforced `Element` union so stale labels such as the non-existent `badge` element type fail at compile time.
- Make the CLI project filename a single exported constant and route export path resolution through the existing `resolveProjectPath` helper.
- Export the font-weight minimum, maximum, step, default, and shared Zod schema from core; consume them from core themes, CLI validation, and the web font form.
- Name local interaction constants for minimum element size, marquee drag threshold, and wheel zoom sensitivity.
- Rename the output-family data model and component so `active`, `interactive`, and `editing` do not describe the same state with conflicting vocabulary.

### 2. Shared menu behavior

- Replace estimated menu heights and the Layers tail-row heuristic with placement based on the rendered menu rectangle and available viewport space.
- Extract one keyboard-navigation helper for `ArrowDown`, `ArrowUp`, `Home`, and `End`; callers provide the appropriate menu-item selector.
- Keep the existing menu markup, styling, focus restoration, click-outside behavior, and public component props. Do not add a UI dependency.

## Architecture

Pure behavior belongs in small colocated model helpers with unit tests. React components own refs and lifecycle effects, but delegate placement and next-focus calculation to those helpers. Cross-package domain constants remain in `packages/core`; CLI-only filename policy remains in `packages/cli`.

Menu placement uses the trigger and rendered menu rectangles after the menu mounts. It opens upward only when the space below is insufficient and the space above is greater. This preserves the existing decision rule while removing assumptions about option count, density, borders, and padding.

## Compatibility and exclusions

- No schema version or persisted JSON changes.
- No render/export path changes.
- No new package dependency.
- No global `no-magic-numbers` lint rule; binary formats, schema bounds, mathematical constants, and preset geometry remain literal where they are the clearest representation.
- Existing unrelated fixture and worktree-artifact changes are not staged or modified.

## Verification

- Unit tests cover measured menu placement, keyboard navigation, typed/shared constants, and changed pure helper signatures.
- Existing focused editor UI/model tests cover menu compatibility and viewport/editor-stage extraction seams.
- Run the web, CLI, and core targeted tests affected by the edits, followed by repository lint and typecheck. Browser E2E is limited to the exact editor interaction file only if unit/component coverage cannot prove the changed menu behavior.
