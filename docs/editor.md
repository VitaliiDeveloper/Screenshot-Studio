# Editor UX Spec

The UI/UX contract for the web canvas editor: layout, canvas model, panels, inspector,
save/load/export, and what is deliberately out of scope.

Version 2.3, 19 July 2026.

> **Status: this document describes the current as-built strict v1 editor.**
> Future ideas are not editor fields until the schema, architecture, shared renderer, and tests
> widen together.

---

## 0. App Home and Project Home

App Home is the responsive launcher shell when no project is active or the user explicitly returns
to the launcher. It has one page heading and three stable product regions:

- **Create project** is visible but disabled, with Launcher 5 ownership stated explicitly.
- **Import project** is enabled. Its modal offers Folder (recommended), project ZIP, and eligible
  standalone JSON; it explains before selection that the source is validated into a managed copy and
  is not edited in place. Selecting a source opens an explicit managed-copy confirmation before any
  upload begins. The confirmation links the localhost in-place case to the existing `PROJECT_PATH`
  and `screenshots dev --project` entry points instead of presenting browser selection as a path.
- **Recent projects** remains a labelled empty region owned by Launcher 8; import does not populate a
  temporary imitation of recents.

The import modal moves focus to its heading, traps forward/reverse Tab, returns focus to the Import
trigger, and closes with Escape while choosing or uploading. Upload is cancellable; validation and
atomic publication are announced as a separate non-cancellable state. Errors use alert semantics and
list missing resource paths. Successful import activates the managed project and lands on Project
Home. Managed Project Home offers **Export project archive** with busy/error feedback and native
download behavior; its copy distinguishes the portable project backup from rendered store-image
export. Import-card press feedback, dialog entrance and exit, and dialog state changes use calm,
short transform/opacity motion. Close and Escape keep the dialog mounted until its exit finishes;
reduced-motion preferences complete these transitions without animation. Local-file Project Home
retains its exact-location behavior and does not offer this managed archive action.

Project Home is the informational/action surface for the validated active project, not a second
editor. It reports project name, source label and safe location when available, supported platforms,
layouts and immutable modes, preferred export layout, locales, output families/store targets, screen
and empty-screen counts, and readiness conditions known by current asset/font/save services.
Representative screens use the existing shared-renderer thumbnail projection. Its actions route to
the existing Workspace/layout-screen, locale, import, store-image export, and project-archive export
surfaces; project archive and rendered store-image export remain visibly distinct.

**Close project** is source-neutral and non-destructive. It secures pending/latest writes, applies the
existing save-failure safeguard, clears only the active session plus that project's transient
workspace navigation state, and returns to App Home. It never removes recents, trashes/deletes a
managed project, or moves/deletes a local-file directory. The workflow guide distinguishes project
templates, screen templates, layout modes, project import, capture import, project archive export,
and store-image export without claiming out-of-scope launcher behavior.

---

## 1. Layout — workbench regions

```
┌──────────────────────────────────────────────────────────────┐
│ Top bar: Project Home · project · layout · locale/manage · Focus/Overview · Export │
├────┬──────────────┬────────────────────────────┬──────────────┤
│Tool│ Context shelf│ Canvas viewport            │ Inspector    │
│rail│ (collapsible)│ artboards · pattern        │ (collapsible)│
│    │ Structure /  │ pan · zoom · Fit           │ per-type     │
│    │ Resources /  │                            │ properties   │
│    │ Add          │                            │              │
└────┴──────────────┴────────────────────────────┴──────────────┘
```

Panels and dialogs use plain Tailwind plus shared local workbench primitives; a package-level
design system remains YAGNI until a second UI consumer exists. Icons use Lucide;
the canvas remains Konva/react-konva.
Region responsibilities are kept distinct: the **top bar** holds project/view/export actions, the
**tool rail** chooses interaction/context, the **context shelf** holds structure/resources/add,
the **inspector** holds properties, and the **canvas** owns its viewport controls.

