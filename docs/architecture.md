# Architecture & Technical Contract

How the system is built and the contracts everything agrees on: tech stack, core/shell
split, render/export parity, data model & schema, store export spec, fonts, the management
interface (CLI + conventions + generated project guidance), and design guardrails.

Version 1.0, 12 July 2026.

---

## 1. Tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| Render engine | **Konva.js / react-konva** | Object model, layers, transforms, pixel-correct export via `pixelRatio` |
| UI framework | Next.js (App Router) + React + TypeScript | Dev server, routing, easy self-host |
| Styling | Tailwind CSS | Speed, consistency |
| Components | Shared local workbench primitives + Lucide | Inspector, dialogs, selects, menus, tooltips |
| State | Zustand (+ Immer) | Light editor store with bounded project history and transient workspace state |
| Export (UI) | `POST /api/export` delegates to CLI bundle orchestration | Exact-size PNGs, zip bundle |
| Export (CLI / headless) | **Playwright** renders the same web stage | Pixel parity with the UI by construction — see §2 |
| Fonts | Browser FontFace API | Deterministic file-backed Google/custom registration |
| Screen reorder | dnd-kit | Reordering screens in the sidebar |
| Schema & validation | **Zod** | One explicit version and a strict validator (the AI contract) |
| Specs & tests | **`store-specs.json` + Vitest** | Store sizes as data, not hardcode; export dimension tests |

**Requirements:** Node.js 22.13+ and pnpm 11.10.0 (through Corepack).

---

## 2. Architecture: core + shell, and the parity decision

The pnpm-workspace monorepo has a clear boundary. The split is for modularity,
testability, and ease of contributions — not for monetization.

```
screenshot-studio/
├── packages/
│   ├── core/            # framework-agnostic core
│   │   ├── model/       # types and strict project schema (Zod)
│   │   ├── engine/      # Konva render, elements, transforms
│   │   ├── export/      # render to exact sizes, zip bundle
│   │   ├── fonts/       # font load/registration + embedding
│   │   └── storage/     # StorageAdapter interface + local implementation
│   ├── ui/              # RESERVED (not yet created): reusable React editor components —
│   │                    #   editor components live in apps/web until a second consumer exists
│   └── cli/             # CLI: init, dev, screen, locale, font, theme, import, export
├── apps/
│   └── web/             # Next.js: self-hosted editor
├── examples/            # self-contained current-schema connected and RTL living projects
├── AGENTS.md            # concise contributor-agent entry point and source routing
└── skills/
    └── screenshot-studio/ # optional discovery/bootstrap skill for use outside the repo
```

The CLI and generated project-local `AGENTS.md` are the primary management interface for humans
and agents. The CLI uses `core` for schema, project state, and export orchestration, but delegates
the actual
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

The renderer decision is complete: UI and CLI exports both use the same browser Konva stage.
`core` owns schema, project, and export orchestration; the CLI launches the packaged web renderer
in Playwright and never substitutes a `node-canvas`/Cairo path. This keeps text, fonts, assets,
backgrounds, effects, and connected crops on one implementation at the accepted cost of a heavier
CLI artifact.

Parity is verified by exact target dimensions, an opaque output, and a visual diff within
tolerance. Byte identity is not required because equivalent PNGs may differ in metadata or
compression. New render-affecting fields must extend the shared mapper and its parity coverage;
adding a second renderer is outside the architecture.

---

## 3. Data model & schema

A single JSON file is the source of truth — git-trackable and reproducible. A **strict Zod
schema + validator** is foundational: it underpins determinism and the AI
contract (the agent edits this JSON, so it must be impossible to write an invalid one
silently).

