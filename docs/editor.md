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
- **Structure and resources** expose ordered screens/layers and reusable local fonts, project packs,
  templates, and assets. Their controls act on the explicit current scope.
- **Authoring and inspection** add or edit strict project literals. The Inspector has **Layer** and
  **Screen** tabs: Layer exposes only fields valid for the selected object (a text layer leads with
  Text, then Transform), and Screen exposes the artboard, output, structure, and background context
  of the screen the Inspector header names.
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
Under the Screens row, **Find screen or layer ⌘K** searches the screens and top-level layers the panel
lists, matching a screen's name and a layer's name, text, or type. The field opens a combobox: ↑ and
↓ move the active result, Enter picks it through the ordinary screen and layer selection, and Esc
closes only the search, not the panel. Esc and a pick return focus to the field. ⌘K opens the Layers
panel first when it is closed.
The Screens header names the scope as `Screens · count · locale · iPhone Dynamic Island · Large` in Focus and ends
with the number of sizes in Overview. A screen row shows its thumbnail, name, and
`N layers` (Focus, with `· N selected` for a multi-selection) or `N sizes` (Overview). A screen
whose slot has an issue on any size turns amber and shows the first issue, such as
`Dynamic Island · Medium: text overflows`, instead of that count. Thumbnails keep their order number because export
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
projects use the renderer-owned built-in font, while the Inspector offers built-in fonts (Studio Sans,
and Studio Display at Regular, SemiBold, and ExtraBold) and project fonts through the same semantic
font field. Uploading, downloading, or importing custom fonts remains an
explicit, separate Fonts action in the tool rail.

**Import from system** in the Fonts dialog switches the dialog to a selective import view (its Back
button returns to the font list and restores focus to the entry button). A search field filters the
installed families, each showing coverage badges for Latin, Latin Ext-A, Cyrillic, and Greek.
Choosing a family previews Latin and Cyrillic sample text for every weight, drawn with a `FontFace`
built from the file's bytes under a private preview family, never `local()` and never the project
family name, and removed when the selection changes or the view closes. Each importable weight has a
checkbox; **Import** copies the ticked weights one at a time into the project as `uploaded` fonts
named from the file's metadata, through the same registration path as Upload, so duplicates of an
existing family and weight are disabled up front and reported by the server rather than overwritten.
Fonts from machine-wide folders show a license warning (for example SF Pro is licensed only for UI
mockups for Apple platforms); the user is responsible for checking it. Fonts with the "Restricted
License embedding" flag, collections (TTC, OTC, DFont), variable fonts, files over 20 MB, missing or
out-of-range weights (outside 100 to 900), and condensed or expanded faces that share a family and
weight with another face are listed as disabled with the reason (a condensed family with no sibling
at its weight stays usable); italic faces are skipped because a font identity has no style. Each row
shows the face's style name beside its weight. Copies of the same face (same PostScript name)
collapse to one; different faces that declare the same family and weight (for example Black and
Heavy at 900) are all listed and all disabled, naming each other, because a project font identity
cannot tell them apart and choosing one would be arbitrary. Add such a file with Upload and choose a
weight. The server scans only the standard font folders of the current OS (macOS:
`/System/Library/Fonts`, `/Library/Fonts`, `~/Library/Fonts`; Windows: `%WINDIR%\Fonts`,
`%LOCALAPPDATA%\Microsoft\Windows\Fonts`; Linux: `/usr/share/fonts`, `/usr/local/share/fonts`,
`~/.local/share/fonts`, `~/.fonts`), addresses files by opaque ids, and serves them only to loopback
requests; the browser never sends a path. The scan is cached and repeats when the top level of a
folder changes (a font installed through Font Book or a package manager); a font installed into a
nested subfolder may need a restart of the editor server to appear.

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
`bottom`) alignment. A **Theme role** is a semantic marker used the next time a design pack or
project pack is applied; assigning it alone does not silently change the current color or font, and
the Inspector must say so next to the control.