At wide desktop widths the shelf and inspector occupy columns. At compact widths the shelf becomes
an overlay; the inspector can be closed and defaults closed below 768px. Zoom controls are positioned
inside the remaining canvas viewport, so they never slide behind the inspector.

---

## 2. Canvas

- `Focus` shows the active screen's exact crop. In isolated mode, `Overview` gives every output
  family one shared container with its master and explicit store-target groups in separate size
  rows. The selected output owns the outer highlight while only the active size row is marked
  `Editing`. Variant rows repeat the output label with their exact size and a `Variant` marker so
  each row remains self-describing inside the shared container. In connected mode, Overview shows the active exact platform/device/locale/target group
  as one gapless editable strip. Exactly one screen remains the active owner for insertion and
  owner-scoped Layers.
- Zoom supports controls, reset-to-100%, and Fit over `25%…400%`. `Ctrl`/`Cmd` + wheel and Mac
  trackpad pinch zoom around the pointer. Hand mode or holding Space enables drag-pan; ordinary
  two-axis wheel/trackpad scrolling remains native.
- Canvas chrome supports `Dots`, `Grid`, and `None`. The pattern is ephemeral workspace state and
  never appears in project JSON or exported pixels.
- **Canvas mode.** Every layout is created as `isolated` or `connected`, and its mode can be changed later.
  Isolated behavior remains independent. Connected Overview is one gapless editable exact
  platform/device/locale/store-target strip;
  screen-offset groups preserve owner-local coordinates, cross-boundary selection resolves to the
  owner screen, and Focus is the exact non-interactive crop preview used to check each artboard.
- **Selection & transform.** Click selects an element; a Konva `Transformer` provides
  move / resize / rotate handles. Locked elements retain a selection outline but cannot be moved,
  resized, rotated, or opened for canvas text editing. Shift/Cmd/Ctrl click toggles composite
  owner-aware identities and blank-canvas drag performs rotation-aware marquee selection. A
  multi-selection exposes aggregate bounds plus atomic move/delete/lock/visibility; locked members
  stay selected but do not move. Resize, rotate, and snapping remain single-element operations.
  Same-owner top-level leaves can be grouped; one-level groups render/select through the shared
  UI/CLI node tree, transform as one node, resize uniformly, and can be duplicated or ungrouped.
- **Text editing.** Double-click a `text` element for an overlay aligned to its scaled logical box
  with the screen's explicit LTR/RTL direction. `Escape` cancels and `Ctrl`/`Cmd` + `Enter` commits;
  blur commits and flushes persistence.
- **Active screen.** Exactly one artboard is the *active screen* at a time — the one last focused
  on the canvas or in the Screens list. It drives the Layers section (§3), the insert target for
  new elements (§4), and the no-selection inspector (§5). The active locale is derived from this
  screen rather than persisted as a second workspace selection.
- **Active layout.** Exactly one layout is active in the editor. Switching always succeeds, performs
  no conversion or save, clears screen/element selection, and restores that layout's in-memory
  content history. The selection is remembered locally per canonical project and falls back to
  `preferredExportLayoutId`; it is never written to project JSON.
- Placing two device mockups on one artboard (a 2-device slide) is possible manually or through
  an exact project-local template. Templates create screens; they do not add responsive layout
  behavior to the canvas.

---

## 3. Tool rail + contextual shelf

The 56px permanent rail contains Select, Hand, Structure, Resources, and Add. Only one contextual
shelf is open at a time; clicking its active rail item collapses it.

- **Structure / Screens** (compact): shared-renderer thumbnail + name + device label, add, delete,
  and drag-reorder (dnd-kit) for the active locale in isolated mode or exact group in connected
  mode. Reorder changes only that scope's slots in the layout screen array, preserving unrelated slots.
  Layout-local order is the one ordering source
  shared by UI and CLI; each platform/device/locale export group derives its relative `01`, `02`, …
  slot order from it. The final screen in a locale is protected here so whole-locale removal always
  goes through the confirmed locale-manager action.