```
Project
├── meta: { name, appIcon, schemaVersion }
├── mode: isolated | connected
├── platforms: ["apple", "android", "windows"]
├── locales: ["en", "de", "ar"]            # derived from screens
├── fonts: FontAsset[]                     # google / uploaded files under assets/fonts/
└── screens: Screen[]
    ├── id, name, platform, device, locale, direction
    │   # apple: iphone/ipad/macos/tvos/watchos; android: phone; windows: desktop
    ├── variantOf?, storeTargetId?          # paired only for non-lead sizes in one family
    ├── artboard: { width, height }        # slide size
    ├── background: Background              # solid | gradient | image
    └── elements: Element[]                # z-order = array order
```

**Element types** — all elements share `id`, `type`, `x`, `y`, `width`, `height`, `rotation`,
`opacity`, `locked`, `visible`, and optional display `name`. Leaf elements additionally allow the
optional baked-theme `role`; groups do not. The strict v1 members are:

- `text` — content, fontFamily, size, weight, lineHeight, letterSpacing, align, color, shadow
- `screenshot` — assetUrl, fit (cover/contain), crop, cornerRadius
- `device-frame` — assetUrl, fit, and a trusted `iphone | android-phone | tablet | desktop | tv | watch` preset
- `shape` — `rect | ellipse`, solid fallback fill, optional two-stop gradient, optional stroke, radius
- `group` — one non-clipping level of existing leaf elements in local coordinates
- `icon` — trusted built-in id, editable colour/stroke, core-owned normalised SVG path
- badge compositions — ordinary shape/icon/text groups for rating/press proof; ordinary images for official store badges
- `image` — project-local decorative raster, contain/cover, optional crop, cornerRadius

