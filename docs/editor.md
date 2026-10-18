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
| `OutputIdentityHeader` | Shared output-family, exact-size, editing-state, and master/variant semantics in overview UI |
| `MenuSelect` and `AddMenu` | Keyboard-accessible choice and command lists |
| `ToolButton` | Compact tool/action control with active and inactive states |
| `InsetPanel`, `EmptyResourceState`, `StatusMessage` | Grouped controls, empty states, progress, warning, and error feedback |
| `EditorSidePanel`, inspector sections, toolbar overflow | Responsive composition of persistent workspace regions |

`apps/web/components/editor-ui/tokens.css` is the token source for editor color roles, spacing,
radii, control typography, shadows, focus treatment, and motion. Prefer semantic token names such as
surface, text, accent, warning, danger, and focus over literal colors or ad-hoc spacing. Reuse
`editorUi` styles so controls share disabled treatment, focus rings, and transition timing.
Shared dialogs animate their backdrop and panel on entry and retain the panel through exit; reduced
motion removes both transitions. Async resource pickers reserve their body geometry while loading so
replacing progress with results does not move or resize the dialog.

UI copy calls App Store, Google Play, Microsoft Store, and Web **destinations**. A destination plus a
device family is an **output family**. UI surfaces take both labels from the shared core output
catalog; they do not expose persisted `platform` or `device` IDs as user-facing copy or maintain
parallel label maps. An **export size** is one exact pixel target inside that family. A **frame
preset** is only an artboard element's visual style: selecting one must not relabel the destination,
move the screen to another family, or change its export size.

## 3. Interaction semantics

The editor has five durable interaction roles even if their placement changes:

- **Navigation and context** choose the active project, layout, locale, and current editing scope.
- **Canvas and viewport** show an exact screen crop or broader composition context. Fit, zoom, pan,
  and canvas patterns affect only the workspace view, never the export.
- **Structure and resources** expose ordered screens/layers and reusable local fonts, themes,
  templates, and assets. Their controls act on the explicit current scope.
- **Authoring and inspection** add or edit strict project literals. The Inspector has **Layer** and
  **Screen** tabs: Layer exposes only fields valid for the selected object, and Screen exposes the
  artboard, output, structure, and background context of the screen the Inspector header names.
  Selecting a layer opens Layer and clearing the selection opens Screen; a tab the user picks holds
  until the selection changes. With nothing selected the Layer tab is dimmed but still reachable. A
  mixed multi-selection lists its layer types in the header; picking a type narrows the selection
  to those layers.
- **Feedback and recovery** show save, validation, import, export, missing-resource, and destructive
  outcomes in place, with a clear next action.

The Workspace Export dialog keeps rendered store images separate from the portable editable-project
archive. Project archive export flushes pending saves first and is available only when the active
managed project advertises archive-export capability.

**Store images** lists the active layout's exact sizes, each with its destination, its pixel target
from `store-specs.json`, and its file count, and the layout's locales, all checked by default so the
dialog's count matches the toolbar's. Checkboxes narrow the export to the checked sizes and locales;
the request names them and the export route filters the same `buildBundleEntries` list, so the path
preview shows real ZIP-relative paths (the first file of each checked size and locale) and the
download holds exactly the previewed set. The dialog reads the Issues list: a blocker on a checked
file, or a screen missing in a checked locale and size, disables Export until it is fixed in Issues
or its size or locale is unchecked; warnings on checked files are shown and do not block. Web Share
packages the same images and shows the count without the store-bundle paths.

Export feedback reports the actual completed-output count while rendering (`Rendering N of M`, with
the file being rendered), then honest indeterminate `Packaging` and download-preparation phases. The
final POST response remains the authority for success or failure; unavailable progress status must
not cancel an otherwise valid export. A file that fails to render does not fail the bundle: the
result names how many files were exported and lists each failed file with its reason and **Go to**
its screen. **Stop** packages the files already rendered into the download; a stop before the first
file reports `Stopped: 0 of N files exported` and downloads nothing. While an export runs,
Esc, the backdrop, and Close do not dismiss the dialog. The CLI keeps failing the whole export on the
first file that cannot render.

