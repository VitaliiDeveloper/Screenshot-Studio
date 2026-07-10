# Editor UX Spec

The UI/UX contract for the web canvas editor: layout, canvas model, panels, inspector,
save/load/export, and what is deliberately out of scope.

Version 0.7, 10 July 2026.

> **Status: Phase 1, the Phase 3 font/theme/template surfaces, Phase 3.5 visual polish, the Phase 3.6 workspace foundation, and the complete Phase 4 locale/RTL workflow are implemented**
> (see `roadmap.md` §3a/§3c/§3e and `docs/specs/`).
> This spec now records both the **as-built** editor and the remaining **target** surface.
> Deltas ratified during the slices are marked *(as built / deferred)* inline; where this spec
> and a slice spec disagree, the slice spec — being the ratified decision — wins for what
> shipped, and this spec wins for what is still to build.

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

Panels and dialogs use plain Tailwind plus shared local workbench primitives *(as built — a
package-level design system remains YAGNI until a second UI consumer exists)*. Icons use Lucide;
the canvas remains Konva/react-konva.
Region responsibilities are kept distinct: the **top bar** holds project/view/export actions, the
**tool rail** chooses interaction/context, the **context shelf** holds structure/resources/add,
the **inspector** holds properties, and the **canvas** owns its viewport controls.

At wide desktop widths the shelf and inspector occupy columns. At compact widths the shelf becomes
an overlay; the inspector can be closed and defaults closed below 768px. Zoom controls are positioned
inside the remaining canvas viewport, so they never slide behind the inspector.

---

## 2. Canvas

- *(as built in Phase 3.6 and narrowed in Phase 4)* `Focus` shows one active screen; `Overview`
  lays every screen in the active locale left-to-right in export order on one shared scroll/zoom
  viewport. Overview is presentation only: each screen remains an isolated artboard and exactly
  one screen is active/editable.
- Zoom supports controls, reset-to-100%, and Fit over `25%…400%`. `Ctrl`/`Cmd` + wheel and Mac
  trackpad pinch zoom around the pointer. Hand mode or holding Space enables drag-pan; ordinary
  two-axis wheel/trackpad scrolling remains native.
- Canvas chrome supports `Dots`, `Grid`, and `None`. The pattern is ephemeral workspace state and
  never appears in project JSON or exported pixels.
- **Isolated-artboard invariant.** Each artboard clips its own elements (Konva clip); export is
  per-artboard. No element crosses an artboard boundary. Connected canvas is deferred (§8, Phase 6)
  and is not represented in the enforced v1 schema.
- **Selection & transform.** Click selects an element; a Konva `Transformer` provides
  move / resize / rotate handles. Locked elements retain a selection outline but cannot be moved,
  resized, rotated, or opened for canvas text editing. *(as built)* **Single-select only** — marquee
  multi-select was deferred in Slice 1 and is unscheduled; element **grouping is out** of the MVP.
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
  and drag-reorder (dnd-kit) for the active locale. Reorder changes only that locale's slots in the
  project array, preserving other locales' relative order. Project order is the one ordering source
  shared by UI and CLI; each platform/device/locale export group derives its relative `01`, `02`, …
  slot order from it. The final screen in a locale is protected here so whole-locale removal always
  goes through the confirmed locale-manager action.
- **Structure / Layers** (for the selected screen): elements in z-order (array order), with lock / hide /
  rename. **No grouping.**
- **Resources:** opens existing Fonts, Themes, and Templates dialogs.
- **Add:** searchable, data-driven groups (`Basic`, `Media`, `Frames`, `Library`). Text and Shape
  insert immediately. Asset-bearing entries remain visible but disabled with an asset-picker
  explanation; Templates opens the existing library. Adding a future type extends catalog metadata
  and an action rather than restructuring the workbench.

---

## 4. Top bar & adding elements

- Element entries in the Add shelf insert at a deterministic active-screen origin
  (insert-on-click, not drag-to-draw — simpler). *(as built)* Only **`text` + `shape`** are
  insertable — `screenshot` / `device-frame` have a required `assetUrl` and insertion needs an
  asset-picker UI that doesn't exist yet (they stay fully editable once present in the JSON).
  Asset picker + insert for those types is deferred.
- Zoom controls live on the canvas rather than in the top bar; Fit is implemented.
- Export button opens a dialog (platform / device / locale) and produces **the same result as the
  CLI `export`** — one export path, not two. *(as built in Phase 2 Slice 3)*
