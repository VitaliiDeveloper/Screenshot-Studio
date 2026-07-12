# Phase 1 · Slice 1 — Interactive canvas + render-reuse

Design spec. Version 1.0, 4 July 2026.

This is **slice 1 of 4** in the Phase 1 decomposition (`docs/roadmap.md` §3a). It is scoped to
retire the single highest Phase 1 risk and nothing else. Read `docs/architecture.md` §2 (parity)
and `docs/editor.md` before implementing; where this spec and those disagree, they win.

---

## 1. Goal — the thesis this slice retires

Phase 0 proved *"one JSON → identical pixels in the UI `/render` route and the CLI export."*
Phase 1's unproven equivalent, and the thing this slice exists to prove:

> **An interactive editor can share the single render path without forking it.**

`renderScreen` today builds one static, non-interactive layer (`Konva.Layer({ listening: false })`)
purpose-built for export. The editor needs the opposite: a listening stage, a `Transformer`,
drag/resize/rotate, inline text editing, pan/zoom. The failure mode this slice must prevent is a
**second react-konva tree** growing beside the export renderer — `docs/editor.md` §5 is explicit:
"the Phase 1 export button must later reuse `<RenderStage>`, never a parallel react-konva tree."

The slice succeeds when interactive editing and static export are provably driven by **one**
element-rendering source of truth, and the Phase 0 parity gate still passes unchanged.

---

## 2. Scope

**In (only what proves the thesis):**

