# Unified Project Overview Design

## Status

Approved product direction. This design is stacked on `codex/deep-structure-cleanup` and keeps the
connected render/export contract unchanged while unifying the editor's Overview presentation.

## Problem

Overview currently means two different things:

- `isolated` shows the active locale's output families as vertical rows such as iPhone and iPad;
- `connected` shows only the active exact `platform/device/locale/storeTargetId` group.

The connected behavior is internally consistent with its editing scope, but it hides the rest of
the project's outputs and makes the same Overview control change its information architecture when
the project mode changes.

## Goal

Overview always presents the project as vertically ordered output-family rows for the active
locale. In connected mode, every row is a separate gapless connected strip. Only the active row is
editable; other rows are read-only previews that can be activated.

The common visual hierarchy remains:

1. output-family label;
2. per-screen title;
3. artwork;
4. per-screen device/locale/target metadata.

## Non-goals

- No schema, project JSON, render, export, CLI, or persistence change.
- No new Overview/Group Edit toggle and no persisted workspace preference.
- No simultaneous editing or cross-row selection.
- No cross-platform connected coordinate space; every output row remains an independent exact
  connected group.
- No change to Focus: it remains one exact, non-interactive screen crop.
- No redesign of the Structure, Layers, Inspector, or Store Targets surfaces beyond keeping them
  synchronized with the activated row.

## Scope model

The current `workspaceScreenScope` combines presentation and editing responsibilities. Replace that
single ambiguous derivation with two explicit concepts:

### Editing scope

`workspaceEditingScope(project, activeScreen)` preserves today's behavioral contract:

- connected mode returns the active screen's exact
  `platform/device/locale/storeTargetId` group;
- isolated mode returns the current locale/root or exact target-variant layer as it does today.

Screens, Layers, selection, reorder, snapping, authoring, connected transforms, and Focus use only
this editing scope.

### Overview rows

`workspaceOverviewRows(project, activeScreen)` returns ordered rows for the active locale:

- every root `platform/device` output family appears once in project order;
- the active output family uses the active screen's exact store-target group, including an explicit
  target variant when one is selected;
- non-active output families use their root screens (`storeTargetId` absent), because target ids are
  output-specific and cannot be assumed to exist across platforms or devices;
- if a project contains only explicit variants for a family, its first project-ordered exact group
  is used rather than hiding the family;
- each row contains screens from exactly one connected group and therefore remains a valid gapless
  strip.

This keeps the full project visible without inventing cross-family target equivalence. Row labels
include the target name/id when the row is showing an explicit target layer.

## UI behavior

Overview uses the same vertical output-row shell in both project modes.

In connected mode:

- the active row renders one interactive connected `EditorStage`;
- each non-active row renders the same connected projection with interaction disabled;
- a non-active row is keyboard- and pointer-activatable with an accessible
  `Edit <output label> connected row` name;
- activation selects the row's first project-ordered screen, reconciles selection through the
  existing store path, and updates Screens, Layers, Inspector, and the active-row treatment;
- row activation is transient navigation: it does not add history or save project JSON;
- the active row has a clear `Editing` treatment; non-active rows use the existing preview styling.

In isolated mode, existing per-screen editing and output-row behavior remain unchanged, but they
consume the same overview-row model and row shell where practical.

## Fit and layout

Fit measures the complete vertical Overview, not only the active connected group.

- Each connected row contributes one scalable strip width (the sum of its artboard widths) and one
  scalable height (the maximum artboard height in the exact group).
- Output-family headers, screen title/metadata chrome, outer padding, and vertical row gaps remain
  fixed CSS pixels.
- Fit chooses the largest supported zoom that still contains every row across both axes.
- Manual zoom and pan continue to operate on the shared canvas viewport.
- Compact layouts may scroll after manual zoom, but Fit must contain the full overview without
  clipping row headers or metadata.

## Components and responsibilities

- `editor-workspace.ts` owns pure editing-scope and overview-row derivations plus stable row labels.
- `useCanvasViewportMetrics` owns multi-row connected Fit inputs and calculations.
- `CanvasViewport` composes rows and delegates each connected row to a focused
  `ConnectedOutputRow` component.
- `ConnectedOutputRow` owns row presentation, active/read-only interaction state, accessible row
  activation, the connected stage, and the shared `ScreenPreviewTitle` / `ScreenPreviewMetadata`
  chrome.
- `ScreensSection` continues to use editing scope; it does not render every Overview row at once.

The connected-row component receives explicit inputs and callbacks. It must not read the Zustand
store directly, create persisted state, or duplicate renderer logic.

## Data flow

1. The active screen determines the active locale, output family, and exact editing group.
2. Pure overview derivation produces ordered output rows for that locale.
3. CanvasViewport renders every row; only the active row receives `interactive=true`.
4. Activating a preview row calls the existing screen-selection action for that row's first screen.
5. Store selection reconciliation updates the exact editing scope and editor panels without history
   or durable save.
6. EditorStage and the shared renderer continue to derive every connected projection from ordinary
   project JSON.

## Error and edge handling

- An empty locale produces the existing empty workspace rather than a partial row.
- A malformed row cannot be synthesized: only screens already accepted by the strict project
  schema participate.
- Mixed artboard widths remain valid because connected origins already use cumulative widths.
- Explicit target variants never merge with roots or another target id.
- When an active screen disappears after a guarded mutation, existing selection reconciliation
  chooses a valid screen before overview rows are derived.
- A read-only row cannot receive element, marquee, transform, or keyboard-authoring events.

## Testing

### Unit/model

- Editing scope remains exact in connected mode.
- Overview rows contain all root output families for the active locale in stable project order.
- The active family substitutes its exact explicit-target group without affecting other rows.
- Variant-only fallback does not hide an output family.
- Rows never mix platform, device, locale, or store-target identities.
- Multi-row Fit accounts for scalable strip bounds and fixed row chrome.

### Exact browser coverage

Extend the smallest connected workspace/browser file to verify:

- iPhone and iPad connected rows are visible vertically in Overview;
- only the active row is interactive and marked Editing;
- activating iPad updates Screens/Layers/Inspector and makes iPad the editable row;
- Focus remains the exact selected-screen crop;
- Fit contains all row headers, stages, titles, and metadata;
- keyboard row activation works on the compact viewport;
- render/export pixels and project JSON do not change merely from row navigation.

Retain the targeted isolated Overview scenario to prove the shared row hierarchy did not regress.
Run web typecheck, focused workspace/model tests, exact connected and isolated browser files, and
`git diff --check`. Do not run the full local E2E suite.

## Documentation

Update `docs/architecture.md` so it no longer states that one exact connected scope feeds Overview,
Fit, and Screens. The revised contract must distinguish project-wide locale Overview rows from the
exact connected editing scope while reiterating that render/export grouping remains unchanged.

## Delivery

Implement as one focused UI/workspace slice on the existing deep-cleanup branch, with separate
commits for the pure scope/Fit model and the rendered row interaction if that separation keeps each
commit independently verifiable.
