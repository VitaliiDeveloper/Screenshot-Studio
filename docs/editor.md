# Editor UX Spec

The UI/UX contract for the web canvas editor (the Phase 1 thin slice): layout, canvas model,
panels, inspector, save/load/export, and what is deliberately out of scope. This is the
intended design to build against once Phase 0 (parity spike) passes — it does not authorize
starting editor implementation before parity holds (see `roadmap.md` §4).

Version 0.1, 30 June 2026.

> **Sequencing.** This spec is preparatory. The editor is Phase 1; per `roadmap.md`, no editor
> code starts until the Phase 0 render/export parity proof passes. Sections marked *pending
> Phase 0* may shift based on the spike's outcome.

---

## 1. Layout — four regions

```
┌──────────────────────────────────────────────┐
│ Toolbar: element tools · zoom · export        │
├──────┬────────────────────────────┬───────────┤
│ Left │                            │ Inspector │
│ ──── │      Infinite canvas       │  (right)  │
│Screens│   (pan / zoom, artboards)  │ per-type  │
│ ──── │                            │   props   │
│Layers│                            │           │
└──────┴────────────────────────────┴───────────┘
```

Panels, dialogs, selects, and tooltips use shadcn/ui + Radix. The canvas is Konva/react-konva.
Region responsibilities are kept distinct: the **toolbar** holds actions/tools, the **inspector**
holds properties of the current selection, the **left panel** holds structure (screens + layers).

---

## 2. Canvas

- An infinite **pan / zoom** canvas; artboards are placed freely in 2D space. This matches
  `roadmap.md` Phase 1 ("Konva stage with zoom/pan") and is *not* a connected canvas.
- **Isolated-artboard invariant.** Each artboard clips its own elements (Konva clip); export is
  per-artboard. No element crosses an artboard boundary. Connected canvas is deferred (§8, Phase 6);
  the schema reserves `mode: "isolated" | "connected"` so it can be added later without a rewrite.
- **Selection & transform.** Click selects an element; a Konva `Transformer` provides
  move / resize / rotate handles. Marquee multi-select is **in** (simple); element **grouping is
  out** of the MVP.
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

- **Screens** (compact, collapsible): thumbnail + name, add, and drag-reorder (dnd-kit). Screen
  order is the **export order**, mirroring the CLI `screen reorder` command — one ordering source,
  shared by UI and CLI.
- **Layers** (for the selected screen): elements in z-order (array order), with lock / hide /
  rename. **No grouping.**

---

## 4. Toolbar & adding elements

- Element tools (MVP set): `text`, `screenshot`, `device-frame`, `shape`. Clicking a tool inserts
  the element at the centre of the active screen (insert-on-click, not drag-to-draw — simpler).
- Zoom controls: fit / 100% / zoom in-out.
- Export button opens a dialog (platform / device / locale) and produces **the same result as the
  CLI `export`** — one export path, not two.
- The toolbar does **not** edit background; background is an artboard property and lives in the
  inspector (§5).

---

## 5. Inspector (contextual, per type)

Always shows the shared element base when an element is selected: `x, y, width, height, rotation,
opacity, locked, visible`. Type-specific fields below it:

- **No selection** → active **artboard** properties: artboard size (read-only) and background
  (`solid | gradient | image`). Background editing lives here, not in the toolbar.
- **`text`** → content, fontFamily, size, weight, lineHeight, letterSpacing, align, color, shadow.
  *(pending Phase 0 — see §9.)*
- **`screenshot`** → assetUrl, fit (cover/contain), crop, cornerRadius.
- **`device-frame`** → deviceType, frame color, screen slot.
- **`shape`** → kind (rect/ellipse/blob), fill (solid/gradient), stroke, radius.

---

## 6. Save / load / export

- **Save / load** read and write `app-store-screenshots.json` through the `core` `StorageAdapter`.
  Load runs strict Zod validation and pure `v1→v2→…` migrations.
- **Export** from the UI uses the same `core` path as the CLI: alpha channel stripped, sizes from
  `store-specs.json`, zip bundles by platform/device/locale. The UI export button and `cli export`
  must meet the Phase 0 parity exit criterion — exact target dimensions, no alpha channel, and a
  visual diff within tolerance (*not* byte-identical; PNG metadata/compression may differ). See
  `architecture.md` §2.

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
- **Themes UI, fonts-management UI, locales / RTL** — Phases 3–4.
- **Connected canvas** (elements crossing artboards, crop export) — **Phase 6**. This is the
  project's primary scope-creep risk and directly compounds the render/export parity risk that
  Phase 0 must retire first. Not before Phase 0 passes.

---

## 9. Open assumptions (pending Phase 0)

The parity spike may move some UI decisions; these are intended, not locked:

- **Font / text inspector (§5).** Which fonts and text options are safe to expose depends on what
  renders identically across the UI and headless export. Text is the hardest parity case
  (`architecture.md` §5), so the exact text-inspector surface is confirmed after the spike.
- Any inspector control whose result depends on cross-renderer fidelity is provisional until the
  parity exit criterion holds.