The Layers panel presents one **Screens → Layers** tree for the current exact-size scope. The active screen
expands to its layers, front-most first; layer reorder applies only to the active screen, and every
layer row has a direct lock toggle. Layer rows are one line. A text layer is labelled by its text
(about 30 characters, cut with `…`) unless it has been renamed, in which case the name wins; the
full text is then the row's tooltip and accessible description. Built-in templates leave text
layers unnamed, and Issues and the Inspector use the same label.
The Screens header names the scope as `Screens · count · locale · iPhone 6.9"` in Focus and ends
with the number of sizes in Overview. A screen row shows its thumbnail, name, and
`N layers` (Focus, with `· N selected` for a multi-selection) or `N sizes` (Overview). A screen
whose slot has an issue on any size turns amber and shows the first issue, such as
`6.3": text overflows`, instead of that count. Thumbnails keep their order number because export
file names use it. Layer rows show a type icon (rectangle and ellipse shapes differ), the name, and the lock; a
locked layer is muted and keeps a dark, closed lock. One selected layer gets the solid accent fill, several get a light fill.
Each row's drag handle and Delete or More actions appear on hover and whenever focus is inside
the row, so the handle stays the keyboard path for reorder. Without hover (touch), hidden controls
ignore taps; they become available on the selected layer or active screen row.

Selection is explicit and owner-aware. One editing target is active for insertion and contextual
controls; multi-selection supports only operations that remain meaningful for every selected object
and states which single-layer fields it hides. Its shared actions align and distribute top-level
layers against the rotation-aware selection bounds and set one opacity for the selection; each is a
single undo step, and locked layers keep their position and opacity.
Locked content stays inspectable but cannot be changed through direct manipulation. Text editing has a
clear commit/cancel path, and keyboard interaction must match visible controls.
A plain click on blank canvas clears the element selection; a modified blank click preserves the
selection so additive selection gestures remain predictable.

Adding text is an authoring action and must never open resource management as a prerequisite. Empty
projects use the renderer-owned built-in font, while the Inspector offers built-in and project fonts
through the same semantic font field. Uploading or downloading custom fonts remains an explicit,
separate Fonts action in the tool rail.

Blank project starters, blank screens, and the first screen in a newly added layout use a white solid
background. Explicit duplication preserves the source screen exactly. Linear-gradient backgrounds
offer eight semantic direction presets backed by the persisted angle, while the numeric angle remains
available for precise custom direction; both editor preview and export use that same project value.

The Inspector offers an optional bounded blur for Screenshot and Image elements. Device Frame exposes
the same effect as `Content blur`, which softens only its screenshot and keeps the bezel sharp. A zero
value removes the optional field, and editor preview and export share the same rendering behavior.
New Screenshot and Image elements preserve the decoded asset aspect ratio at insertion. Their shared
Content mode control presents `Fill` for cover-and-crop and `Fit` for uncropped containment.

Text boxes expose independent horizontal (`left`, `center`, `right`) and vertical (`top`, `middle`,
`bottom`) alignment. A theme role is a semantic marker for the next explicit theme application; role
assignment alone does not silently change the current literal color or font, and the Inspector must
say so next to the control.

Layouts, output families, locales, and connected composition may change how content is projected, but
the interface must preserve scope: an action explains which layout, locale, output, screen, or element
it affects and must not silently mutate a sibling scope.
The Layers panel keeps the same `Add screen` action available in every exact-size editing scope. Moving
between primary and variant sizes uses the output targets themselves instead of a second navigation
control in the Screens header. New projects and newly created output families explicitly default to
**Keep 1:1**. Existing documents without a persisted policy retain **Independent** behavior for
backward compatibility: adding, deleting, or reordering in an exact size changes only that size. A
new exact-size screen pairs with the next compatible unoccupied primary slot when one exists; after
those slots are occupied it remains a
standalone exact-size screen and never creates a hidden primary screen. Removing a primary screen
preserves paired exact-size composition by detaching it into an ordinary standalone screen.
**Keep 1:1** is an explicit persisted policy: add, delete, and order mirror across primary and every
created exact size while each screen's layers and copy stay independently editable. Enabling it
reconciles unequal rows to the longest row and makes the resulting slot mapping visible before later
mutations follow it.
The Inspector lists exact-size targets at the active destination/device/locale family scope, so a target
does not disappear when another compatible primary screen is selected. Selection styling identifies
the current family and exact size without a redundant `Current` action. Removing a size or slot uses
the same labelled app-owned confirmation pattern and follows the visible Independent/Keep 1:1 scope.
Removing a size removes that complete exact-size row; deleting an individual screen changes only the
slot scope described above.

**Issues** lists pre-export problems in the active layout. It reads the core validation engine
(`@screenshot-studio/core/validation`), the single source the Export dialog is meant to share; issues
are derived on demand and never persisted. Blockers come first, and every row names its screen and
size and offers **Go to** and a fix:

- *Text overflows its layer box* (warning) is measured with the shared renderer's text layout: lines
  the fixed-height box drops, or a single line taller than the box. It is reported only once every
  project font has loaded, so fallback metrics never raise it. **Fit text** sets the largest whole
  font size that fits, on that screen only, as one undo step.
