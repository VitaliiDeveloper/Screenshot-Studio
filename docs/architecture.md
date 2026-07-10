# Architecture & Technical Contract

How the system is built and the contracts everything agrees on: tech stack, core/shell
split, render/export parity, data model & schema, store export spec, fonts, the management
interface (CLI + conventions + `AGENTS.md`), and design guardrails.

Version 0.6, 10 July 2026.

---

## 1. Tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| Render engine | **Konva.js / react-konva** | Object model, layers, transforms, pixel-correct export via `pixelRatio` |
| UI framework | Next.js (App Router) + React + TypeScript | Dev server, routing, easy self-host |
| Styling | Tailwind CSS | Speed, consistency |
| Components | Shared local workbench primitives + Lucide | Inspector, dialogs, selects, menus, tooltips |
| State | Zustand (+ Immer) | Light editor store with bounded project history and transient workspace state |
| Export (UI) | `Stage.toDataURL({ pixelRatio })` + JSZip | Exact-size PNGs, zip bundle |
| Export (CLI / headless) | **Playwright** (recommended) renders the same web stage | Pixel parity with the UI by construction — see §2 |
| Fonts | Browser FontFace API | Deterministic file-backed Google/custom registration |
| Screen reorder | dnd-kit | Reordering screens in the sidebar |
| Schema & validation | **Zod** | Versioning, migrations, a strict validator (the AI contract) |
| Specs & tests | **`store-specs.json` + Vitest** | Store sizes as data, not hardcode; export dimension tests |

**Requirements:** Node.js 22.13+ and pnpm 11.10.0 (through Corepack).

---

## 2. Architecture: core + shell, and the parity decision

Monorepo (pnpm workspaces or Turborepo) with a clear boundary. The split is for modularity,
testability, and ease of contributions — not for monetization.

```
screenshot-studio/
├── packages/
│   ├── core/            # framework-agnostic core
│   │   ├── model/       # types, project schema, migrations (Zod)
│   │   ├── engine/      # Konva render, elements, transforms
│   │   ├── export/      # render to exact sizes, zip bundle
│   │   ├── fonts/       # font load/registration + embedding
│   │   └── storage/     # StorageAdapter interface + local implementation
│   ├── ui/              # RESERVED (not yet created): reusable React editor components —
│   │                    #   editor components live in apps/web until a second consumer exists
│   └── cli/             # CLI: init, dev, screen, locale, font, theme, import, export
├── apps/
│   └── web/             # Next.js: self-hosted editor
├── AGENTS.md            # instructions for the CLI agent (conventions, schema, commands)
└── skill/               # RESERVED (not yet created): thin installer for use outside the repo
```

CLI and `AGENTS.md` are the primary management interface (for humans and agents). `cli`
uses `core` for schema, project state, and export orchestration, but delegates the actual
pixel rendering to the web renderer running in a headless browser (see §2) — so UI and CLI
share one rendering path, not two.

`core` depends on Konva and Zod and knows nothing about Next.js or the network. Storage
access goes through an interface (so the community can add their own: browser FS,
IndexedDB, etc.):

```ts
interface StorageAdapter {
  load(projectId: string): Promise<Project>
  save(project: Project, projectId: string): Promise<void>
  putAsset(bytes: Uint8Array): Promise<{ url: string; hash: string }>
}
```

Ships with `LocalFileStorageAdapter` (writes JSON + assets to disk, like the reference).

### Render / export parity — the #1 technical risk

The claim "one JSON renders identically in UI and CLI" is **not free** and must be proven,
not assumed. In the browser Konva draws on a real `<canvas>`. For headless/CLI export there
are two paths:

- **A — Headless browser (Playwright) renders the same web stage (recommended).** Parity is
  guaranteed *by construction* because it is literally the same rendering code and font stack;
  `core` handles schema/project/export orchestration and hands the pixel rendering to the web
  renderer. Cost: a heavier dependency for the CLI.