Layouts, output families, locales, and Panorama composition may change how content is projected, but
the interface must preserve scope: an action explains which layout, locale, output, screen, or element
it affects and must not silently mutate a sibling scope.
The Layers panel keeps the same `Add screen` action available in every exact-size editing scope. Moving
between master and variant sizes uses the output targets themselves instead of a second navigation
control in the Screens header. New projects and newly created output families explicitly default to
**Sync sizes**. Existing documents without a persisted policy retain **Separate** behavior for
backward compatibility: adding, deleting, or reordering in an exact size changes only that size. A
new exact-size screen pairs with the next compatible unoccupied master slot when one exists; after
those slots are occupied it remains a
standalone exact-size screen and never creates a hidden master screen. Removing a master screen
preserves paired exact-size composition by detaching it into an ordinary standalone screen.
**Sync sizes** is an explicit persisted policy: add, delete, and order mirror across master and every
created exact size while each screen's layers and copy stay independently editable. Enabling it
reconciles unequal rows to the longest row and makes the resulting slot mapping visible before later
mutations follow it.
The Inspector lists exact-size targets at the active destination/device/locale family scope, so a target
does not disappear when another compatible master screen is selected. Selection styling identifies
the current family and exact size without a redundant `Current` action. Removing a size or slot uses
the same labelled app-owned confirmation pattern and follows the visible Separate/Sync sizes scope.
Removing a size removes that complete exact-size row; deleting an individual screen changes only the
slot scope described above.
Where people pick or edit a size (the Add output size menu, the output size cards, and Status by
size), a target the catalog lists devices for is titled by those devices, up to three and then
`+N` (`iPhone 18 Pro · 17 Pro · 17 +5`), with ` · Landscape` only for landscape targets. The App Store
slot and pixels follow as the detail (`Dynamic Island · Medium · 1206 × 2622 px`), and the full
device list is the card's tooltip. Export, Overview rows, the Screens header, Apply to, and the
artboard caption keep the slot name, because they describe what is exported and uploaded.

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
  Sync sizes family is compared by slot, and **Create from {first locale}** copies the slot into every
  size that family has; a Separate family copies only that screen. The copy keeps the source name
  and takes the target locale's text direction. A size row that exists in one locale's Sync sizes
  family but not another's is a sizes difference, not a missing screen.
- *Image missing from the project folder* (blocker) is the editor's missing-asset placeholder: a
  background, or a visible screenshot, image, or device-frame layer, whose project image did not
  load. It is reported per screen and layer once the image cache has loaded, and the row names the
  project path. **Replace** goes to the screen and opens the existing picker for that background or
  layer. Project Home's missing-asset readiness reads the same check across every layout.

Export folders apply only to the CLI (`--out`, or `export/` next to the project); UI export renders
into a private staging folder and hands the bundle to the browser as a download, so Issues has no
export-folder row.

**Status by size** in the Layer tab lists, for the selected text layer, every exact size of its
screen slot (the master screen and its variants) with whether the layer fits there. It reads the
same Issues, so fit is never measured twice, and shows *checking* until project fonts have loaded.
Layers keep no persisted link across sizes, so a size whose layer structure differs from the
selected screen's shows *no matching layer* rather than guessing; a hidden counterpart shows
*hidden*. **Fit** on a size sets the largest whole font size that fits that size's layer only, as
one undo step.

