# Editor UI & UX

This document defines durable UI/UX semantics for Screenshot Studio. It describes how the interface
communicates, behaves, and stays accessible while concrete screens, navigation, and feature placement
evolve. Data, rendering, persistence, and security mechanics belong in
[`docs/architecture.md`](architecture.md).

## 1. Product interaction principles

- The interface makes a screenshot project understandable and editable without requiring an agent.
- One visible action has one meaning. Project import, raw capture import, archive export, rendered
  store-image export, Close project, Remove from recents, and permanent deletion must never be
  presented as interchangeable operations.
- UI state is honest. A control does not claim a save, import, export, or deletion completed until
  the corresponding durable operation has succeeded.
- The current navigation shape may change. Preserve the underlying semantics: select a project,
  understand its state, edit its visual content, and leave or transfer it safely.
- Content belongs to the strict Project document; transient chrome belongs to project-keyed workspace
  state. Selection, zoom, viewport, open panels, and temporary dialogs never become exported pixels
  or persisted project content.

## 2. Shared UI language

The editor uses local primitives from `apps/web/components/editor-ui/`, not an external component
library. Reuse them before introducing one-off controls:

| Primitive | Responsibility |
|---|---|
| `editorUi` | Shared button, field, status, card, panel, tool-button, disabled, focus, and motion classes |
| `DialogShell` | Modal structure, labelled title, focus handling, Escape/close behavior, and action area |
| `MenuSelect` and `AddMenu` | Keyboard-accessible choice and command lists |
| `ToolButton` | Compact tool/action control with active and inactive states |
| `InsetPanel`, `EmptyResourceState`, `StatusMessage` | Grouped controls, empty states, progress, warning, and error feedback |
| `EditorSidePanel`, inspector sections, toolbar overflow | Responsive composition of persistent workspace regions |

`apps/web/components/editor-ui/tokens.css` is the token source for editor color roles, spacing,
radii, control typography, shadows, focus treatment, and motion. Prefer semantic token names such as
surface, text, accent, warning, danger, and focus over literal colors or ad-hoc spacing. Reuse
`editorUi` styles so controls share disabled treatment, focus rings, and transition timing.

## 3. Interaction semantics

The editor has five durable interaction roles even if their placement changes:

- **Navigation and context** choose the active project, layout, locale, and current editing scope.
- **Canvas and viewport** show an exact screen crop or broader composition context. Fit, zoom, pan,
  and canvas patterns affect only the workspace view, never the export.
- **Structure and resources** expose ordered screens/layers and reusable local fonts, themes,
  templates, and assets. Their controls act on the explicit current scope.
- **Authoring and inspection** add or edit strict project literals. The inspector exposes only fields
  valid for the selected object; no selection exposes the current artboard context.
- **Feedback and recovery** show save, validation, import, export, missing-resource, and destructive
  outcomes in place, with a clear next action.

Selection is explicit and owner-aware. One editing target is active for insertion and contextual
controls; multi-selection supports only operations that remain meaningful for every selected object.
Locked content stays inspectable but cannot be changed through direct manipulation. Text editing has a
clear commit/cancel path, and keyboard interaction must match visible controls.

Layouts, output families, locales, and connected composition may change how content is projected, but
the interface must preserve scope: an action explains which layout, locale, output, screen, or element
it affects and must not silently mutate a sibling scope.

## 4. Responsive and accessible behavior

The workbench prioritizes the canvas while keeping controls reachable. At narrow widths, secondary
regions may collapse, overlay, or move into overflow; they must remain keyboard-reachable and retain
their labels. Important canvas controls occupy the remaining viewport rather than disappearing behind
a panel.

All interactive controls have accessible names, visible focus, disabled semantics, and keyboard use.
Menus support predictable focus movement and dismissal. Dialogs move focus to their heading, trap
focus while open, return focus to a live trigger, and allow Escape only when cancellation is safe.
Errors use alert semantics and identify a recoverable action; progress is announced without pretending
that a durable operation is complete.

Motion is short, calm, and functional. It clarifies a change of state rather than acting as decoration,
and reduced-motion preferences remove nonessential animation.

## 5. State and destructive-action rules

Loading, empty, unavailable, validation-error, save-error, and missing-asset states leave the user
oriented and preserve safe work whenever possible. A failed save keeps the editable value visible and
identifies that it is not yet durable. A missing asset produces a visible placeholder instead of a
crash. An invalid project prevents unsafe editing rather than being silently repaired.

Destructive or irreversible actions state their scope and consequence before work begins. They require
an explicit confirmation that cannot be mistaken for an ordinary close or navigation action. Cancellation
and failure preserve the prior active project and workspace state whenever the operation has not been
durably committed.

Local and managed sources have different capabilities. The UI may reveal a local path only when that
source safely provides one; it never exposes managed server paths, source locators, credentials, or
internal recovery data. A browser file selection is an import input, not permanent authority to edit
an arbitrary local filesystem path.

## 6. UX boundaries

- Do not add UI-only fields, prompt history, translation databases, or server metadata to the Project
  document.
- Do not offer generic remote asset fetching, system-font fallback, hidden filesystem mutation, or a
  second rendering/export path.
- Do not turn templates, themes, or starter content into hidden runtime state; persisted results remain
  ordinary strict Project literals.
- Do not make UI automation, provider-backed translation, cloud collaboration, or telemetry implicit
  product behavior.
- New UI patterns should compose the shared primitives and tokens, preserve responsive/accessibility
  behavior, and make their durable scope explicit.