- **B — `node-canvas` (Cairo) + Konva.** Lighter, but parity is *not* guaranteed — Cairo
  differs from the browser in text rendering, font hinting, and layout, so the UI and CLI
  outputs would drift (text most of all) and need constant chasing.

**Decision: pursue A.** Make this the Phase 0 spike (see roadmap.md). The exit criterion is
*not* byte-identical output — PNG metadata and compression can differ on identical images.
Instead: from the same project JSON, the UI export button and `cli export` produce a PNG with
**exact target dimensions, no alpha channel, and a visual diff within tolerance**. Until that
holds, building the editor on top is premature.

---

## 3. Data model & schema

A single JSON file is the source of truth — git-trackable and reproducible. A **strict Zod
schema + validator** is foundational: it underpins determinism, migrations, and the AI
contract (the agent edits this JSON, so it must be impossible to write an invalid one
silently).

```
Project
├── meta: { name, appIcon, schemaVersion }
├── mode: isolated | connected
├── platforms: ["apple", "android"]
├── locales: ["en", "de", "ar"]            # derived from screens
├── fonts: FontAsset[]                     # google / uploaded files under assets/fonts/
└── screens: Screen[]
    ├── id, name, platform, device, locale, direction
    ├── artboard: { width, height }        # slide size
    ├── background: Background              # solid | gradient | image
    └── elements: Element[]                # z-order = array order
```

**Element types** — a shared base (`id, type, x, y, width, height, rotation, opacity,
locked, visible, role?`) plus type-specific fields:

- `text` — content, fontFamily, size, weight, lineHeight, letterSpacing, align, color, shadow
- `screenshot` — assetUrl, fit (cover/contain), crop, cornerRadius
- `device-frame` — deviceType (iphone/ipad/android-phone/tablet), frame color, screen slot
- `shape` — rect / ellipse / blob, fill (solid/gradient), stroke, radius
- `icon` — built-in icon set / SVG
- `badge` — rating, "As seen on", store badges
- `image` — arbitrary decorative image

**Themes are baked inputs, not render state.** Strict definitions live in `themes/*.json`.
`applyTheme(project, theme)` rewrites the existing literal text/shape fields selected by an
optional role (`heading | body | accent | surface`) and preserves that role for later re-apply.
Elements without a role opt out. Theme files never enter `Project`, and the renderer never
resolves tokens or ids; unknown/invalid theme data fails before a project is written.

**Templates are screen inputs, not render state.** Strict definitions live in `templates/*.json`
and contain an exact platform/device/artboard plus ordinary background and element literals.
Instantiation injects the chosen locale and its persisted direction, creates fresh screen/element
ids, recomputes manifests, and writes an ordinary `Project`. Template geometry is authored as LTR;
an RTL target bakes mirrored placement/alignment exactly once before persistence. Render and export
never read template files.

**Locale sets are ordinary screens, not a parallel model.** `Project.locales` is a duplicate-free
derived manifest whose set is exactly the locale strings used by `screens`; locale identifiers stay
free-form and comparisons are exact. Cloning a locale appends fresh-id copies of its screens in the
same relative order and shares existing asset paths. The copies are independent after creation —
there is no persisted source/translation pairing id in the render contract.

The editor derives its active locale from the active screen rather than storing a second selection.
Screens and Overview project only that locale; locale-scoped reorder changes those screens' slots
without disturbing another locale's relative order. The locale manager delegates clone, direction,
and removal to the same pure core operations used by the CLI. Editor chrome remains LTR.