- A scrollable canvas showing one **active screen** (the project's first screen) at 1:1.
  **Stage-level pan/zoom gestures (wheel-zoom, space-drag pan) are deferred** — they do not serve
  the render-reuse thesis and add interaction surface that competes with the transform proof.
  Scroll/overflow is enough to view the full artboard in this slice.
- Selection → Konva `Transformer` with move / resize / rotate. **Single-select** only.
- Inline `text` editing on double-click.
- Only the element types already in the schema: `text` and `shape`. **The Zod schema is not
  touched.**
- A Zustand + Immer **patch store**. This is the day-0 immutable-state requirement
  (`roadmap.md` §1); it makes undo/redo possible later. **No undo/redo buttons ship in this slice.**
- Save / load through a disk-backed **Next API route** (§5) reading and writing the same
  `app-store-screenshots.json` the CLI and `/render` use.
- The export path continues to run through the existing `/render` + `renderScreen` route; its
  pixels do not change.

**Out (later slices / phases — listed so the canvas choice does not quietly drag them in):**

- Left panel (Screens + Layers) — Slice 3.
- Full per-type inspector, no-selection background editor, toolbar element tools — Slice 4.
- `screenshot` / `device-frame` types and the `v1→v2` schema migration — Slice 2.
- Stage-level pan/zoom gestures (wheel-zoom, space-drag pan) — a focused follow-up; the view is
  scrollable in this slice.
- Marquee multi-select, snapping / smart guides, element grouping — later phases.
- Undo/redo **UI**, themes, templates, locales / RTL — later phases.

**Chosen defaults** (decided during brainstorming; documented so they can be revisited):

- **No inspector or toolbar in this slice.** Two-way store↔canvas binding is proven by the
  Transformer (geometry) and inline text edit (content) alone — a dedicated properties panel is
  not needed to retire the thesis. Editing color/font/etc. arrives with the Slice 4 inspector.
- **Single-select, not marquee.** `editor.md` §2 lists marquee as "in (simple)", but a single
  selection is sufficient to exercise the Transformer→store loop; marquee is deferred.
- **No `packages/ui` yet.** Editor components live in `apps/web` until a second consumer exists
  (Slice 3/4). Creating the package now is premature (YAGNI); `architecture.md` reserves it.

---

## 3. Architecture & components

Isolated units, each with one purpose and a defined interface.

1. **`core/engine` · `elementToNodeConfig(element)` — the single source of truth.**
   A pure function mapping an `Element`'s props to the Konva node config object. `renderScreen`
   is refactored to build nodes from it (`new Konva.Text(elementToNodeConfig(el))`); the editor
   stage feeds the *same* config into react-konva (`<Text {...elementToNodeConfig(el)} />`). One
   map, two thin construction sites. `renderScreen`'s output pixels are unchanged — guaranteed by
   the Phase 0 parity gate (§7). This lives in `core` (framework-agnostic) so both the imperative
   export renderer and the React editor depend on it, not on each other.

2. **UI stack scaffold (`apps/web`, greenfield).** Tailwind CSS, Zustand + Immer, react-konva.
   This is prerequisite plumbing — `apps/web` is currently only the `/render` host (next + konva +
   react). Kept in `apps/web`, not a new package (see §2 defaults). **shadcn/ui is deferred** to the
   first slice that renders a panel/dialog/select (Slice 3): this slice has no such component, and
   installing it now is scaffolding with zero consumers (YAGNI).

3. **`editorStore` (Zustand + Immer).** Holds `{ project, activeScreenId, selectedId }`. Actions:
   `load(project)`, `select(id | null)`, `patchElement(id, partial)`, `save()`. Every mutation is
   an Immer producer, so each change is a discrete patch — the structural basis for undo/redo
   without a rewrite. The store is the only writer of project state; the canvas dispatches actions,
   it never mutates the project directly.

4. **`EditorStage` (react-konva).** Renders the active screen's background and elements via
   `elementToNodeConfig`, overlays a `Transformer` bound to `selectedId`, and wires interaction:
   `onClick` → `select`; Transformer `transformend` / `dragend` → `patchElement` with the new
   geometry; double-click on a `text` node → inline edit → `patchElement({ content })`. Pan/zoom is
   stage-level (scale + position), not persisted to the project (it is view state, not document
   state).

5. **API route `app/api/project/route.ts` (GET / PUT).** Wraps `LocalFileStorageAdapter` server-side
   (it is `node:fs` and cannot run in the browser). GET returns the parsed project; PUT validates
   the incoming body with the same strict `core` loader before writing — an invalid project is
   rejected, never written. The project path resolves the same way `/render` resolves `?project=`
   (query/env), consistent with the existing dev-only, self-hosted local-file model.

---

## 4. Data flow

```
canvas interaction → store action → Immer patch → react-konva re-render (elementToNodeConfig)
                                                 → PUT /api/project → disk JSON
```

Export is unchanged and shares the same map:

```
disk JSON → /render → renderScreen (elementToNodeConfig) → Stage.toDataURL → PNG
```

One `elementToNodeConfig`, two constructors (`new Konva.*` for export, JSX for the editor). That
shared map *is* the thesis.

---

## 5. Error handling & states (`editor.md` §7)

- **Invalid JSON on load** (GET parse fail, or PUT rejected by the validator) → a blocking error
  surfacing the validator message. Never render or persist an invalid project.
- **Empty project / missing asset** — out of this slice (there is no `screenshot` type yet, and
  the sample fixture already ships `text` + `shape` elements to edit).

---

## 6. Interfaces (contracts between units)

- `elementToNodeConfig(element: Element): Konva<T>Config` — pure, no side effects, deterministic.
- `editorStore` actions as in §3 — the canvas depends on these, not on store internals.
- `GET /api/project → Project` · `PUT /api/project(Project) → 200 | 4xx{message}` — the browser's
  only persistence channel; it depends on this shape, not on `LocalFileStorageAdapter`.

Someone can understand each unit without reading the others' internals; the mapper's callers can
change (add a new construction site) without changing the mapper.

---

## 7. Testing

- **Parity regression (non-negotiable gate).** The existing Phase 0 parity e2e
  (`e2e/parity.test.ts`) must pass **unchanged** after `renderScreen` is refactored onto
  `elementToNodeConfig` — this is the proof that export pixels did not shift. Any drift here blocks
  the slice.
- **Unit — `elementToNodeConfig`.** Prop mapping for `text` and `shape` (weight→fontStyle,
  radius→cornerRadius, opacity/rotation, etc.).
- **Unit — `editorStore`.** `patchElement` and `select` produce the expected next state; mutations
  are patches, not in-place edits.
- **e2e (Playwright, already in the stack).** load → drag an element → save → reload preserves the
  new position. Light; proves the full store↔canvas↔disk loop end to end.

---

## 8. Definition of done

- `elementToNodeConfig` exists in `core/engine`; `renderScreen` uses it; parity e2e passes
  unchanged.
- The editor stage renders the sample project, supports select/move/resize/rotate + inline text
  edit, all mutations flow through the Immer patch store, and save/load round-trips through the API
  route to the same on-disk JSON.
- No second react-konva rendering path exists; export still goes through `/render`.
- Unit + e2e tests above are green. Out-of-scope items (§2) are absent, not half-built.
