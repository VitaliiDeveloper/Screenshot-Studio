# Output Family Screen Switcher Design

Date: 2026-07-12
Status: approved in conversation; pending written-spec review

> This is a scoped post-Phase 9 workflow refinement discovered through dogfood. It does not reopen
> Phase 9, change release readiness, or widen the project schema. The durable editor and roadmap
> contracts remain authoritative where they overlap this implementation-planning artifact.

## 1. Problem

The Structure panel currently renders every root screen for the active locale in one vertical
list, separated by output-family headings. Adding iPhone, iPad, Android phone, tvOS, watchOS,
macOS, and Windows outputs makes the list increasingly tall. The user must scroll past unrelated
families to reach the screens they want, while the Layers section is pushed farther down.

The canvas Overview already provides the all-family overview. The Structure panel should instead
act as a focused navigator for one output family at a time.

## 2. Chosen interaction

When an isolated root workspace contains more than one output family, replace the repeated inline
family headings and explanatory paragraph with a compact, horizontally scrollable tab strip.

Example:

```text
[ iPhone · 3 ] [ iPad · 3 ] [ Android · 3 ] [ tvOS · 3 ] →

Hero
Save Fast
Stay Organized
```

- Each tab represents one existing `platform/device` output family in project order.
- The active screen's family is the selected tab.
- Each tab shows the existing full store-output label and its root-screen count for the active
  locale; horizontal scrolling absorbs labels that do not fit the panel width.
- Only screens from the selected family render below the strip.
- Selecting a tab immediately selects that family's first screen in project order, clearing
  element selection through the existing `selectScreen` action.
- Overview continues to render all output families as vertical rows. The switcher changes only
  Structure navigation and the active screen; it does not filter or rearrange the canvas model.
- The existing compact `+` action remains responsible for duplicating/adding a screen from the
  active screen. Store-output creation remains in the Inspector and is not duplicated here.

Remembering a separate last-active screen per family is deliberately deferred. Selecting the first
screen is deterministic and requires no new persistent or ephemeral state.

## 3. Scope boundaries

The switcher appears only when all of the following are true:

1. The project is in `isolated` mode.
2. The active screen is a root screen rather than an exact-size variant.
3. The active locale has more than one `platform/device` family.

Connected mode already exposes one exact screen group and keeps its current list. An exact-size
variant workspace also remains family-local and keeps its existing master-return behavior. A locale
with one family does not render a redundant one-item tab strip.

This change does not modify schema v6, project ordering, output creation, variants, canvas layout,
render/export behavior, or the editor store's reorder contract.

## 4. Component and data flow

`ScreensSection` will reuse `groupScreensByOutput` from `editor-workspace.ts` rather than creating a
second grouping implementation.

1. Resolve the existing workspace screen scope.
2. Group scoped screens by `platform/device`, preserving project order.
3. Resolve the active group from the active screen.
4. Render accessible output selector buttons when the scope rules in section 3 allow them.
5. Pass only the active group's screen ids to `SortableContext` and render only those rows.
6. On tab activation, call `editorStore.getState().selectScreen(group.screens[0].id)`.

The existing `reorderScreens` action already rejects cross-family drops and reorders only screens
matching locale, platform, device, and `storeTargetId`. Filtering the sortable context to one family
makes that constraint visible in the UI and removes ambiguous cross-family drag targets.

The thumbnail sequence badge should reflect the screen's position inside the visible family rather
than its former position in the all-output list.

## 5. Accessibility and responsive behavior

- Use a labelled navigation region containing ordinary buttons with `aria-pressed`; do not claim
  ARIA tab semantics that would require a custom roving-focus implementation.
- Each button's visible and accessible label uses the full store-output label and screen count.
- Buttons remain natively focusable and support activation with Enter or Space.
- The strip uses horizontal overflow without wrapping, preserving the panel's vertical space.
- When a tab becomes active, scroll it into view without moving the main page or canvas.
- Preserve visible focus rings and a minimum practical pointer target consistent with shared editor
  primitives.
- Do not hide tabs behind an unlabelled carousel control or rely on drag gestures alone.

Native Tab navigation plus horizontal scrolling provides an understandable, accessible baseline
without a custom focus state.

## 6. Empty and failure states

Every output family is derived from at least one existing screen, so an empty active family is not a
valid rendered state. If active-screen lookup temporarily fails during project loading, retain the
existing locale fallback and choose the first available family and screen. No new user-facing error
surface is needed.

## 7. Verification

Use targeted tests only; this localized navigation change does not justify the full E2E gate.

- Retain the existing unit coverage for output grouping and project-order preservation.
- Extend the scoped editor workspace E2E flow to prove:
  - multiple families render as tabs;
  - only the active family's rows appear in Structure;
  - selecting iPad activates its first screen and updates Layers/Inspector context;
  - switching does not remove other families from Overview;
  - reorder remains within the active family.
- Run the web unit suite, package typecheck, ESLint on the touched files, and the exact targeted E2E
  scenario. Do not run the unsuffixed full browser aggregate by default.

## 8. Alternatives rejected

- **Collapsible family accordions:** preserve all families in the vertical document and therefore
  reduce, but do not remove, height and scrolling pressure.
- **Virtualized full list:** improves DOM cost but not navigation or information density; it adds
  complexity before performance evidence requires it.
- **Classic card carousel:** visually heavier, harder to scan in a narrow sidebar, and unnecessary
  because the switcher navigates categories rather than presenting media cards.