**RTL direction is explicit, not inferred from locale.** Every screen stores
`direction: "ltr" | "rtl"` (legacy v1 files migrate to v2 isolated and default to `ltr`), and all screens in one locale
must agree. Changing direction bakes horizontal placement (`x' = artboard.width - x - width`) and
physical `left ↔ right` text alignment into JSON while preserving media pixels and rotation. The
shared `elementToNodeConfig(element, { images, direction })` mapper sends the stored direction to
Konva text in both the editor and headless renderer; geometry is never mirrored at render time.
Inline editors inherit the screen direction, and new text uses physical right alignment in RTL.
Templates remain LTR-authored inputs and are baked once when instantiated into an RTL locale.

**Versioning.** `schemaVersion` + pure migration functions `v1→v2→…` run on load. Additive,
optional fields such as `role` keep the current version; structural changes require a migration.

**Connected canvas — v2 render/export contract (Phase 6 Slice 1).** `Project.mode` is one explicit
project-level `isolated | connected` choice. Valid v1 input migrates without pixel changes to v2
`isolated`. In connected mode, screens with the same exact `platform/device/locale` form a gapless,
top-aligned strip in project order; each origin is the cumulative width of earlier group screens.
Elements remain in their owner screen with owner-local coordinates. The shared renderer paints all
group backgrounds first, then visible elements by screen order and element-array order, translated
against the requested screen origin. `renderScreen` still returns a stage at exactly the requested
artboard dimensions, so the stage itself is the precise UI/CLI export crop — there is no stitched
PNG or post-export slicing path. Phase 6 Slice 3 adds one gapless editable group stage on the same
`elementToNodeConfig` mapper: screen-offset Groups preserve owner-local transforms, composite
screen/element selection disambiguates duplicate ids, and Focus reuses the projection as an exact
non-interactive crop. Editor mode controls remain a later workspace-hardening concern.

**Editor history — Phase 6 Slice 4.** The Zustand store keeps at most 50 prior project snapshots in
memory. Consecutive patches for the same owner element, background, or artboard coalesce until an
explicit interaction boundary; structural mutations remain separate steps. Undo and redo preserve
only still-valid active/selected ids, clear the opposite branch after a new mutation, and travel
through the same durable project save path as ordinary edits. Loading a project or replacing it
after an external durable-resource operation resets history. Selection, viewport, dialogs, save
status, and guide chrome are transient and never enter project history or JSON.

**Editor snapping — Phase 6 Slice 5.** One dragged element derives rotation-aware bounds in the
active stage coordinate space. Candidate anchors come from the connected group bounds, each active
artboard, and visible non-zero-opacity elements; exact ties prefer element, then artboard, then
group targets in stable project order. The logical tolerance is `6 / zoom`, keeping the interaction
threshold at six screen pixels. Connected results translate back to the unchanged owner-local
coordinate. Vertical/horizontal guides are non-listening Konva lines updated through refs during
drag, cleared before persistence, and absent from the store, project schema, static renderer, and
export.

**Editor asset discovery — Phase 6 Slice 6.** `/api/assets` recursively lists regular PNG, JPEG,
and WebP files only under the project-root `assets/` and `screenshots/` directories, skips hidden
entries and symlinks, and returns stable portable relative paths. The Add picker creates only the
existing `screenshot` and `device-frame` schema members through core factories; insertion then uses
the ordinary history/save path and the same `collectImageUrls` / `loadProjectImages` cache used by
the static renderer. `/api/asset` checks both lexical and canonical real-path containment before
reading image or font bytes. The picker performs no upload, copy, delete, rename, external fetch, or
project replacement, and the future decorative `image` type remains outside v2.

**Connected workspace hardening — Phase 6 Slice 7.** One `workspaceScreenScope` derivation feeds
Overview/Fit and Screens: exact platform/device/locale group in connected mode, active locale in
isolated mode. Connected reorder rewrites only the visible group's existing project-array slots;
unrelated groups do not move. Layers stays active-owner scoped and labels that owner. Thumbnail
memoization compares every exact-group screen reference and projected order because a neighbour's
element can change the requested crop, while unrelated groups remain memoized. The toolbar mode
control delegates to the guarded core transition, reports refusal without adding history, and sends
successful changes through bounded history and durable save. Desktop and compact browser coverage
composes mode, boundary selection, thumbnails, history, snapping, media insertion, panels, Fit, and
keyboard dismissal without persisting workspace chrome.