**Apply to** in the Inspector footer is one picker row that chooses which exact-size screens the
next edit writes to: **Only {size}** (the default), **All {destination}** (every size of the
screen's slot), or **All destinations** (that slot in every destination of the layout). The size name
drops Portrait, the default orientation, but keeps Landscape, Square, and qualifiers such as High-res;
a size without a name of its own leads with its family (`Phone · Portrait`, `Phone · High-res`). Long
names wrap between ` · ` parts instead of truncating. The text Size field repeats the same picker. One edit writes literal values into each screen in scope as a single undo step; it is never
a per-size override inside a screen, and screens of other locales are never touched. Layer edits
reach the matching layer on each size by the same structural match as Status by size and skip
unmatched or locked layers. Pixel metrics (position, size, font size, spacing, shadow, radius) are
written through the same fit used when a size is created, so they scale with each artboard; every
other field is copied. Each counterpart takes the edited layer's fitted value for every changed
field, replacing it rather than applying a delta, so editing position on one size also replaces
manual placement on the others in scope. A size that cannot take the fitted value within its limits
is skipped. In the Screen tab the scope applies to Background and Text placement. Destinations keep
no persisted slot link, so **All destinations** pairs a destination only when its master screen at
the same position has the same name, and skips it otherwise. Once the scope reaches past this screen,
the footer counts only the screens the next edit will write and names how many sizes and destinations
it skips. The scope is editor state only: it holds while the same layer (or, with nothing selected,
the same screen) stays selected and resets to **Only {size}** on any other selection or reload;
multi-selection keeps editing the selected screen only.

**Stored on this screen** at the top of the Screen tab shows, read-only, the locale and its text
direction, destination, exact store size with its export pixels, and layout that the screen
persists. Another locale or size is another screen, so none of these change in place.

**Text placement** in the Screen tab (**Top**, **Bottom**, **Side**) is a one-time preset: it writes
literal positions, stores nothing on the screen, and leaves later edits free. The screen's visible,
unlocked text layers stack in their current top-to-bottom order at the full width of a text region,
centered vertically; their font size and box height stay, so text reflows and Issues reports any
overflow with **Fit text**. A stack taller than its region grows past it but stays on the artboard,
even if it then overlaps the media. Its screenshot and device-frame layers are fitted into a media region as
one block that keeps its arrangement and aspect ratio, so a preset gives the same result whatever
was applied before. Side puts the text on the start edge of a right-to-left screen. Images, shapes,
groups, and locked or hidden layers stay put. Applying a preset again moves nothing and records no
undo step. The preset follows **Apply to**, is one undo step, and is disabled without a visible,
unlocked text layer.

**Locale matrix**, opened from **Locales**, lists the first locale's screens as rows against every
locale as columns, for the exact size the matrix was opened on. A cell says whether the screen exists
in that locale, and each cell matches the missing-locale entries of Issues. The header names the
layout, the structure, the shown destination (Sync sizes) or size (Separate), the screen and locale
counts, and how many cells are missing; blockers that Issues lists for other sizes or destinations
are counted as **in other sizes**. A missing cell offers **+ {first locale}**, the same fix as
Issues: it copies the screen with the target locale's text direction, into every size of a Sync
sizes family and into the shown size only under Separate, as one undo step through the usual save
path. Screen structure is stored per locale, so a cell's tooltip says which of the two its own click
does. Under Sync sizes a size's row is missing together with its slot.

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

The chords (⌘Z, ⇧⌘Z, Ctrl+Y, ⌘G, ⌘D, ⌘/) and the navigation keys work whenever focus is outside a
text field, select, or dialog and no menu is open, so they still work right after a click leaves
focus on a button, link, or layer row. Arrows, Delete, Backspace, T, and R also wait for focus
outside buttons and links, which use those keys themselves. `[` and `]` open the previous or next
size, the Overview rows in order, landing on the same slot when the row has it and stopping at the
first and last row; `O` switches between Focus and Overview; ⌘E (Ctrl+E) opens Export; ⌘K (Ctrl+K)
opens the search; ⌘J (Ctrl+J) toggles the Agent panel. The app cancels the browser default so Ctrl+K
and Ctrl+E do not move focus to Chrome's address bar, and Ctrl+J does not open its downloads. Letter shortcuts match the typed character, so AZERTY keeps Z on its Z key;
where the layout has no Latin letter (Cyrillic), they use the physical key instead, with the same
result for the bracket keys. `[` and `]` also work when Option or AltGr produces them.

A text layer that Issues reports as overflowing gets an amber state on every artboard that shows it:
an amber frame on the layer box, which stays the box the layer is moved and resized by, and a dashed
amber outline over the height the text would take without the box limit. The canvas reads the same
Issues, so it never measures fit a second time and stays empty until project fonts have loaded. On
the editable artboard a **Fit text** hint at the box's bottom-left corner applies the same fix as
Issues, on that screen only, as one undo step; it is disabled when even 1 px does not fit. For the
selected text layer the selection toolbar's Fit takes its place. The state steps aside while a layer
is dragged, transformed, or edited inline.

### Agent panel

**Agent**, the rail item after Locales, opens a 288 px panel in place of the Screens → Layers tree.
It runs an official agent CLI that the user installed and signed in to with their own subscription
(server rules: [`docs/architecture.md`](architecture.md)). Its header picks the agent and model
from `/api/agents`; each agent lists its sign-in state and version, and an agent without model
aliases shows `CLI default model`. When the selected agent cannot run, the panel says why and what
to do: **No agent found** when no CLI is installed (each links to its official setup page; the
editor works without an agent), **Not signed in** or **Signed in with an API key** with the CLI's
own Terminal sign-in command, **Update needed** below the verified version, and **Unavailable**
with the policy reason. Every agent carries a policy badge (**Supported**, **At your own risk**,
**Unavailable**). An agent at your own risk that the editor can run shows a warning card: the policy
reason and consequences, **Read the terms** with the date the policy was checked, and **I understand,
enable {agent}**; Send stays off until you consent, and **Revoke consent** under the picker takes it
back. An agent the editor cannot run yet says **Not supported in the editor yet**. **Check again**
reads the registry again. Agent purple marks only what a run
does; manual work keeps the blue accent.

The composer sends with Enter; Shift+Enter adds a line. Each message starts one run with only that
text, so the CLI does not remember earlier messages; the history is editor memory that **New chat**
clears and is never written to the project. A pending edit is saved before the run starts. While
the run lasts, its message shows the agent's plan as steps (`Running · step 2 of 3`), whether it is
`Thinking` or `Changing the project`, the last command it ran, and **Stop**, and a canvas banner
says `{agent} is editing this project`. Editing pauses for the run: the canvas, Layers, and
Inspector are inert; Undo, Redo, Export, Issues, the layout menu, the resource dialogs, and Projects
are disabled; only view keys (`[` `]`, `O`, ⌘J) work. The composer still takes the next request, and Send waits for the
run to end. Esc keeps closing the panel and never stops a run. **Stop** ends the run and, if it had
changed the project, undoes it, so the project is back at its pre-run state.

**Attach images** gives the agent a reference, mockup, or screenshot as context for that one request.
The paperclip button (keyboard reachable) opens the file picker, dropping files on the panel shows a
dashed drop zone, and pasting an image into the composer (⌘V / Ctrl+V) attaches it. Thumbnails sit above
the input, each with an accessible name and a **Remove** button; a file that is not an image or exceeds
a limit shows its reason beside its name, and Send stays off until it is removed. Only PNG, JPEG, and
WebP are accepted, judged by the file's bytes rather than its name; the limits are 5 images of at most
10 MB each per message. The composer notes that attached images are sent to the agent's provider with
the request, through the user's subscription. Images belong to one message and one run: the message
shows its thumbnails from editor memory, **New chat** frees them, and **Retry** and **Ask agent to fix**
send the same images again (the latter puts them back in the composer). An image reaches the project
folder only when the user asks the agent to use it: the agent runs `screenshots asset import`, which
stores a validated copy under `assets/imported/`, then assigns that path to an element. Undo run and
Stop restore `app-store-screenshots.json` only, so an imported copy stays on disk, unreferenced.

A rejected result was already rolled back by the server: the panel says so, with the schema reason
under **Show details** and **Ask agent to fix**, which prefills the composer. A usage limit names
the reset time the CLI gives and says nothing changed only when the verdict says so, with **Switch
agent** and **Retry**; other failures show the server's fixed message and **Retry**. After a run
that changed or was rejected, and after Undo run, the Workspace reloads the project from disk
through its usual resource load without saving the stale client copy, and keeps the current canvas
visible until the new project is ready; the canvas therefore shows the agent's result through the
renderer that export uses.

An accepted run that changed the project turns the panel into **Review**: the agent's summary,
**Changes** with each changed screen's locale and size and **Go to**, and **Checks** (schema
validation passed, and the Issues count with **Issues**). **Keep changes** drops the pre-run
snapshot; **Undo run** restores it as one write and is refused once the project changed after the
run. Undo run covers only `app-store-screenshots.json`, and ⌘Z history starts fresh after the
reload. A review survives an editor reload while the server still holds the snapshot.

