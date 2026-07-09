# Editor UX Spec

The UI/UX contract for the web canvas editor: layout, canvas model, panels, inspector,
save/load/export, and what is deliberately out of scope.

Version 0.2, 6 July 2026.

> **Status: Phase 1 is implemented** (slices 1–5, see `roadmap.md` §3a and `docs/specs/`).
> This spec now records both the **as-built** editor and the remaining **target** surface.
> Deltas ratified during the slices are marked *(as built / deferred)* inline; where this spec
> and a slice spec disagree, the slice spec — being the ratified decision — wins for what
> shipped, and this spec wins for what is still to build.

---

## 1. Layout — four regions

```
┌──────────────────────────────────────────────┐
│ Toolbar: element tools · zoom · export        │
├──────┬────────────────────────────┬───────────┤
│ Left │                            │ Inspector │
│ ──── │      Canvas (active        │  (right)  │
│Screens│   screen · scroll/zoom)    │ per-type  │
│ ──── │                            │   props   │
│Layers│                            │           │
└──────┴────────────────────────────┴───────────┘
```

Panels use plain Tailwind so far *(as built — shadcn/ui + Radix deferred until the first
dialog/select-heavy surface needs them)*. The canvas is Konva/react-konva.
Region responsibilities are kept distinct: the **toolbar** holds actions/tools, the **inspector**
holds properties of the current selection, the **left panel** holds structure (screens + layers).

---

## 2. Canvas

- *(as built)* The canvas shows **one active screen** in a scrollable region with zoom
  controls (in / out / reset). The original "infinite pan/zoom canvas with artboards placed
  freely in 2D" plus wheel-zoom / space-drag pan gestures were **deferred in Slice 1** and are
  not scheduled — re-open them deliberately (likely alongside Phase 3 polish) rather than
  assuming they exist.
- **Isolated-artboard invariant.** Each artboard clips its own elements (Konva clip); export is
  per-artboard. No element crosses an artboard boundary. Connected canvas is deferred (§8, Phase 6);
  the schema reserves `mode: "isolated" | "connected"` so it can be added later without a rewrite.
- **Selection & transform.** Click selects an element; a Konva `Transformer` provides
  move / resize / rotate handles. *(as built)* **Single-select only** — marquee multi-select was
  deferred in Slice 1 and is unscheduled; element **grouping is out** of the MVP.
- **Text editing.** Double-click a `text` element for inline editing on the canvas.
- **Active screen.** Exactly one artboard is the *active screen* at a time — the one last focused
  on the canvas or in the Screens list. It drives the Layers section (§3), the insert target for
  new elements (§4), and the no-selection inspector (§5).
- Placing two device mockups on one artboard (a 2-device slide) is possible in the MVP by adding
  two `device-frame` / `screenshot` elements manually. One-click layout *presets* for this are a
  Phase 3 templates feature (§8), not an MVP control.

---

## 3. Left panel — Screens + Layers

Two stacked sections, both visible at once (no tabs — the workflow constantly moves between
picking a screen and arranging its layers).

- **Screens** (compact): name + device label *(as built — thumbnails pending)*, add, delete, and
  drag-reorder (dnd-kit). Screen order is the **export order**, mirroring the planned CLI
  `screen reorder` command (Phase 2) — one ordering source, shared by UI and CLI.
- **Layers** (for the selected screen): elements in z-order (array order), with lock / hide /
  rename. **No grouping.**

---

## 4. Toolbar & adding elements

- Element tools: clicking a tool inserts the element at the centre of the active screen
  (insert-on-click, not drag-to-draw — simpler). *(as built)* Only **`text` + `shape`** are
  insertable — `screenshot` / `device-frame` have a required `assetUrl` and insertion needs an
  asset-picker UI that doesn't exist yet (they stay fully editable once present in the JSON).
  Asset picker + insert for those types is deferred.
- Zoom controls *(as built)*: zoom in / out / reset-to-100%; "fit" is not implemented.
- Export button opens a dialog (platform / device / locale) and produces **the same result as the
  CLI `export`** — one export path, not two. *(as built in Phase 2 Slice 3)*
- The toolbar does **not** edit background; background is an artboard property and lives in the
  inspector (§5).

---

## 5. Inspector (contextual, per type)

Always shows the shared element base when an element is selected: `x, y, width, height, rotation,
opacity, locked, visible`. Type-specific fields below it:

Fields marked *(target)* are not in the v1 schema yet — the inspector exposes them only once
the schema gains them (mostly Phase 3+). Everything else is as built (Slice 5).

- **No selection** → active **artboard** properties: artboard size with store-target status and
  exact-size presets *(as built)* and background: `solid` today;
  `gradient | image` *(target)*. Background editing lives here, not in the toolbar.
- **`text`** → content, registered font identity picker (`fontFamily` + `weight`), size,
  lineHeight, letterSpacing, align, color;
  shadow *(target)*.
- **`screenshot`** → assetUrl, fit (cover/contain), cornerRadius; crop *(target)*.
- **`device-frame`** → assetUrl, fit; deviceType (read-only, `iphone` only today); frame color,
  authorable screen slot *(target)*.
- **`shape`** → kind (`rect` today; ellipse/blob *(target)*), fill (solid; gradient *(target)*),
  radius; stroke *(target)*.

---

## 6. Save / load / export

- **Save / load** read and write `app-store-screenshots.json` through the `core` `StorageAdapter`.
  Load runs strict Zod validation and pure `v1→v2→…` migrations.
- **Export** from the UI uses the same `core` path as the CLI: alpha channel stripped, sizes from
  `store-specs.json`, zip bundles by platform/device/locale. The UI export button and `cli export`
  must meet the Phase 0 parity exit criterion — exact target dimensions, no alpha channel, and a
  visual diff within tolerance (*not* byte-identical; PNG metadata/compression may differ). See
  `architecture.md` §2.
- **Font management** opens from the toolbar: upload or materialize a Google Font, preview/list
  registered identities, apply one to the selected text element, or remove it. CLI and UI reuse
  the same add-time Node service; render/export never fetch fonts from the network.

---

## 7. States

- **Empty** (new project) → a call-to-action to add the first screen.
- **Missing asset** → a placeholder on the canvas plus a warning in the inspector; never crash.
- **Invalid JSON on load** → a blocking error surfacing the validator message; never fail silently.

---

## 8. Deliberately out of the MVP

Held back to protect the thin slice (aligned with `roadmap.md`):

- **Snapping / smart guides / alignment tools.** A free 2D canvas invites these, but they are out of
  the MVP. Stated explicitly so the canvas choice does not quietly drag scope in.
- **Undo/redo UI.** The store uses immutable state/patches (Zustand + Immer) from day 0, so the
  architecture is in place — but the undo *buttons* ship later.
- **Element grouping.** Pulls in a selection model, nested transforms, and z-order edge cases.
- **Layout presets / templates** (1-/2-/3-device base layouts as one click) — **Phase 3**. The
  manual capability exists in the MVP (§2); only the preset convenience is deferred. The `templates/`
  convention directory and schema leave room.
- **Themes UI, locales / RTL** — Phases 3–4. Font management shipped in Phase 3 Slice 3.
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