---

## 4. Store export spec

Design at each platform's largest size, export by scaling down. UI export uses
`Stage.toDataURL` with the right `pixelRatio`; CLI export uses the same `core` through the
Phase 0 renderer. Both write bundle entries as
`platform/device/<safe-locale>/NN-<screen>-<size>.png`: the locale folder collision-safely encodes
the exact free-form identifier, filtering remains exact against the stored string, and `NN`
restarts inside each platform/device/locale group while preserving that group's relative project
order. The complete filesystem/ZIP batch is validated for containment and duplicate paths before
any output is written; existing symlinked ancestors/files are rejected and final files use
no-follow opens. Re-running export deliberately replaces regular files at the same generated
destinations; only in-batch collisions and redirecting filesystem objects are rejected.

The safe locale directory uses a fixed `locale-` prefix and an injective `~hhhh` escape for every
UTF-16 code unit outside lowercase ASCII letters, digits, `_`, and `-`; overlong segments fail
before rendering. Store-size ids remain exact data for lookup and receive the same portable escape
only at the filename sink, so custom specs stay compatible without introducing unsafe path bytes.

**"Scale down" holds per device, not across Apple's size list.** Apple's accepted iPhone
sizes differ slightly in aspect ratio (1320×2868 ≈ 0.4603, 1284×2778 ≈ 0.4622, …), so one
artboard cannot be scaled to all of them without distortion — `exportPixelRatio` rejects
aspect-ratio mismatches by design. Bundles therefore target **one lead size per device**
(Apple down-scales the lead size to smaller slots itself); the other accepted sizes remain
available as explicit opt-in targets. See roadmap.md §3 (Phase 2 carry-ins).

**Store sizes are data, not hardcode.** They live in **`store-specs.json`** with Vitest tests
asserting export output dimensions. Apple and Google change these over time, and Google in
particular defines *ranges* rather than single values — so a hardcoded table (the reference's
weak point) is brittle. In the tables below, the Apple values are *accepted sizes* Apple
publishes; the Google values are *recommended presets* within Google's allowed ranges. Either
way, `store-specs.json` is the runtime source of truth.

Also: **strip the alpha channel on export** — Apple requires flattened PNG/JPG with no alpha;
Google requires 24-bit PNG or JPEG with no transparency.

**Apple App Store** (PNG/JPG, RGB, no alpha, 1–10 images):

| Display | Portrait |
|---------|----------|
| 6.9″ iPhone (lead) | 1320 × 2868 (also accepts 1290×2796, 1260×2736) |
| 6.5″ | 1284 × 2778 |
| 6.3″ | 1206 × 2622 |
| 6.1″ | 1125 × 2436 |
| iPad 13″ | 2064 × 2752 |

Landscape swaps the dimensions (e.g. 2868×1320). Apple scales down to smaller slots itself.

**Google Play** — recommended presets (JPEG / 24-bit PNG, no transparency, up to 8 per type,
side 320–3840 px, max ratio 2:1; any size in range is valid):

| Device | Preset |
|--------|--------|
| Phone portrait | 1080 × 1920 |
| Phone landscape | 1920 × 1080 |
| 7″ tablet | 1200 × 1920 |
| 10″ tablet | 1600 × 2560 |
| Feature graphic | 1024 × 500 (exact) |

Android frames are CSS/Konva-rendered; iPhone uses a bezel mockup.