- **Structure / Layers** (for the selected screen): top-level elements in z-order (array order),
  with lock / hide / rename. Groups expose one indented child level for selection, inspection,
  lock, visibility, and deletion; top-level drag reorder remains group-atomic.
- **Resources:** opens existing Fonts, Themes, and Templates dialogs.
- **Add:** searchable, data-driven groups (`Basic`, `Media`, `Frames`, `Library`). Text and Shape
  and trusted built-in Icon insert immediately. Screenshot, decorative Image, and Device Frame open the project image
  picker. Templates opens the existing library. Adding a
  future type extends catalog metadata and an action rather than restructuring the workbench.
  Library also inserts editable grouped Rating and As seen on badges when a registered font exists;
  Store badge opens the secure project picker and inserts a named contain-fit image.

---

## 4. Top bar & adding elements

- The compact layout selector follows the project name and shows the active layout name plus its
  non-editable mode badge. Its ordered menu marks the active and preferred layouts and provides Rename,
  Duplicate, Switch mode, Prefer for export, Delete, and New layout. Switching always preserves the
  stored screen/element data; when Connected content extends outside an owner artboard, the menu warns
  that those pixels are clipped while Isolated and reappear after switching back. Names are trimmed and case-insensitively
  unique. New layout asks only for name and mode and creates one clean screen using the active
  screen's platform/device/locale/direction/artboard, a solid `#101827` background, and no elements.
  Duplicate copies the selected layout's content with fresh layout, screen, and element ids.
- Element entries in the Add shelf insert at a deterministic active-screen origin
  (insert-on-click, not drag-to-draw — simpler). `text` and `shape` insert directly;
  `screenshot` and `device-frame` choose a PNG/JPEG/WebP under project-local `assets/` or
  `screenshots/`, then insert through the existing factories and shared image cache. Discovery and
  serving reject traversal and symlink escapes. The picker does not upload or mutate files. The
  decorative `image` element inserts from the same secure project asset picker.
- Zoom controls live on the canvas rather than in the top bar; Fit is implemented.
- Export button opens a dialog (platform / device / locale) and exports the active layout through
  **the same renderer as CLI `export`** — one export path, not two.
- The locale selector switches complete sets. Its manager clones a source set, chooses explicit
  LTR/RTL direction, mirrors an existing set with confirmation, and removes all screens for a
  locale while protecting the final locale.
- In connected mode, Overview, Fit, and Screens share the active exact
  platform/device/locale/store-target
  group. Reorder changes only that group's project slots; unrelated same-locale groups keep their
  indices. Thumbnails depend on the full group because neighbour-owned pixels may enter a crop.
  Layers labels and follows the active owner screen. Mode is shown by the layout selector and changes
  from its row menu without coordinate conversion or a blocking overflow guard.
- Fonts, Themes, and Templates open from Resources. Theme and template files are
  server-side project inputs; the browser receives validated definitions and durable projects.
  LTR-authored template geometry is baked once when instantiated into an RTL locale.
- The top bar does **not** edit artboard background; that project property lives in the
  inspector (§5).

---

## 5. Inspector (contextual, per type)

Shows editable geometry when one element is selected: `x, y, width, height, rotation, opacity`.
Multiple elements show read-only aggregate bounds and batch lock/unlock, hide/show, and delete
actions. Numeric drafts are bounded
to the strict schema before they can mutate the live project. Type-specific fields appear below:

