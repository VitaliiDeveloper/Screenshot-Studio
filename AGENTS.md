@RULES.md

# AGENTS.md — Screenshot Studio

Instructions for any CLI agent (Claude Code, Cursor, etc.) working inside this repo.
This file is the management interface: the conventions, schema, CLI, and guardrails an
agent needs to generate copy, lay out slides, and translate locales — no skill required.
Before starting any task, read and apply the repository-wide workflow rules in
[`RULES.md`](RULES.md); Codex does not expand `@file` imports inside `AGENTS.md`.

> **Status: implementation and verification are complete through Phase 6; Phase 7 is next.**
> The shared render/export core, CLI management surface, fonts/themes/templates, and responsive
> locale/RTL editor and collision-safe multi-locale export are built. New projects receive
> copy/layout/translation/asset recipes, and deterministic local auto-crop plus flat-background
> removal are shipped and closure-verified. The v2 connected document and precise shared-renderer
> crop contract, guarded lifecycle/CLI mode changes, gapless connected authoring, bounded persisted
> undo/redo, zoom-correct connected-space snapping/guides, and safe project-asset insertion for the
> existing screenshot/device-frame types, the group-scoped connected workspace, and the installable
> CLI artifact with its packaged shared render host, plus the thin optional skill that delegates to
> generated project guidance, are verified. The real editor GIF, contribution/license surfaces,
> living examples, and scoped SPDX policy close Phase 6. Phase 6 and planned Phase 7 together close
> the baseline; public release readiness comes only after Phase 8 stabilization.
> Read only docs directly relevant to the active task; do not scan all of `docs/` by default. When in
> doubt, follow `docs/architecture.md` (the technical
> contract) — it wins over this summary.

## What this project is

A code-first, open-source editor for App Store and Google Play marketing screenshots.
A Konva canvas with screens, elements, fonts, and themes, exporting pixel-correct PNGs to
exact store sizes — driven by the same `core` from both a web UI and a CLI. The source of
truth is a single git-trackable JSON file (`app-store-screenshots.json`).

- Stack: Next.js + React + TypeScript, Konva/react-konva, Tailwind + shared local workbench
  primitives, Lucide, Zustand + Immer, Zod (schema + validation), Playwright (headless export),
  Vitest. Node.js 22.13+.
- Monorepo: `packages/core` (model · engine · export · fonts · themes · templates · assets ·
  storage), `packages/cli`, and `apps/web`.
- **Render/export parity is the #1 rule:** one JSON must render identically in UI and CLI.
  The CLI delegates pixel rendering to the web renderer in a headless browser — never add a
  second rendering path. See `docs/architecture.md` §2.

## Repo conventions (the "API")

A screenshots project follows this layout:

```
my-app-screenshots/
├── app-store-screenshots.json     # source of truth (the project)
├── AGENTS.md / CLAUDE.md          # this file
├── screenshots/                   # source captures
│   ├── apple/{iphone,ipad}/{locale}/NN.png
│   └── android/phone/{locale}/NN.png
├── assets/                        # fonts (.ttf/.otf/.woff/.woff2), icons, decor
├── themes/                        # theme tokens
├── templates/                     # reusable layouts
└── export/                        # CLI writes finished bundles here (gitignored)
```

## Project JSON schema (validated by Zod — never write an invalid one)

The **enforced** schema lives in `packages/core/src/model/schema.ts` and is `.strict()`:
an unknown key or out-of-range value fails loudly. When writing or editing project JSON, write
against the enforced v2 only; future schema ideas are not valid project fields.

**Current v2 (enforced today):**

```
Project
├── meta: { name, appIcon?, schemaVersion: 2 }
├── mode: isolated | connected
├── platforms: ["apple" | "android", …]    # derived manifest: set-equal to the screens' platforms
├── locales: ["en", …]                     # free-form, duplicate-free derived manifest
├── fonts: FontAsset[]                     # uploaded / Google file assets under assets/fonts/
└── screens: Screen[]
    ├── id, name, platform, device, locale, direction  # direction: ltr | rtl
    ├── artboard: { width, height }
    ├── background: solid only
    └── elements: Element[]                # z-order = array order
```

Element base: `id, type, x, y, width, height, rotation, opacity, locked, visible, name?, role?`.
Element types today: `text`, `shape` (rect), `screenshot`, `device-frame` (iphone).
There is deliberately **no `themes` key**: definitions live in `themes/*.json` and are baked
into literal element fields by `theme set`; the strict project validator rejects a `themes` key.