Sources: [Apple — Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications),
[Google Play — Add preview assets](https://support.google.com/googleplay/android-developer/answer/9866151).

---

## 5. Fonts (technical)

Two optional file-backed sources: **Google Fonts** and **custom upload**. Both materialize as
project-relative files under `assets/fonts/` (`.ttf/.otf/.woff/.woff2`) and are served through
the same local `/api/asset` route as screenshots. `FontAsset.source` records provenance
(`google` or `uploaded`); render/export code loads bytes through an injected `path -> URL`
resolver and the browser `FontFace` API. `opentype.js` is reserved for previews and metrics.
CLI commands and the local editor's `/api/fonts` route share one Node ingest service. Google
requests happen server-side only when a font is added; canvas render and export remain offline.

**System fonts are intentionally rejected.** They are not embedded in the project, vary by
machine and OS, and therefore break render/export parity by construction.

**Fonts are tied to the parity risk.** Text is where renderers diverge most, so minimal font
embedding and loading ship *with the export spike* (Phase 0–2), even though the font-management
UI comes later (Phase 3). The renderer chosen in §2 must load the embedded fonts identically.

---

## 6. Management interface: conventions + CLI + AGENTS.md

The substance of the product is repo conventions and a CLI, not a packaged skill. The agent
works through them directly; the skill stays an optional thin installer for use outside the repo.

**Standard directories (conventions = the "API"):**

```
my-app-screenshots/
├── app-store-screenshots.json     # source of truth (project)
├── AGENTS.md / CLAUDE.md          # instructions for the CLI agent
├── screenshots/                   # source captures
│   ├── apple/{iphone,ipad}/{locale}/NN.png
│   └── android/phone/{locale}/NN.png
├── assets/                        # fonts, icons, decor
│   ├── fonts/                     # uploaded .ttf/.otf/.woff/.woff2
│   └── icons/
├── themes/                        # theme tokens
├── templates/                     # reusable layouts
└── export/                        # CLI writes finished bundles here
```

**CLI (`screenshots ...`) — the primary interface for humans and agents, over the same `core`:**

| Command | Action |
|---------|--------|
| `init` | Scaffold the project, standard directories, and project-local agent guides |
| `dev` | Run the canvas editor (dev server) |
| `screen add / list / rm / reorder` | Manage screens |
| `font add <file>` / `font add --google <family>` / `font list` / `font rm` | Materialize and manage file-backed font assets |
| `theme set <id>` | Apply a theme to all screens |
| `locale list / add / direction / rm` | Manage complete locale sets and baked LTR/RTL placement |
| `canvas mode [isolated|connected]` | Inspect or explicitly change the project-wide canvas mode |
| `asset auto-crop / remove-background` | Write non-destructive local processed PNG assets |
| `import <dir>` | Ingest raw captures by directory convention |
| `export [--platform --device --locale]` | Exact PNG bundles (same result as the UI button; CI-friendly) |

**`AGENTS.md` / `CLAUDE.md` — the skill replacement inside the repo.** `screenshots init`
materializes a self-contained project guide plus a small Claude forwarding file and refuses to
overwrite either. Any CLI agent that opens the project learns the directory structure, strict v2
schema, shipped CLI commands, design guardrails (§7), and recipes for copy, baked literal layout,
locale translation, and explicit asset preprocessing. The recipes persist only ordinary project JSON
and project-local assets; they add no provider integration or agent state. Auto-crop and deterministic
flat-background removal run locally through Sharp, write under `assets/processed/`, and never enter
render/export. The current source-checkout invocation is `pnpm screenshots`; packaging the standalone
`screenshots` executable remains Phase 6.

**Skill — only for zero-config outside the repo.** A few lines telling the agent: "clone the
repo, run `screenshots init`, then follow `AGENTS.md`." Added last; not required.

---

## 7. Design guardrails (baked into AGENTS.md)

- Screenshots are ads, not documentation.
- Each slide sells one clear user outcome.
- The headline passes the one-second thumbnail test.
- Adjacent slides vary layout and device placement.
- Cross-screen (connected) elements never split required text or critical UI.
- Every exported crop works as a standalone screenshot.