Opening the panel focuses the composer. When Stop, the review, or the composer disappears, focus
moves to the composer or **Keep changes** instead of the page. The running status is a polite live
region, and failures are alerts.

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
rail exists only in Workspace. It holds the Select and Hand tools, the Layers panel toggle, one
entry per resource (Screen templates, Design packs, Fonts, Locales), each opening its existing
dialog rather than an intermediate panel, and the Agent panel toggle. Every item carries a short
caption under its icon (Select, Hand, Layers, Templates, Packs, Fonts, Locales, Agent, Play,
Projects) that its accessible name contains, and active items get the light accent fill. Its bottom group holds Play and the
`Projects` home action, which drains pending saves, preserves project-keyed workspace state, and returns to
`/`; save failure blocks that navigation and leaves the current Workspace mounted. If the project
source was moved or deleted, an app-owned confirmation may offer an explicit `Close without saving`
recovery action; Workspace must never discard the active client state automatically.
The Workspace top bar starts with a `Screenshot Studio / project / layout` breadcrumb whose product-name
button is the same Projects home action; Focus / Overview stay centered; undo, redo, the locale menu,
Issues with its count, Inspect, and Export sit on the right; Issues moves into the toolbar overflow
menu with Inspect at narrow widths. Export shows how many files a store-bundle export with the
dialog's default filters writes, computed by the same bundle builder the export route uses, and
shows no number when that bundle cannot be built.
A 34 px **status bar** closes the Workspace under the canvas and panels. It shows the save state,
the active screen, the current layer selection, and that screen's size, as in
`Save Fast · Save fast headline · iPhone Dynamic Island · Medium` (`No layer selected` or
`3 layers (2 text · 1 shape)` take the layer's place), then the key hints `[ ] Size`,
`O Focus/Overview`, `⌘K Find`, and `⌘Z Undo`, which hide below the medium width. The save state
reads `Saving…`, `Saved ·` with the time of the last successful save, or `Save failed · last saved`
with that time (`nothing saved yet` when no save has succeeded since the project opened), so a
failure still says how far the work is durable. The save cell is plain text, not a live region, so
autosaves are not announced; the `Save failed: …` alert keeps announcing the error. The time is
editor state, cleared when another project loads, and never part of the Project document.

The open Workspace picks up changes that the CLI or the user's own agent makes to the project file,
without a restart. Detection works as described in [`docs/architecture.md`](architecture.md). With
no unsaved edit, the canvas reloads in place through the usual resource load and keeps the current
screen and selection where they still exist. ⌘Z history then starts fresh, as it does after an agent
run. An edit made while the change is detected or loaded is never dropped or used to overwrite the
file. Its save is rejected instead, and an alert says **This project changed outside the editor.**:
the latest edits were not saved, so they did not overwrite that change. **Load latest version**
loads the file from disk and discards those unsaved edits. There is no option to keep the editor's
copy over the external change. The check pauses while an in-app agent run holds the project, because
that run reloads the Workspace itself.
Play opens a full-screen, read-only scene in the editor's current appearance with the files that bundle writes for the active
destination, size, and locale, in file order. The current screen is centered at full size with its
neighbours smaller and dimmed beside it; connected layouts show each screen's exact export crop
through the same `EditorStage`. Screens change with eased motion, not scrolling, and reduced motion
switches instantly. Autoplay advances every 3 s with a progress bar per screen and stops on the last
screen; buttons, arrow keys, dragging, a sideways wheel, or a progress-bar click pause it, and Space
toggles it. Play never changes the active screen, view, or project, and is disabled when that
bundle cannot be built.
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
- The **Templates** rail item opens a preview gallery with **Built-in** and **Project** tabs. Built-in
  lists the output starters and every screen of the built-in screen packs. A search box matches
  name, description, output, and style. The **Output** filter starts on the active screen's
  destination and device family and can widen to all outputs. The **Style** filter (Built-in only)
  narrows to one Design pack's screens, and the **Orientation** filter splits portrait from landscape.
  Styled pack screens show their shipped static preview; other templates show a striped placeholder
  in their artboard proportions. Each tile is a button: choosing one creates one ordinary editable
  screen in the active layout and locale, selects it, and closes the gallery. Every tile is disabled
  while a create is in flight, and the busy tile reads **Creating…**.
- **Create a managed project** filters its starting points to the selected destination: iPhone and iPad
  portrait; Android phone, Android tablet portrait, and Play Feature Graphic; or Web desktop and Web
  mobile. **Blank** remains explicit, and the existing generic project starters remain available
  where supported. Targeted starters open on their exact persisted variant.
- The Design packs dialog lists built-in **Design packs** beside the project's own **Project packs**.
  Each built-in pack shows a sample of its background, palette, and type. Applying either source is
  explicit and bakes editable color and typography literals into the active layout; **Apply pack**
  also replaces every screen background in that layout with the pack background. The project never
  stores a global pack reference.
- The same dialog lists built-in **Screen packs** for the active screen's output family. **Add screens
  from pack** appends each pack screen as an ordinary editable screen in the active layout and
  locale, then selects the first one.
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