- *Screen missing in a locale* (blocker) compares each locale with the layout's first locale. Locale
  screens have no persisted link and may be named per locale, so a locale lacks screens only where
  one of its size rows is shorter than the first locale's row. Names then pick which screens are
  missing, because locale copies keep them; when names differ, the trailing screens are reported. A
  Keep 1:1 family is compared by slot, and **Create from {first locale}** copies the slot into every
  size that family has; an Independent family copies only that screen. The copy keeps the source
  name and takes the target locale's text direction. A size row that exists in one locale's Keep
  1:1 family but not another's is a sizes difference, not a missing screen.
- *Image missing from the project folder* (blocker) is the editor's missing-asset placeholder: a
  background, or a visible screenshot, image, or device-frame layer, whose project image did not
  load. It is reported per screen and layer once the image cache has loaded, and the row names the
  project path. **Replace** goes to the screen and opens the existing picker for that background or
  layer. Project Home's missing-asset readiness reads the same check across every layout.

Export folders apply only to the CLI (`--out`, or `export/` next to the project); UI export renders
into a private staging folder and hands the bundle to the browser as a download, so Issues has no
export-folder row.

**Status by size** in the Layer tab lists, for the selected text layer, every exact size of its
screen slot (the primary screen and its variants) with whether the layer fits there. It reads the
same Issues, so fit is never measured twice, and shows *checking* until project fonts have loaded.
Layers keep no persisted link across sizes, so a size whose layer structure differs from the
selected screen's shows *no matching layer* rather than guessing; a hidden counterpart shows
*hidden*. **Fit** on a size sets the largest whole font size that fits that size's layer only, as
one undo step.