`Project.locales` is set-equal to the locale strings used by screens. `Screen.direction` defaults
to `ltr`, is consistent within a locale, and is passed explicitly to the shared text renderer.
Direction changes bake horizontal placement/alignment into JSON; they never reflect media pixels.

`Project.mode` is project-wide. In `connected` mode, each exact `platform/device/locale` group is a
gapless, top-aligned horizontal strip in project order. Elements remain owned by a screen and keep
owner-local coordinates; the shared renderer projects every group screen, paints all backgrounds
first, then elements by screen/array order, and returns the requested screen's exact crop. Valid v1
projects load through a lossless migration to v2 `isolated`. Connected Overview is one editable
gapless strip for the active exact group; owner-aware selection keeps duplicate ids unambiguous and
stores transforms in owner-local coordinates. Focus is a non-interactive exact crop preview.

Future schema work is roadmap-governed. Do not add new background/element types, per-element RTL
fields, group state, or other canvas fields until the enforced schema and architecture widen.

## CLI (`screenshots ...`) — the primary interface

Status: ✅ shipped.

| Command | Action | Status |
|---------|--------|--------|
| `init` | Scaffold the project, standard directories, and project-local agent guides | ✅ |
| `export [--screen --size]` | Export one screen to an exact store size (PNG, no alpha) | ✅ |
| `export [--platform --device --locale]` | Export lead-size PNG **bundles** + zip by platform/device/locale | ✅ |
| `dev` | Run the canvas editor (dev server) | ✅ |
| `screen add / list / rm / reorder` | Manage screens | ✅ |
| `import <dir>` | Ingest raw captures by directory convention | ✅ |
| `font add <file>` / `font add --google <family>` / `font list` / `font rm` | Register and manage deterministic font assets | ✅ |
| `theme set <id>` | Apply `themes/<id>.json` to all role-tagged elements | ✅ |
| `locale list / add / direction / rm` | Manage complete locale sets and baked layout direction | ✅ |
| `canvas mode [isolated|connected]` | Inspect or explicitly change the project canvas mode | ✅ |
| `asset auto-crop / remove-background` | Write non-destructive local processed PNG assets | ✅ |

`export --screen --size` writes a single explicit target. Without `--screen`, `export` writes a
lead-size bundle for every matching screen, grouped by `platform/device/locale`, plus
`app-store-screenshots-bundle.zip`; filters are optional (`--platform`, `--device`, `--locale`).
Each PNG is written as `platform/device/<safe-locale>/NN-<screen>-<size>.png`; the locale folder is
a collision-safe encoding of the exact stored identifier, and `NN` restarts at `01` inside every
platform/device/locale group while preserving relative project order. Bundle export uses one render
host and one browser context for the run. Export sizes live in `store-specs.json` (data, not hardcode),
with dimension tests. Strip the alpha channel on export — stores require no transparency. See
architecture §4.

`screen list` prints project order, which also defines relative slot order inside every export group.
`screen add` requires `--platform`, `--device`,
and `--locale`; `--id`, `--name`, and `--size` are optional. `screen rm <id>` refuses to remove the
last screen. `screen reorder <id> --to <position>` uses 1-based positions. `import <dir>` expects the
documented `apple/{iphone,ipad}/{locale}/NN.png` and `android/phone/{locale}/NN.png` capture layout,
copies PNGs into `assets/imports/...`, and appends screenshot-backed screens.

`locale add <target> --from <source>` clones the complete source set with fresh screen/element ids;
`--direction rtl` bakes mirrored horizontal placement and physical text alignment.
`locale direction <locale> --to <ltr|rtl>` is repeat-safe; `locale rm <locale>` refuses to remove
the last locale. `locale list` prints direction plus screen count. `screen add --direction` is optional;
without it, an existing locale's direction is inherited and a new locale defaults to LTR.

`canvas mode` prints the current project-wide mode. `canvas mode connected` is an explicit opt-in:
previously clipped owner-local overflow can appear on neighbouring screens in the same exact group.
`canvas mode isolated` refuses while any rendered element's rotation-aware bounds cross its owner
artboard, so changing mode cannot silently drop connected pixels.

`font add <file>` requires `--family` and accepts `.ttf`, `.otf`, `.woff`, or `.woff2`; `--weight`
defaults to `400`. `font add --google <family>` downloads one exact-weight file at add-time, so
render/export make no network request. `font rm <family>` removes the selected identity (and its
unshared managed file). Export refuses text whose `(fontFamily, weight)` has no `FontAsset`, rather
than accepting a machine-dependent system fallback.

