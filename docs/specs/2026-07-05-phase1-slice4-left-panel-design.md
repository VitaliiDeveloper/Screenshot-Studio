# Phase 1 Slice 4 — Left panel (Screens + Layers)

Design spec. Deliberately short (see RULES: no heavier than the task needs).
Contract wins: `docs/architecture.md` and the Zod schema.

## Goal & risk retired

Add the editor's left panel: a **Screens** section and a **Layers** section. The risk this
slice retires is **array order as the single shared ordering source**:

- **Layers → z-order is live today.** `renderScreen` iterates `screen.elements` in array
  order (later draws on top), so a layer reorder changes the exported PNG immediately.
- **Screens → source-of-truth order.** The panel writes screen order into `project.screens`
  (the JSON SoT). The multi-screen numbered bundle that *consumes* that order is a **Phase 2**
  feature — Slice 4 does not add a live multi-screen export, and must not claim one. Today's
  CLI still exports one screen by `--screen` / `screens[0]`.

## Scope

In: for **screens** — select active, dnd-kit reorder, add (duplicate active), delete. For
**layers** (active screen only) — select, dnd-kit reorder (z-order), lock, hide, rename, delete.

Out (deferred, no duplicate builds): element **insertion** → Slice 5 toolbar (needs a type
picker + default geometry). Grouping, snapping, undo/redo UI, inspector → later phases. Screen
add via device picker → CLI `screen add` owns that surface.

## Schema change (additive, parity-safe)

Add `name: z.string().optional()` to `elementBase` in `packages/core/src/model/schema.ts`.
Additive optional on a `.strict()` object: existing v1 JSON stays valid, **no migration**. The
field is metadata only — the render/export map never reads it, so parity is untouched. Layers
display `element.name ?? typeLabel(element.type)`.

## Store (`apps/web/lib/editor-store.ts`)

All mutations stay Immer patches; the store stays **persistence-free** (its day-0 contract).
New actions:

- `selectScreen(id)` — set `activeScreenId`, clear `selectedId` (selection is per-screen).
- `reorderScreens(fromIndex, toIndex)` — `arrayMove` on `project.screens`.
- `addScreen()` — deep-clone the active screen with fresh `id`s (screen + every element),
  append it, make it active.
- `removeScreen(id)` — **no-op if it is the only screen** (schema `screens.min(1)`); if the
  active screen was removed, activate a neighbor.
- `reorderElements(fromIndex, toIndex)` — `arrayMove` on the active screen's `elements`.
- `removeElement(id)`.
- Widen `patchElement`'s `ElementPatch` to also accept base fields `locked | visible | name`
  (it already `Object.assign`s by id) — powers the lock/hide toggles and rename.

## Persistence

Reuse today's pattern: a small `mutateAndSave(action)` wrapper that runs the store action then
`saveProject(getState().project)`. No `subscribe(saveProject)` inside the store file — keeps
store unit tests free of the network layer and keeps the diff small.

## Components (`apps/web/components/`)

Two-column layout in `app/editor/page.tsx`: fixed-width `LeftPanel` + existing `EditorStage`.

- `LeftPanel` — hosts the two sections; plain Tailwind + dnd-kit sortable (no shadcn yet).
- `ScreensSection` — sortable rows (name + device label), active row highlighted, click =
  `selectScreen`, per-row delete with a **confirm dialog** (disabled on the last screen),
  `+ Add screen` button.
- `LayersSection` — sortable rows for the active screen, **rendered top-of-list = front-most
  (`[...elements].reverse()`)** per layers-panel convention; each row: drag handle, name
  (double-click → inline rename), eye toggle (visible), lock toggle, delete; click = `select`
  so panel and canvas selection stay in sync.

New deps: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`.

## Testing (light)

- **Store units (Vitest):** reorder screens/elements; `addScreen` (fresh ids, appended,
  active); `removeScreen` (last-screen no-op, active reassigned); `removeElement`; lock/hide/
  rename patch.
- **Index-mapping test:** a drag from **visual-top to visual-bottom** in the reversed layers
  list yields the correct `elements` array order (reversal bugs live in the component, not the
  store).
- **e2e:** keep `load-drag-save` green; add a light reorder-a-layer → assert persisted order.
- Schema touch is additive/non-rendering; a render/export parity gate run confirms output is
  unchanged.