**Apply to** in the Inspector footer chooses which exact-size screens the next edit writes to:
**Only {size}** (the default), **All {destination}** (every size of the screen's slot), or **All
destinations** (that slot in every destination of the layout). The text Size field repeats the same
picker. One edit writes literal values into each screen in scope as a single undo step; it is never
a per-size override inside a screen, and screens of other locales are never touched. Layer edits
reach the matching layer on each size by the same structural match as Status by size and skip
unmatched or locked layers. Pixel metrics (position, size, font size, spacing, shadow, radius) are
written through the same fit used when a size is created, so they scale with each artboard; every
other field is copied. Each counterpart takes the edited layer's fitted value for every changed
field, replacing it rather than applying a delta, so editing position on one size also replaces
manual placement on the others in scope. A size that cannot take the fitted value within its limits
is skipped. In the Screen tab the scope applies to Background. Destinations keep no persisted slot
link, so **All destinations** pairs a destination only when its primary screen at the same position
has the same name, and skips it otherwise. The footer counts only the screens the next edit will
write and names how many sizes and destinations it skips. The scope is editor state only: it holds
while the same layer (or, with nothing selected, the same screen) stays selected and resets to
**Only {size}** on any other selection or reload; multi-selection keeps editing the selected screen
only.

**Stored on this screen** at the top of the Screen tab shows, read-only, the locale and its text
direction, destination, exact store size with its export pixels, and layout that the screen
persists. Another locale or size is another screen, so none of these change in place.

### Canvas

Canvas overlays are editor-only: they are drawn over the stage and never reach the renderer or
export. The canvas footer holds zoom, Fit, and the canvas pattern menu; **Add** at the canvas's top
left opens the Add panel, the same entry as the Layers add button.

On the editable artboard a selection shows a **W × H** badge below its rotation-aware bounds, in
artboard px: the layer box for one layer, the selection bounds for several. A single unlocked text
layer also gets a selection toolbar above it with **Font**, **Color**, and **Fit**, the same edits
the Layer tab makes; Fit is the Fit text fix and is enabled only while the layer overflows. Badge and
toolbar step aside while a layer is dragged, transformed, or edited inline, so the pink snap guides
stay readable. With a selection, focus outside a control, and no menu open, arrows nudge it 10 px
and Shift+arrows 50 px, one undo step per press; locked layers stay put. ⌘D duplicates, ⌘G groups,
and Delete removes the selection.

A text layer that Issues reports as overflowing gets an amber state on every artboard that shows it:
an amber frame on the layer box, which stays the box the layer is moved and resized by, and a dashed
amber outline over the height the text would take without the box limit. The canvas reads the same
Issues, so it never measures fit a second time and stays empty until project fonts have loaded. On
the editable artboard a **Fit text** hint at the box's bottom-left corner applies the same fix as
Issues, on that screen only, as one undo step; it is disabled when even 1 px does not fit. For the
selected text layer the selection toolbar's Fit takes its place. The state steps aside while a layer
is dragged, transformed, or edited inline.

### Projects and Workspace navigation

`/` is the source-neutral Projects surface. When no managed or recent local projects exist, it shows
the App Home first-run hero: a product headline with local-first and strict-validation assurances
beside exactly two action cards, `New project` and `Import`. Once projects exist, the same
route shows a preview-led gallery. A project card opens its source-safe active session directly in
Workspace. Its overflow menu keeps managed archive and permanent deletion behind the existing
archive-first confirmation flow; local cards can only remove recent-history entries. Slow opens show
a delayed, card-bounded `Opening workspace…` status without shifting card content.
An unavailable local source remains visible because it may live on temporarily disconnected storage,
but its card exposes a directly labelled destructive history icon beside the left-aligned recovery
message and states that project files stay untouched.

New project, project folder/archive import, Capture folder import, and gallery reopen all activate the
exact receiver before navigating to its canonical `/editor/[entryId]` Workspace URL. Opening that
URL in another browser activates the same Project Library entry before Workspace loads; invalid or
unavailable identities show a visible error and never fall back to another active project. `/editor`
remains a compatibility route for sessions whose Project Library entry identity is not available.
Capture folder is a choice inside `Import`, not a third top-level first-run action. The editor tool
rail exists only in Workspace. It holds the Select and Hand tools, the Layers panel toggle, and one
entry per resource (Screen templates, Design packs, Fonts, Locales), each opening its existing
dialog rather than an intermediate panel. Every item carries a short caption under its icon
(Select, Hand, Layers, Templates, Packs, Fonts, Locales, Projects) that its accessible name contains,
and active items get the light accent fill. Its bottom
`Projects` home action drains pending saves, preserves project-keyed workspace state, and returns to
`/`; save failure blocks that navigation and leaves the current Workspace mounted. If the project
source was moved or deleted, an app-owned confirmation may offer an explicit `Close without saving`
recovery action; Workspace must never discard the active client state automatically.
The Workspace top bar starts with a `Screenshot Studio / project / layout` breadcrumb whose product-name
button is the same Projects home action; Focus / Overview stay centered; undo, redo, the locale menu,
Issues with its count, Inspect, and Export sit on the right; Issues moves into the toolbar overflow
menu with Inspect at narrow widths. Export shows how many files a store-bundle export with the
dialog's default filters writes, computed by the same bundle builder the export route uses, and
shows no number when that bundle cannot be built.
Project folder and archive import discard Finder's `.DS_Store` metadata and skip, without copying,
paths outside the portable project layout, such as `export/` output or extra root files. Hidden,
credential-bearing, or private-key paths still reject the whole import, and resources the project
document references must be present.

## 4. Responsive and accessible behavior

The workbench prioritizes the canvas while keeping controls reachable. At narrow widths, secondary
regions may collapse, overlay, or move into overflow; they must remain keyboard-reachable and retain
their labels. Important canvas controls occupy the remaining viewport rather than disappearing behind
a panel.

All interactive controls have accessible names, visible focus, disabled semantics, and keyboard use.
Menus support predictable focus movement and dismissal. Dialogs use `DialogShell`'s configured initial
focus: the heading when context must be announced, otherwise the first actionable control. They trap
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
- Templates expose a global read-only **Built-in templates** tab beside project-local templates.
  Choosing either source creates an ordinary editable screen in the current project.
- **Create a managed project** filters its starting points to the selected destination: iPhone and iPad
  portrait; Android phone, Android tablet portrait, and Play Feature Graphic; or Web desktop and Web
  mobile. **Blank** remains explicit, and the existing generic project starters remain available
  where supported. Targeted starters open on their exact persisted variant.
- The Design packs dialog exposes global read-only **Design packs** beside project-local themes. Applying either
  source is explicit and bakes editable color, typography, and supported spacing literals into the
  active layout; the project never stores a global pack reference.
- An empty project presents **Create your first screen** with relevant family starters, capture
  import, and blank-screen paths instead of relying on an unexplained empty canvas.
- **Add device mockup** creates a presentation frame with a visible empty drop target. **Place
  screenshot in mockup** is a separate action; an assigned local screenshot can be replaced or
  removed later. The inspector exposes project-image Choose, Replace, and Remove actions rather
  than making users edit the persisted project-relative `assetUrl`. Frames do not change the screen
  destination, family, or output target. Preset names and thumbnails describe brand-neutral bundled
  geometry, not official device artwork; official Apple frame artwork is not bundled.
- Project-image pickers combine reusable images already owned by the project with an explicit system
  file-picker import. A successful import copies the validated image into project-local `assets/`
  storage and immediately applies that resource to the current action; users never enter an asset URL
  or filesystem path by hand.
- Do not make UI automation, provider-backed translation, cloud collaboration, or telemetry implicit
  product behavior.
- New UI patterns should compose the shared primitives and tokens, preserve responsive/accessibility
  behavior, and make their durable scope explicit.
