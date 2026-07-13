# Phase 3.6 — Editor Workspace Foundation

## Goal

Turn the polished Phase 3 editor shell into a scalable creative workspace before locale work
begins. The accepted visual target is the second Phase 3.6 concept
(`exec-fd6faee2-a840-41fb-bae3-0b902846fa9e.png`): a compact permanent tool rail, a
collapsible contextual shelf, an overview of isolated artboards, a quiet grid canvas, and a
canvas-owned zoom dock. The implementation also adopts the third concept's compact navigation
and collapsible side panels.

This phase changes editor presentation and interaction state only. Project JSON, strict schema,
render node mapping, persistence APIs, export orchestration, and UI/CLI pixel parity remain
unchanged.

## Product outcomes

- A narrow viewport never places zoom controls below or behind the inspector.
- `Focus` keeps the current one-artboard editing workflow; `Overview` shows every screen in
  export order on one shared viewport without turning them into a connected canvas.
- `Ctrl`/`Cmd` + wheel and trackpad pinch zoom around the pointer. Hand mode and Space-drag pan
  the scrollable viewport. Toolbar zoom remains available and gains `Fit`.
- The permanent rail stays small. Structure, resources, and creation live in one collapsible
  contextual shelf rather than accumulating top-toolbar buttons.
- `Add` is a searchable catalog grouped by Basic, Media, Frames, and Library. Shipping entries
  remain honest: text and shape insert now; asset-bearing entries describe the missing asset
  picker instead of creating invalid elements; Templates opens the existing library.
- The canvas background is editor chrome only and supports `Dots`, `Grid`, and `None`. It never
  reaches project JSON or export.
- The dogfood project demonstrates three realistic, independently editable/exportable screens.

## Invariants

1. **Isolated artboards remain the model.** Overview is a workspace projection over
   `Project.screens`; it introduces no cross-artboard element coordinates or schema fields.
2. **One renderer remains the source of truth.** Every artboard, in either view, renders elements
   through `elementToNodeConfig`. Workspace transforms wrap the stage and never alter render
   props.
3. **Exactly one active screen.** It owns Layers, insertion, selection, inspector content, and
   keyboard editing. Clicking another overview artboard selects that screen first.
4. **Workspace state is ephemeral.** View mode, active tool, open shelf, inspector visibility,
   canvas pattern, zoom, and pan do not persist in project JSON.
5. **Existing persistence boundaries stay intact.** Project mutations still flow through the
   editor store and `mutateAndSave` / `mutateAndScheduleSave`.

## Visual system extracted from the accepted concept

- **Palette:** true white chrome; `slate-50` canvas; cool `slate-200` dividers; `slate-950`
  primary text; blue `#2563eb` for selected tools, active artboards, and Export.
- **Typography:** Inter/system sans; 12–13px editor controls, 10px uppercase section labels,
  14px panel titles, and 16px product/project identity. Controls use explicit weights and line
  heights rather than inherited browser defaults.
- **Geometry:** 56px top bar, 56px permanent rail, 280px contextual shelf, 288px inspector,
  8–12px control radii, hairline borders, and restrained shadows only for floating/drawer
  surfaces.
- **Canvas:** subtle 16px dots by default, optional 24px square grid, no exported pattern.
- **Icons:** the existing Lucide family at 16–18px with consistent 1.8–2px stroke weight.
- **Container model:** rails, panels, and an open canvas. No nested dashboard cards.

## Workspace anatomy

### Top bar

Product identity and project name sit left; the `Focus / Overview` segmented control and Inspect
toggle sit in the center/right; Export remains the only blue primary action. Resource management
moves to the Resources shelf to keep the header stable as the element catalog grows.

### Permanent tool rail

- Select — normal element interaction.
- Hand — persistent pan tool.
- Structure — opens Screens + Layers.
- Resources — opens Fonts, Themes, and Templates.
- Add — opens the searchable creation catalog.