- The locale selector switches complete sets. Its manager clones a source set, chooses explicit
  LTR/RTL direction, mirrors an existing set with confirmation, and removes all screens for a
  locale while protecting the final locale.
- Fonts, Themes, and Templates open from Resources. Theme and template files are
  server-side project inputs; the browser receives validated definitions and durable projects.
  LTR-authored template geometry is baked once when instantiated into an RTL locale.
- The top bar does **not** edit artboard background; that project property lives in the
  inspector (§5).

---

## 5. Inspector (contextual, per type)

Shows editable geometry when an element is selected: `x, y, width, height, rotation, opacity`.
Lock and visibility remain in Layers rather than being duplicated here. Numeric drafts are bounded
to the strict schema before they can mutate the live project. Type-specific fields appear below:

Fields marked *(target)* are not in the v1 schema yet — the inspector exposes them only once
the schema gains them (future phases). Everything else is as built.

- **No selection** → active **artboard** properties: artboard size with store-target status and
  exact-size presets *(as built)* and background: `solid` today;
  `gradient | image` *(target)*. Background editing lives here, not in the toolbar.
- **`text`** → theme role (`none | heading | body | accent | surface`), content,
  registered font identity picker (`fontFamily` + `weight`), size,
  lineHeight, letterSpacing, align, color;
  shadow *(target)*.
- **`screenshot`** → assetUrl, fit (cover/contain), cornerRadius; crop *(target)*.
- **`device-frame`** → assetUrl, fit; deviceType (read-only, `iphone` only today); frame color,
  authorable screen slot *(target)*.
- **`shape`** → theme role (`none | heading | body | accent | surface`), kind (`rect` today;
  ellipse/blob *(target)*), fill (solid; gradient *(target)*),
  radius; stroke *(target)*.

---

## 6. Save / load / export

- **Save / load** read and write `app-store-screenshots.json` through the `core` `StorageAdapter`.
  Load runs strict Zod validation and pure `v1→v2→…` migrations.
- Inspector changes are coalesced, flushed on blur, and serialized with resource mutations. Failed
  saves surface a visible workspace alert; the editor never silently presents a rejected value as
  durable state.
- **Export** from the UI uses the same `core` path as the CLI: alpha channel stripped, sizes from
  `store-specs.json`, and zip bundles at
  `platform/device/<safe-locale>/NN-<screen>-<size>.png`. The collision-safe locale segment is
  shared with CLI export; numbering restarts per exact platform/device/locale group in relative
  project order. The UI export button and `cli export` must meet the Phase 0 parity exit criterion —
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

- **Empty** (new project) → a call-to-action to add the first screen.
- **Missing asset** → a visible placeholder on the canvas; never crash or block the rest of the screen.
- **Invalid JSON on load** → a blocking error surfacing the validator message; never fail silently.
- **Save failure** → the local edit remains visible but a workspace alert names the failed durable
  write; a later successful mutation clears the error state.

---

## 8. Deliberately out of the MVP

Held back to protect the thin slice (aligned with `roadmap.md`):

- **Snapping / smart guides / alignment tools.** Overview and pan/zoom do not imply cross-artboard
  geometry or snapping; those remain out of the MVP.
- **Undo/redo UI.** The store uses immutable state/patches (Zustand + Immer) from day 0, so the
  architecture is in place — but the undo *buttons* ship later.
- **Element grouping.** Pulls in a selection model, nested transforms, and z-order edge cases.
- **Automatic translation.** Complete locale sets and explicit RTL layouts ship in Phase 4;
  translation assistance remains Phase 5.
- **Connected canvas** (elements crossing artboards, crop export) — **Phase 6**. This is the
  project's primary scope-creep risk and directly compounds the render/export parity risk that
  Phase 0 must retire first. Not before Phase 0 passes.

---

## 9. Open assumptions — resolved

The Phase 0 spike and the Phase 1 slices settled the assumptions this section used to hold:

- **Font / text inspector (§5) — confirmed.** The parity gate held through Slices 1–5, so the
  full text surface (`content`, `fontFamily`, `size`, `weight`, `lineHeight`, `letterSpacing`,
  `align`, `color`) is exposed as built. `shadow` stays *(target)* until the schema gains it —
  when it does, it re-runs the parity gate like any render-affecting field.