`theme set <id>` loads the strict definition from `themes/<id>.json`. Role-tagged text and shape
elements receive baked color/font literals; elements without `role` opt out. Theme font identities
must already exist in `fonts`, so applying a theme cannot introduce a system-font fallback.
The editor's Themes dialog lists and applies the same files; text/shape inspectors assign or clear
the persisted role.

The editor's Templates dialog lists strict `templates/*.json` definitions and creates a new screen
using the template's platform/device/artboard plus the active screen's locale and direction. Every
instantiated screen and element receives a fresh id; template text fonts must already exist in
`fonts`. Templates are authored as LTR literals, so RTL targets mirror placement/alignment exactly
once before the ordinary screen is persisted.

The editor top bar selects and manages complete locale sets. Structure/Screens and Overview show
only the active locale; drag reorder is locale-scoped, inline editing and new text use the active
screen direction, and the last screen in a locale is removed only through the guarded locale manager.

`screenshots init` also writes a self-contained project-user `AGENTS.md` and a small `CLAUDE.md`
forwarder, refusing to overwrite either. The canonical generated guide is
`packages/cli/src/project-agent-guide.md`; it teaches copy generation, baked literal auto-layout,
locale translation, and explicit local asset processing through the shipped CLI and strict v2 fields.
Do not duplicate those recipes here or introduce an AI SDK/provider: Phase 5 agent work is
subscription-backed orchestration over ordinary project JSON.

`asset auto-crop <file>` and `asset remove-background <file>` resolve sources from the project root,
reject real-path and symlink escapes, preserve the source and project JSON, and write collision-safe
PNG results under `assets/processed/`. Auto-crop bounds edge-connected top-left-colour margins;
background removal makes an edge-connected flat/near-uniform colour transparent. The latter is not
semantic segmentation and must not be presented as reliable for complex photographic scenes.

## Design guardrails (always apply when generating slides/copy)

- Screenshots are ads, not documentation.
- Each slide sells one clear user outcome.
- The headline passes the one-second thumbnail test.
- Adjacent slides vary layout and device placement.
- Cross-screen (connected) elements never split required text or critical UI.
- Every exported crop works as a standalone screenshot.

## Token/context discipline for agents

This repo has detailed docs and long-running phase work. Keep context narrow:

- For implementation, start from `AGENTS.md`, then open only the relevant sections of
  `docs/architecture.md`, `docs/roadmap.md`, and the active slice spec/plan if one exists.
  Do not read every file under `docs/` unless the task explicitly requires a full audit.
- For each new slice, prefer a short handoff into a fresh thread/session instead of carrying
  the full planning and implementation history forward. A handoff should name the goal, the
  branch/base, the files or directories to inspect, the contracts that must hold, and the
  targeted verification commands. Reserve the full gate for the conditions in `RULES.md`.
- Use sub-agents only for independent work streams, and give each sub-agent a scoped handoff
  with the minimum relevant files. Do not pass the entire roadmap, all specs, or raw prior
  thread history to every sub-agent.
- Avoid broad searches over generated logs, session transcripts, lockfiles, build artifacts,
  and `node_modules`. In particular, do not grep raw `.codex/sessions/*.jsonl` unless the
  task is explicitly a Codex usage audit.
- When auditing Codex usage, extract only `token_count`, `task_complete`, or similarly narrow
  fields with a structured or line-limited command. Never print full `session_meta`,
  `base_instructions`, or large embedded tool outputs.
- Prefer command patterns that discover first and open second: `rg --files`, `wc`, targeted
  `rg`, and narrow `sed -n` ranges. Avoid repo-wide `cat`, broad recursive text searches, and
  commands that can emit large single-line JSON blobs.
- Batch independent unit, lint, and package-typecheck commands into one tool turn when possible.
  When a long-running test yields a process/session id, wait with one appropriately long poll
  instead of repeatedly waking the model for short status checks.
- Use the root targeted scripts (`test:core`, `test:cli`, `test:web`, `test:e2e:parity`,
  `test:e2e:export`, `test:e2e:editor`) or explicit Vitest file paths during implementation.
  `pnpm test:e2e` is the full browser gate, not the default slice check.
- Verification scope is defined by the behavioral-risk matrix in `RULES.md`. For a localized
  UI edit, do not default to the full editor E2E group.