- **No selection** → active **artboard** properties: every lead or variant Store Target uses the same
  single-row `Artboard` control with Store size/Custom modes. Store size matches that target's export dimensions; Custom keeps
  its aspect ratio while allowing a larger authoring canvas. Actions resize every composition in the
  active locale/platform/device/target output set atomically without changing sibling targets.
  Newly created watchOS lead and variant targets default to proportional 3.5× authoring artboards;
  persisted exact screens open as Fixed and remain unchanged until the user explicitly resizes them:
  `solid | linear-gradient | project image`. Image selection uses the secure project asset picker;
  fit and fallback/letterbox colour remain explicit. Project JSON may contain schema-valid
  eight-digit colours with alpha, while the current native `<input type="color">` picker authors
  six-digit opaque colours and provides no alpha editing. Final store export flattens the composed
  PNG to an opaque output. Background editing lives here, not in the toolbar.
- **`text`** → theme role (`none | heading | body | accent | surface`), content,
  registered font identity picker (`fontFamily` + `weight`), size,
  lineHeight, letterSpacing, align, color;
  one optional literal shadow (color, blur, offset, opacity).
- **`screenshot`** → assetUrl, fit (cover/contain), cornerRadius; when fit is cover, normalized
  focal-point percentages, bounded crop zoom, and reset. Contain preserves but deterministically
  ignores the persisted crop literal.
- **`image`** → assetUrl, fit (contain default or cover), cornerRadius, and the same crop behavior.
- **`icon`** → trusted built-in id (`check | heart | sparkles | star`), color, strokeWidth.
- **Badge compositions** → no dedicated inspector/schema type; grouped rating/press badges expose
  their ordinary child fields, while official store badges use the ordinary image inspector.
- **`device-frame`** → assetUrl, fit, and trusted preset (`iphone | android-phone | tablet | desktop |
  tv | watch`). Switching preset fits the outer box to its canonical aspect ratio; frame color and
  author-defined screen slot remain outside the contract.
- **`shape`** → theme role (`none | heading | body | accent | surface`), kind (`rect | ellipse`),
  solid fallback or two-stop linear-gradient fill, rect radius, and optional stroke.

---

## 6. Save / load / export

- **Save / load** read and write the single `app-store-screenshots.json` project document through
  the `core` `StorageAdapter`. Its separate `putAsset` operation owns only explicitly submitted
  asset bytes; fonts, themes, templates, imports, processed assets, and exports remain dedicated
  service boundaries rather than implicit adapter storage.
  Load validates the raw complete v1 document directly through the strict Zod schema. Historical
  internal development formats are unsupported and are not rewritten on load.
- Layout switching and the locally remembered active layout are workspace state only. Content
  undo/redo is independent per layout and stores screen snapshots only; layout add, duplicate,
  rename, mode, prefer, and delete are durable lifecycle actions outside content history.
- Home ↔ Workspace navigation preserves valid active layout, active screen, element selection,
  Focus/Overview, zoom, tool, canvas pattern, shelf, and inspector state for the same project identity.
  Transient chrome is project-keyed session state and never enters project JSON. Before Workspace
  opens Project Home it drains pending writes and saves the latest snapshot; a failure blocks
  navigation and keeps the editable state visible.
- Inspector changes are coalesced, flushed on blur, and serialized with resource mutations. Failed
  saves surface a visible workspace alert; the editor never silently presents a rejected value as
  durable state.
- **Store outputs** lists App Store iPhone/iPad/macOS/tvOS/watchOS, Google Play Android phone, and
  Microsoft Store Windows desktop. Creating an output copies the active locale's complete root set
  with fresh screen/element ids and leaves the source family unchanged. New watchOS output families
  use a core-derived 1477 × 1799 custom master from the 422 × 514 lead target; other families keep
  their exact lead masters. Inside the active output, the lead row remains its root/master; accepted
  non-lead sizes create independent variants without leaving the current canvas context. New
  watchOS variants use a 3.5× authoring artboard derived from their own exact target—for example,
  Series 11 authors at 1456 × 1736 and exports at 416 × 496. Lead and variant targets have identical
  target-local Store size/Custom controls; resizing one never changes another. When another screen is
  added to an existing target output set, it reuses that set's current authoring size instead of
  reverting to the platform default. Each variant remains available to open explicitly, and removing
  one preserves its master. Existing output families and variants open unchanged, and creation
  actions never resize an existing screen in place.
