# Focus and Overview Canvas Transition

## Goal

Remove the visible canvas jump when switching between Focus and Overview, and replace it with a short camera-style transition that makes the spatial relationship between the active artboard and the full workspace clear.

## Root cause

`CanvasViewport` changes its rendered screen set immediately when `view` changes, but recalculates the fitted zoom and resets scroll position from a later `requestAnimationFrame`. The destination layout therefore paints once using the source view's zoom and scroll before snapping to its fitted state.

## Design

The destination view must be measured and fitted before it becomes visibly settled. `CanvasViewport` will preserve the source canvas's visual bounds, apply the destination view's final zoom and scroll state, and animate the visible canvas wrapper from the captured source bounds to the final bounds over approximately 220 ms.

The transition is presentation-only. It must not modify project JSON, element coordinates, screen ownership, selection, history, or shared renderer behavior. Focus remains the active screen's exact crop, and Overview retains its existing output-family layout and selection behavior.

Rapid repeated view changes must cancel the active transition and start from the currently displayed state. Controls remain usable, but only the latest requested view may complete. The implementation must not leave stale timers, animation frames, or inline transition state after completion or unmount.

When `prefers-reduced-motion: reduce` is active, the destination view will appear directly in its final fitted state without interpolation.

## Implementation boundaries

- Keep transition coordination inside the web editor canvas surface.
- Reuse the existing fit calculations in `editor-workspace.ts`; do not create a second geometry or render path.
- Do not change the strict project schema, persisted editor state, core rendering, export behavior, or CLI.
- Avoid per-artboard animations; one camera-style canvas transition keeps cost bounded as project size grows.

## Acceptance criteria

1. Focus to Overview and Overview to Focus never expose the destination layout at the source view's stale zoom.
2. Both directions use a smooth camera-style transition of roughly 220 ms.
3. The active artboard remains the spatial anchor when practical, and the destination ends at the same fitted zoom and scroll position as the existing Fit behavior.
4. Rapid alternating clicks settle on the latest selected view without visual or state corruption.
5. Reduced-motion users receive an immediate, correctly fitted switch.
6. Existing screen selection, pan, zoom, connected-mode, and output-family behavior remain unchanged.

## Verification

- Add a targeted regression test at the smallest practical seam proving the destination fit is established before the transition is exposed and that reduced motion bypasses interpolation.
- Run the exact affected Vitest file(s) and the web package typecheck.
- Run one focused browser scenario at the reported 651 x 998 viewport: Focus to Overview to Focus, plus a rapid repeat and reduced-motion check.
- Do not run the full local Playwright suite.

## Notion tracking

Create one implementation task containing this goal, root cause, acceptance criteria, branch/worktree, and final verification evidence. Link the task in the completion handoff when Notion tooling is available.