Only one contextual shelf is open at a time. Clicking the active rail item collapses it. At
compact breakpoints the shelf overlays the canvas; on wider screens it occupies a grid column.

### Contextual shelves

- **Structure:** Screens keep export-order drag/reorder and use compact previews from the shared
  renderer. Layers show typed rows for the active screen only and keep element drag/reorder as
  z-order. The active screen name in the Layers header provides context without duplicating the
  complete Screens list or introducing grouping/schema fields.
- **Resources:** entry points to the existing Fonts, Themes, and Templates dialogs.
- **Add:** catalog-driven entries and filtering. The catalog is a typed module so future schema
  types add metadata and an action without restructuring the shell.

### Inspector

The existing contextual inspector remains authoritative. It gains an explicit header and close
control, occupies a stable desktop column, and becomes an overlay drawer when horizontal room is
tight. The canvas and zoom dock never render underneath its grid column.

## Canvas interaction model

- Zoom range stays `25%…400%`.
- `Ctrl`/`Cmd` + wheel or pinch updates zoom around the pointer.
- `+` / `−` update zoom around the viewport center.
- `Fit` computes either the active artboard or the complete overview bounds with safe padding.
- Hand mode or holding Space changes the cursor and drag-scrolls the viewport.
- Plain wheel/trackpad scroll keeps native two-axis canvas navigation.
- `Focus` renders only the active stage and preserves selection/editing.
- `Overview` lays screens left-to-right in export order. The active artboard is editable and
  outlined; inactive artboards are visible, labelled, and become active when clicked.

## Responsive contract

- `>= 1280px`: rail + optional shelf + canvas + open inspector.
- `960–1279px`: rail + canvas; shelf and inspector are mutually independent overlay drawers.
- `< 960px`: compact top-bar labels, rail remains available, overlays use bounded viewport width,
  and the canvas keeps at least a useful editing column with no horizontal page overflow.
- The bottom zoom dock is positioned relative to the canvas viewport, never the browser window.

## Demo project

The project-local dogfood sample grows to three Apple/iPhone screens in export order: Hero,
Save Fast, and Stay Organized. It uses only enforced v1 elements and registered project fonts.
At least one screen demonstrates a device frame/screenshot asset; the others demonstrate strong
headline, supporting copy, shape composition, and varied layout. No target-schema-only element is
introduced.

## Slices

1. **Responsive workspace shell.** Top bar, permanent rail, shelves, inspector drawer, and
   canvas-owned zoom dock.
2. **Viewport interactions.** Focus/Overview, pointer-centred zoom, pan, Fit, and patterns.
3. **Extensible Add catalog.** Search/grouping, valid text/shape insertion, honest asset-gated
   entries, and Template library bridge.
4. **Three-screen dogfood demo.** Realistic v1 project content and assets.
5. **Closure.** Targeted tests, responsive/browser/design QA, docs truth, and parity regression.

## Accessibility intent

Every rail and toolbar action has an explicit accessible name and visible focus. Selected tool,
open panel, active view, and active artboard use more than color alone. Disabled catalog entries
remain readable and explain why they cannot insert. Drawer controls preserve keyboard access and
Escape closes transient surfaces. Reduced-motion preferences disable non-essential transitions.

## Verification

- Unit-test viewport math and catalog filtering/action metadata.
- E2E-test Focus/Overview switching, screen activation, Add insertion, pattern choice, zoom by
  controls and modified wheel, pan, Fit, and compact-panel behavior.
- Re-run existing editor persistence, left-panel ordering, inspector, fonts, themes, templates,
  and UI/CLI parity gates.
- Check desktop at the accepted concept viewport and compact widths with Browser/IAB; inspect
  console errors and the core interaction path.
- Compare the accepted concept and latest implementation screenshot in one visual QA pass and
  record the result in `design-qa.md`.

## Out of scope

Connected canvas, cross-screen elements, grouping, multi-select, snapping/smart guides,
undo/redo history, schema widening, an asset browser/uploader, new renderable element types,
dark mode, and Phase 4 locale/RTL behavior.