- **Export** from the UI uses the active layout and the same `core` path as the CLI: alpha channel stripped, sizes from
  `store-specs.json`, and zip bundles at
  `platform/device/<safe-locale>/NN-<screen>-<size>.png`. The collision-safe locale segment is
  shared with CLI export; numbering restarts per exact platform/device/locale/target group in relative
  layout order. CLI export accepts `--layout <id-or-name>` and otherwise uses
  `preferredExportLayoutId`. The UI export button and `cli export` meet the parity contract —
  exact target dimensions, no alpha channel, and a visual diff within tolerance (*not*
  byte-identical; PNG metadata/compression may differ). See `architecture.md` §2.
  The POST returns `201` with a short-lived one-shot same-origin ticket; a separate GET consumes the
  ticket and streams the ZIP to the browser’s native download path without creating a page-memory
  Blob. Missing/consumed tickets return `404`, and known expired tickets return `410`.
- **Font management** opens from Resources: upload or materialize a Google Font, preview/list
  registered identities, apply one to the selected text element, or remove it. CLI and UI reuse
  the same add-time Node service; render/export never fetch fonts from the network.
- **Theme management** assigns roles in text/shape inspectors and applies strict `themes/*.json`
  to the active layout through a serialized server mutation. Only literal project fields reach rendering.
- **Template library** lists strict `templates/*.json`, creates a fresh-id screen in the active
  layout using the active
  locale and direction, persists it, and selects it. LTR-authored template placement/alignment is
  mirrored once for an RTL target. Templates never enter the render contract.

---

## 7. States

- **No active project** → final App Home exposes enabled Import, disabled Create, and an empty Recents
  region; it exposes no raw path field and never selects the bundled sample implicitly.
- **Import choosing/confirming/uploading** → Folder/ZIP/JSON choices explain managed-copy behavior;
  selection remains client-only until explicit confirmation, and browser transfer can be cancelled
  without changing the prior session or catalog.
- **Import publishing** → validation and atomic publication are announced and cannot be cancelled
  after the upload boundary.
- **Import failure** → an alert preserves the launcher and prior session, provides retry, and lists
  missing resource paths when standalone JSON was incomplete.
- **Invalid configured local project** → App Home shows the validation/path error without activating
  or mutating a project.
- **Selected local project** → Project Home shows source identity and the exact location only because
  the local source reports `revealLocation`.
- **Selected managed project** → Project Home omits server location, opens the same Workspace, and
  offers the distinct portable project-archive export action.
- **Workspace navigation save failure** → Project Home navigation is blocked; an alert explains that
  the latest project changes could not be saved and Workspace remains active.
- **Close project failure** → Project Home keeps the active session and project state and reports the
  failure; successful close returns to App Home without changing project storage or recents.
- **Empty artboard** → Add remains available for creating the first element on the existing screen.
- **Missing asset** → a visible placeholder on the canvas; never crash or block the rest of the screen.
- **Invalid JSON on load** → a blocking error surfacing the validator message; never fail silently.
- **Save failure** → the local edit remains visible but a workspace alert names the failed durable
  write; a later successful mutation clears the error state.

---

## 8. Deliberate boundaries

- Groups have one child level, do not clip, and cannot nest.
- Multi-selection supports aggregate movement and atomic actions, not aggregate resize/rotation.
- Automatic translation is an agent-assisted project workflow, not a provider-backed editor feature.
- Project assets are selected from local files; the picker does not upload, fetch, rename, or delete.
- Only strict v1 background, element, crop, shadow, gradient, stroke, and frame literals are
  authorable. New primitives or generic effects require an explicit schema and parity change.
