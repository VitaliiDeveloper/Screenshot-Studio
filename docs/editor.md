# Editor UX Spec

The UI/UX contract for the web canvas editor: layout, canvas model, panels, inspector,
save/load/export, and what is deliberately out of scope.

Version 2.0, 12 July 2026.

> **Status: this document describes the as-built strict v10 editor after finite Phase 9 closure.**
> Future ideas are not editor fields until the schema, architecture, shared renderer, and tests
> widen together.

---

## 1. Layout — workbench regions

```
┌──────────────────────────────────────────────────────────────┐
│ Top bar: project · locale/manage · Focus/Overview · Export     │
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

- `Focus` shows the active screen's exact crop. In isolated mode, `Overview` lays every root output
  family for the active locale in its own row; in connected mode, it shows the active exact
  platform/device/locale/target group as one gapless editable strip. Exactly one screen remains the
  active owner for insertion and owner-scoped Layers.
- Zoom supports controls, reset-to-100%, and Fit over `25%…400%`. `Ctrl`/`Cmd` + wheel and Mac
  trackpad pinch zoom around the pointer. Hand mode or holding Space enables drag-pan; ordinary
  two-axis wheel/trackpad scrolling remains native.
- Canvas chrome supports `Dots`, `Grid`, and `None`. The pattern is ephemeral workspace state and
  never appears in project JSON or exported pixels.
- **Canvas mode.** The enforced v10 project stores `mode: isolated | connected`. Isolated behavior
  remains unchanged. Connected Overview is one gapless editable exact
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
- Placing two device mockups on one artboard (a 2-device slide) is possible manually or through
  an exact project-local template. Templates create screens; they do not add responsive layout
  behavior to the canvas.

---

## 3. Tool rail + contextual shelf

The 56px permanent rail contains Select, Hand, Structure, Resources, and Add. Only one contextual
shelf is open at a time; clicking its active rail item collapses it.

- **Structure / Screens** (compact): shared-renderer thumbnail + name + device label, add, delete,
  and drag-reorder (dnd-kit) for the active locale in isolated mode or exact group in connected
  mode. Reorder changes only that scope's slots in the project array, preserving unrelated slots.
  Project order is the one ordering source
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

- Element entries in the Add shelf insert at a deterministic active-screen origin
  (insert-on-click, not drag-to-draw — simpler). `text` and `shape` insert directly;
  `screenshot` and `device-frame` choose a PNG/JPEG/WebP under project-local `assets/` or
  `screenshots/`, then insert through the existing factories and shared image cache. Discovery and
  serving reject traversal and symlink escapes. The picker does not upload or mutate files. The
  decorative `image` element inserts from the same secure project asset picker.
- Zoom controls live on the canvas rather than in the top bar; Fit is implemented.
- Export button opens a dialog (platform / device / locale) and produces **the same result as the
  CLI `export`** — one export path, not two.
- The locale selector switches complete sets. Its manager clones a source set, chooses explicit
  LTR/RTL direction, mirrors an existing set with confirmation, and removes all screens for a
  locale while protecting the final locale.
- In connected mode, Overview, Fit, and Screens share the active exact
  platform/device/locale/store-target
  group. Reorder changes only that group's project slots; unrelated same-locale groups keep their
  indices. Thumbnails depend on the full group because neighbour-owned pixels may enter a crop.
  Layers labels and follows the active owner screen. The toolbar's mode control surfaces guarded
  connected→isolated refusal and successful mode changes use ordinary history/save.
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

- **No selection** → active **artboard** properties: a read-only exact lead master size by default,
  explicit output-set-wide atomic custom-size/reset actions, independent exact-size variants, and background:
  `solid | linear-gradient | project image`. Image selection uses the secure project asset picker;
  fit and opaque fallback/letterbox colour remain explicit. Background editing lives here, not in the toolbar.
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

- **Save / load** read and write `app-store-screenshots.json` through the `core` `StorageAdapter`.
  Load runs strict Zod validation and pure `v1→v2→…` migrations.
- Inspector changes are coalesced, flushed on blur, and serialized with resource mutations. Failed
  saves surface a visible workspace alert; the editor never silently presents a rejected value as
  durable state.
- **Store outputs** lists App Store iPhone/iPad/macOS/tvOS/watchOS, Google Play Android phone, and
  Microsoft Store Windows desktop. Creating an output copies the active locale's complete root set
  with fresh screen/element ids and leaves the source family unchanged. Inside the active output,
  the lead row remains its root/master; accepted non-lead sizes create or open independent exact
  variants. Removing a variant preserves its master. No output or target action resizes a root in
  place.
- **Export** from the UI uses the same `core` path as the CLI: alpha channel stripped, sizes from
  `store-specs.json`, and zip bundles at
  `platform/device/<safe-locale>/NN-<screen>-<size>.png`. The collision-safe locale segment is
  shared with CLI export; numbering restarts per exact platform/device/locale/target group in relative
  project order. The UI export button and `cli export` meet the parity contract —
  exact target dimensions, no alpha channel, and a visual diff within tolerance (*not*
  byte-identical; PNG metadata/compression may differ). See `architecture.md` §2.
- **Font management** opens from Resources: upload or materialize a Google Font, preview/list
  registered identities, apply one to the selected text element, or remove it. CLI and UI reuse
  the same add-time Node service; render/export never fetch fonts from the network.
- **Theme management** assigns roles in text/shape inspectors and applies strict `themes/*.json`
  through a serialized server mutation. Only literal project fields reach rendering.
- **Template library** lists strict `templates/*.json`, creates a fresh-id screen using the active
  locale and direction, persists it, and selects it. LTR-authored template placement/alignment is
  mirrored once for an RTL target. Templates never enter the render contract.

---

## 7. States

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
- Only strict v10 background, element, crop, shadow, gradient, stroke, and frame literals are
  authorable. New primitives or generic effects require an explicit schema and parity change.