**Background types** are the strict `solid`, `linear-gradient`, and project-relative `image`
members. There are no arbitrary CSS paints, generic effects, blobs, author-defined frame slots,
frame colours, nested groups, or `badge` element member in v1.

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
`direction: "ltr" | "rtl"` (omitted values receive the strict schema's `ltr` default), and all screens in one locale
must agree. Changing direction bakes horizontal placement (`x' = artboard.width - x - width`) and
physical `left ↔ right` text alignment into JSON while preserving media pixels and rotation. The
shared `elementToNodeConfig(element, { images, direction })` mapper sends the stored direction to
Konva text in both the editor and headless renderer; geometry is never mirrored at render time.
Inline editors inherit the screen direction, and new text uses physical right alignment in RTL.
Templates remain LTR-authored inputs and are baked once when instantiated into an RTL locale.

**Versioning.** The complete current document is the first supported pre-release format and stores
`schemaVersion: 1`. `parseProject()` validates raw input directly; it does not migrate internal
development shapes or mutate the caller's object. Unsupported numeric versions receive a dedicated
version error, while missing or invalid versions fail strict validation. Compatibility migrations
will be introduced only after a published project format creates a supported upgrade boundary.

**Connected canvas — render/export contract.** `Project.mode` is one explicit
project-level `isolated | connected` choice. In connected mode, screens with the same exact
platform, device, locale, and
store-target identity form a gapless,
top-aligned strip in project order; each origin is the cumulative width of earlier group screens.
Elements remain in their owner screen with owner-local coordinates. The shared renderer paints all
group backgrounds first, then visible elements by screen order and element-array order, translated
against the requested screen origin. `renderScreen` still returns a stage at exactly the requested
artboard dimensions, so the stage itself is the precise UI/CLI export crop — there is no stitched
PNG or post-export slicing path. The editor uses one gapless editable group stage on the same
`elementToNodeConfig` mapper: screen-offset Groups preserve owner-local transforms, composite
screen/element selection disambiguates duplicate ids, and Focus reuses the projection as an exact
non-interactive crop. The toolbar exposes project mode and guarded conversion feedback; successful
changes travel through ordinary history/save.

**Editor history.** The Zustand store keeps at most 50 prior project snapshots in
memory. Consecutive patches for the same owner element, background, or artboard coalesce until an
explicit interaction boundary; structural mutations remain separate steps. Undo and redo preserve
only still-valid active/selected ids, clear the opposite branch after a new mutation, and travel
through the same durable project save path as ordinary edits. Loading a project or replacing it
after an external durable-resource operation resets history. Selection, viewport, dialogs, save
status, and guide chrome are transient and never enter project history or JSON.

**Editor snapping.** One dragged element derives rotation-aware bounds in the
active stage coordinate space. Candidate anchors come from the connected group bounds, each active
artboard, and visible non-zero-opacity elements; exact ties prefer element, then artboard, then
group targets in stable project order. The logical tolerance is `6 / zoom`, keeping the interaction
threshold at six screen pixels. Connected results translate back to the unchanged owner-local
coordinate. Vertical/horizontal guides are non-listening Konva lines updated through refs during
drag, cleared before persistence, and absent from the store, project schema, static renderer, and
export.

**Editor asset discovery.** `/api/assets` recursively lists regular PNG, JPEG,
and WebP files only under the project-root `assets/` and `screenshots/` directories, skips hidden
entries and symlinks, and returns stable portable relative paths. The Add picker creates the
`screenshot`, decorative `image`, and `device-frame` schema members through core factories; insertion uses
the ordinary history/save path and the same `collectImageUrls` / `loadProjectImages` cache used by
the static renderer. `/api/asset` checks both lexical and canonical real-path containment before
reading image or font bytes. The picker performs no upload, copy, delete, rename, external fetch, or
project replacement. The `image` leaf has a non-cropping `contain` default, deterministic centred
`cover` crop, alpha-preserving composition, and the screenshot missing-asset placeholder.

**Connected workspace behavior.** Workspace derivation has two explicit
contracts. `workspaceEditingScope` feeds Screens, selection, reorder, authoring, snapping, and
transforms with one exact platform/device/locale/store-target group in connected mode; isolated
mode retains its locale/root or exact target layer. `workspaceOverviewRows` presents every output
family for the active locale in stable project order. Isolated families render as one output
container whose master and explicit targets remain separate size rows; the active family owns the
outer highlight and the active exact row owns the `Editing` marker. Variant rows repeat the output
label as a contextual breadcrumb, append the exact size, and carry a `Variant` marker; the lead row
remains consolidated into the family header with its `Master` marker. Connected families keep one
independent exact group and substitute the active target for its family row. Activating a preview
row changes transient screen selection without history or persistence.
Overview Fit measures every row while keeping output headers and per-screen title/metadata chrome
in fixed CSS pixels.
Connected reorder rewrites only the visible group's existing project-array slots;
unrelated groups do not move. Layers stays active-owner scoped and labels that owner. Thumbnail
memoization compares every exact-group screen reference and projected order because a neighbour's
element can change the requested crop, while unrelated groups remain memoized. The toolbar mode
control delegates to the guarded core transition, reports refusal without adding history, and sends
successful changes through bounded history and durable save. Desktop and compact browser coverage
composes mode, boundary selection, thumbnails, history, snapping, media insertion, panels, Fit, and
keyboard dismissal without persisting workspace chrome.

**Editor multi-selection.** Selection is an ephemeral ordered set of composite
`{ screenId, elementId }` identities; its last member is the primary single-item target. Modified
click and rotation-aware marquee acquisition operate only inside the editable active screen or
connected exact group. Aggregate translation adds one stage-space delta to each unlocked member's
unchanged owner-local coordinates and commits one history/save mutation; delete, lock, and
visibility are likewise atomic. Multi-resize/rotate and snapping remain outside this selection
contract. Selection is reconciled across screen/mode/load/undo boundaries
but never enters project JSON, render/export input, or history snapshots.

**Persisted groups.** `Element` is `LeafElement | GroupElement`,
where a group owns a non-empty, non-nested `children: LeafElement[]` array in local coordinates.
The group occupies one top-level z-order slot; child array order is internal z-order. Group
translation/rotation/opacity compose through the ordinary recursive `NodeConfig` tree, while
`width/height` are authoring bounds and introduce neither runtime scale nor clipping. Visible child
overflow participates in the connected→isolated loss guard, and exact screen stage dimensions remain
the only export crop. Fonts, assets, themes, templates, cloning, and RTL all traverse group leaves
through shared core helpers.

**Group authoring.** Grouping requires at least two top-level leaves from one
owner screen, rejects cross-owner/nested input, inserts one group at the frontmost selected slot,
and converts its children to rotation-aware aggregate-bound-local coordinates. Groups transform as
one top-level node; uniform resize bakes scale into every child geometry and dimensional leaf field.
Ungroup composes group translation, rotation, opacity, lock, and visibility into its children at the
same z-order slot. Duplicate freshens the group and every child id. Each screen enforces id
uniqueness across its complete one-level tree so Layers child inspection is unambiguous. Canvas
interaction selects the group; owner-scoped Layers exposes one indented child level for inspection
and child property actions. Group, ungroup, duplicate, and all group/child edits use the ordinary
bounded history and durable-save path.

**Trusted vector icons.** `icon` stores only one stable id from the
core-owned `check | heart | sparkles | star` registry plus literal colour and positive stroke width.
The registry supplies normalised `24×24` path data to the shared NodeConfig mapper, which returns a
logical Group and Konva Path with screen-pixel stroke semantics. Static/UI/CLI rendering never parse
project SVG/XML or use a font glyph. Add inserts a default star and Inspector edits the id, colour,
and stroke; arbitrary SVG import remains outside the contract.

**Badge primitives.** Badges add no render-state union member.
Core factories return fresh-id ordinary groups for rating (shape + star icon + editable registered-
font text) and “as seen on” (shape + sparkles icon + editable registered-font text). The editor
refuses those insertions without a registered font. Official store badges are named contain-fit
decorative images selected through the existing secure asset picker. After insertion, group/image
selection, child inspection, transforms, duplication, ungrouping, themes, RTL, history, save, and
export remain the existing contracts; `type: "badge"` is invalid.

**Living examples and closure checks.** The self-contained current-schema living projects exercise connected
image overflow, trusted icons, ordinary badge groups, and two-screen LTR/RTL locale groups. The
closure browser gate edits a copied example through accessible named controls and the documented
group/duplicate/ungroup/undo shortcuts, reloads the persisted result, and exports exact alpha-free
store PNGs. These examples validate the current baseline but do not authorize publication.

**Independent store targets.** Root screens omit
`variantOf` and `storeTargetId`. An explicit target copy stores both fields, points directly to its
root, matches the root platform/device/locale, and renders through the same flat `Screen` contract.
Creation fits a fresh-id copy into the exact store artboard and never mutates the root. Workspace
projection includes `storeTargetId` in the group identity so root and variant canvases cannot be
stitched together. Bundle export uses the lead target for roots and each explicit variant's own
target id, with numbering restarted per target. New roots use their device family's exact lead
artboard. Newly created editor-driven `apple/watchos` output families are the deliberate exception:
core derives a 3× authoring master by multiplying the `store-specs.json` lead target, so the current
422 × 514 lead creates a 1266 × 1542 root without persisting another target dimension. The editor
therefore presents new watchOS masters as custom by default; ordinary exact masters remain fixed by
default. Explicit customization and reset still resize every root composition in the output set
atomically, while reset fits the set back to the exact lead dimensions. Exact and custom state are
derived from `store-specs.json`, not duplicated in the schema. Artboard fitting scales pixel-valued
visual metrics alongside geometry—including text-shadow blur and offsets, shape-stroke width, and
corner radii—so proportional authoring masters preserve their appearance at exact export sizes.
Scaling fails atomically instead of clamping when a bounded visual metric would exceed the strict
schema. Existing roots are opened unchanged.

**Artboard backgrounds.** `Background` is a strict discriminated
union: `solid`, two-stop `linear-gradient` with a bounded `0…360` degree angle, or a project-relative
`image` with deterministic `cover | contain` fit and a fallback/letterbox colour. Background colour
literals use `HexColor` and may include alpha. UI and static export both consume
`backgroundToNodeConfig`; image assets participate in the ordinary project preload cache and retain
the same path-containment rules as image elements. The renderer paints every background before
connected elements, and final store export flattens the composed PNG by stripping alpha.

**Media crop controls.** Screenshot and decorative-image leaves may
store `crop: { x, y, zoom }`, where focal coordinates are normalized `0…1` and zoom is bounded
`1…4`. The shared object-fit mapper derives a clamped source window for `cover`; missing crop is
centred at zoom 1, and `contain` preserves but ignores crop state. The element box, connected owner
coordinates, export crop, and alpha handling remain unchanged.

**Text and shape styling.** Text optionally stores one bounded literal
shadow. Shape `kind` is `rect | ellipse`, with a solid `fill` fallback plus optional strict two-stop
linear gradient and literal stroke. The shared mapper emits the same Konva shadow/paint props for
editor and static export; ellipse uses a logical owner Group so persisted x/y remain top-left during
drag/transform. Themes continue to bake the solid fallback and do not mutate optional effects.

**Built-in frame presets.** The existing `device-frame` leaf selects
one core-owned `iphone | android-phone | tablet | desktop | tv | watch` preset. Each supplies
normalized outer aspect, bezel, screen-slot, corner, and optional notch geometry rendered with
native Konva primitives; the project screenshot remains the only asset. Preset switching preserves
width and fits height to the canonical outer aspect.

---

### Store output families

Each exact `platform/device/locale` root set is an independently editable output. Creating another
family clones every root screen in the active locale with fresh screen and element ids, fits the
copy to that family's core-derived master artboard, and never mutates or links it back to the source
family. The master normally equals the lead target; editor-created `apple/watchos` families use the
3× proportional master described above. Accepted non-lead sizes remain
`variantOf`/`storeTargetId` variants of a root inside the same family. Both operations are
idempotent: an existing output or size is opened unchanged instead of duplicated.

## 4. Store export spec

Design at each platform's largest size, export by scaling down. The editor's export API delegates to
the CLI bundle orchestration. Both surfaces drive the shared `/render` stage, which calls
`Stage.toDataURL` with the right `pixelRatio`, and write bundle entries as
`platform/device/<safe-locale>/NN-<screen>-<size>.png`: the locale folder collision-safely encodes
the exact free-form identifier, filtering remains exact against the stored string, and `NN`
restarts inside each platform/device/locale/target group while preserving that group's relative
project order. The complete filesystem/ZIP batch is validated for containment and duplicate paths before
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
available as explicit opt-in targets.

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
| iPad 12.9″ | 2048 × 2732 |
| iPad 11″ | 1668 × 2420 |
| macOS (lead) | 2880 × 1800 |
| tvOS (lead) | 3840 × 2160 |
| watchOS (lead) | 422 × 514 |

Landscape swaps the dimensions (e.g. 2868×1320). Apple scales down to smaller slots itself.

**Google Play** — recommended presets (JPEG / 24-bit PNG, no transparency, up to 8 per type,
side 320–3840 px, max ratio 2:1; any size in range is valid):

| Device | Preset |
|--------|--------|
| Phone portrait | 1080 × 1920 |
| Phone landscape | 1920 × 1080 |

**Microsoft Store** — explicit desktop presets, with 3840×2160 as this project's lead output and
1366×768 as the smallest stored preset. Microsoft accepts 1366×768 or larger desktop screenshots.

Device frames select one of six core-owned presets: `iphone`, `android-phone`, `tablet`, `desktop`,
`tv`, or `watch`. The shared renderer builds each bezel, screen slot, corner treatment, and
optional notch from native Konva primitives; the project-local screenshot is the only frame asset.

Sources: [Apple — Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications),
[Google Play — Add preview assets](https://support.google.com/googleplay/android-developer/answer/9866151),
[Microsoft Store — Screenshots and images](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/screenshots-and-images).

---

## 5. Fonts (technical)

Two optional file-backed sources: **Google Fonts** and **custom upload**. Both materialize as
project-relative files under `assets/fonts/` (`.ttf/.otf/.woff/.woff2`) and are served through
the same local `/api/asset` route as screenshots. `FontAsset.source` records provenance
(`google` or `uploaded`); render/export code loads bytes through an injected `path -> URL`
resolver and the browser `FontFace` API.
CLI commands and the local editor's `/api/fonts` route share one Node ingest service. Google
requests happen server-side only when a font is added; canvas render and export remain offline.

**System fonts are intentionally rejected.** They are not embedded in the project, vary by
machine and OS, and therefore break render/export parity by construction.

**Fonts are tied to the parity risk.** Text is where renderers diverge most, so every registered
font is loaded through the same file-backed browser path before either UI or CLI rendering is
declared ready.

---

## 6. Management interface: conventions + CLI + generated project guidance

The substance of the product is repo conventions and a CLI, not a packaged skill. The agent
works through them directly; the skill stays an optional thin installer for use outside the repo.

**Standard directories (conventions = the "API"):**

```
my-app-screenshots/
├── app-store-screenshots.json     # source of truth (project)
├── AGENTS.md / CLAUDE.md          # generated project-local agent guidance
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

**Generated `AGENTS.md` / `CLAUDE.md` — project-local guidance.** `screenshots init`
materializes a self-contained project guide plus a small Claude forwarding file and refuses to
overwrite either. Any CLI agent that opens the project learns the directory structure, strict v1
schema, shipped CLI commands, design guardrails (§7), and recipes for copy, baked literal layout,
locale translation, and explicit asset preprocessing. The recipes persist only ordinary project JSON
and project-local assets; they add no provider integration or agent state. Auto-crop and deterministic
flat-background removal run locally through Sharp, write under `assets/processed/`, and never enter
render/export. Source contributors invoke `pnpm screenshots`; the packaged distribution also builds one
installable `@screenshot-studio/cli` artifact whose Node 22 ESM bin bundles CLI/core code and whose
runtime carries `store-specs.json`, the generated guide, and the prebuilt shared web host; the
artifact also retains the repository `LICENSE` and `NOTICE`. The host
is Next `output: standalone` plus `.next/static`, stored as `runtime/web.zip` so npm retains traced
dependencies. Installed commands extract it into a unique OS temp directory, spawn its `server.js`,
and clean it after stop/failure. `playwright` and `sharp` remain normal native/runtime package
dependencies. The measured local tarball is about 41 MiB; that accepted weight preserves parity
instead of introducing a second lightweight renderer. Building/packing is not a publication claim.

**Skill — only for discovery/bootstrap outside the repo.** `skills/screenshot-studio` is a thin
installable skill with one deterministic bootstrap script. It invokes the built CLI from an
explicit path, `SCREENSHOT_STUDIO_CLI`, or `PATH`, refuses existing project/control files, and then
delegates all product behavior to the generated project-local `AGENTS.md`. It does not copy the
schema or recipes, fetch a package implicitly, add an AI SDK/provider, or become required for normal
CLI/editor use. Its isolated smoke installs the skill into a temporary home and initializes a clean
current-schema project through the packaged CLI. This is still not a registry publication or
release claim.

---

## 7. Design guardrails (baked into generated project guidance)

- Screenshots are ads, not documentation.
- Each slide sells one clear user outcome.
- The headline passes the one-second thumbnail test.
- Adjacent slides vary layout and device placement.
- Cross-screen (connected) elements never split required text or critical UI.
- Every exported crop works as a standalone screenshot.
