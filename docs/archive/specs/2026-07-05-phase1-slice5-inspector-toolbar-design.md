# Phase 1 Slice 5 — Inspector + toolbar

Design spec. Contract wins: `docs/architecture.md` and the Zod schema. This is the **last
Phase 1 slice**; it completes the web-editor basics (inspector, insert tools, zoom).

## Goal & risk retired

Add the editor's **right-hand inspector**, a **toolbar** (insert-on-click + zoom), and a
**no-selection artboard/background editor**. Risk is **low**: nothing here touches the shared
`elementToNodeConfig` map, so render/export parity is untouched by construction. The one thing
to hold the line on is that **zoom is view state** — it must never enter the store or the
project JSON, and must not change export output.

The roadmap's "sits on the store" undersells the store work: the inspector needs a much wider
`ElementPatch` and two brand-new no-selection actions (`patchBackground`, `patchArtboard`)
that have no code path today. Those are speced below.

## Scope

In:
- Toolbar inserts **`text` + `shape` only** (asset-free). `screenshot`/`device-frame` are
  *not* insertable from scratch — they have a required `assetUrl` and there is no
  asset-browser UI in the repo. They stay editable in the inspector (free-text `assetUrl`)
  when already present in JSON. All four types remain usable (Slices 2–3 render/edit them).
- Full per-type inspector for a selected element; no-selection artboard + background editor.
- Zoom controls (in/out/reset), zoom as local view state.

Out (deferred, no duplicate builds): asset-listing route + picker (only insert-from-scratch of
asset types would need it) → later. Grouping, snapping, undo/redo UI, themes, templates,
locales/RTL → later phases. `lock`/`hide` toggles stay in the Layers panel (Slice 4) — the
inspector does not duplicate them.

## Schema change

**None.** Every field the inspector edits already exists in the schema (Slice 1–4). No new
element types, no migration, schema stays v1.

## `core` — insert factories (new, DRY)

`packages/core/src/model/factories.ts`: `createTextElement()` and `createShapeElement()`
return **schema-valid** elements with a fresh `crypto.randomUUID()` id and sensible default
geometry (a reasonably sized box near the artboard centre; callers may pass an origin). Every
required field with no Zod default is set explicitly (text: `content`/`fontFamily`/`size`/
`color`; shape: `kind: "rect"`/`fill`). These live in `core`, not the toolbar component, so a
future CLI `element add` (Phase 2+) shares the exact same defaults — hardcoding them in the UI
would be a DRY violation. Exported via the `model` entrypoint.

- **Unit test:** each factory's output passes `Element` Zod parse.

## Store (`apps/web/lib/editor-store.ts`)

All mutations stay Immer patches; the store stays persistence-free (its day-0 contract).

- **Widen `ElementPatch`.** Today it is a narrow `Pick<TextElement, …>` that omits even
  `opacity`. Widen it to cover every editable field across the four types:
  - base: `opacity` (plus the existing `x|y|width|height|rotation|content|locked|visible|name`)
  - text: `fontFamily | size | weight | lineHeight | letterSpacing | align | color`
  - shape: `fill | radius`
  - screenshot: `assetUrl | fit | cornerRadius`
  - device-frame: `assetUrl | fit`

  Modelled as a `Partial<…>` of the union of these fields. `patchElement` keeps its blind
  `Object.assign` by id — so the **inspector** is responsible for only ever sending
  type-valid fields (it narrows on `element.type` before dispatching). Same contract that
  already governs `patchElement`; the store does not guard field/type validity.
- **`patchBackground(patch: { color: string })`** — set the active screen's
  `background.color`. New path: `patchElement` only walks `screen.elements`, so backgrounds
  have no editor today.
- **`patchArtboard(patch: { width?: number; height?: number })`** — set the active screen's
  `artboard.width/height` (positive ints per schema).
- **`addElement(element: Element)`** — append a ready-made element (from a factory) to the
  active screen's `elements` and set `selectedId` to it.

## Persistence

Reuse the established pattern: dispatch the store action (live canvas), then `saveProject`.
Because inspector inputs fire rapidly (opacity slider, typing into a text field), **the
persist call is debounced (~300 ms)** while the store patch stays immediate — the canvas
updates on every keystroke, the disk API is not spammed. (EditorStage's per-gesture
`commit` already persists immediately for drag/transform end; that stays as-is — debouncing
targets the high-frequency inspector inputs.)

## Components (`apps/web/components/`)

Plain Tailwind, consistent with Slice 4 (no shadcn yet).

- **Field primitives** (small, reusable): `NumberField`, `ColorField`, `SelectField`,
  `TextField`. One focused module so the inspector body stays readable.
- **`Inspector`** — right sidebar (`w-64`, `border-l`), mirroring `LeftPanel`.
  - **Element selected** → a **Transform** section (`x`, `y`, `width`, `height`, `rotation`,
    `opacity`) + a per-type section:
    - text: `content` (textarea), `fontFamily`, `size`, `weight`, `lineHeight`,
      `letterSpacing`, `align`, `color`.
    - shape: `fill`, `radius`.
    - screenshot: `assetUrl` (text), `fit` (select), `cornerRadius`.
    - device-frame: `assetUrl` (text), `fit` (select); `deviceType` shown read-only (iphone).
  - **No selection** → **Artboard** (`width`, `height`) + **Background** (`color`).
- **`Toolbar`** — a bar above the stage: `[+ Text]` `[+ Shape]` (→ factory → `addElement`) and
  zoom `[−] {pct}% [+] [Reset]`.

## Zoom (view state — never persisted)

Zoom lives in **local React state** in the stage area, never in the store or JSON, and must
not affect export. Implementation: Konva `Stage scaleX/scaleY={zoom}` with
`width/height = artboard * zoom`, so pointer hit-testing and the Transformer stay correct at
any zoom. Reset returns to 100%.

## Layout (`app/editor/page.tsx`)

Three columns: `LeftPanel │ (Toolbar + EditorStage) │ Inspector`. The middle column keeps the
existing `overflow-auto` scroll region so a zoomed-in artboard can scroll.

## Testing (light)

- **Store units (Vitest):** `patchBackground`; `patchArtboard`; `addElement` (fresh id,
  appended, becomes `selectedId`); widened `patchElement` for a sampling of type fields
  (`fill`, `color`, `fit`, `cornerRadius`).
- **Factory units:** `createTextElement`/`createShapeElement` output passes `Element` parse.
- **e2e (extend existing):** insert a shape → assert it persists; edit an element colour →
  assert the persisted JSON reflects it.
- **Parity:** inspector/toolbar/zoom never touch `elementToNodeConfig`; a render/export parity
  gate run confirms output is unchanged.
