@RULES.md

# AGENTS.md — Screenshot Studio

Instructions for any CLI agent (Claude Code, Cursor, etc.) working inside this repo.
This file is the management interface: the conventions, schema, CLI, and guardrails an
agent needs to generate copy, lay out slides, and translate locales — no skill required.
Before starting any task, read and apply the repository-wide workflow rules in
[`RULES.md`](RULES.md); Codex does not expand `@file` imports inside `AGENTS.md`.

> **Status: implementation and verification are complete through Phase 4 Slice 3; Slice 4 is next.**
> The shared render/export core, CLI management surface, fonts/themes/templates, and responsive
> Focus/Overview editor workspace are built. Read only docs directly relevant to the active task;
> do not scan all of `docs/` by default. When in doubt, follow
> `docs/architecture.md` (the technical contract) — it wins over this summary.

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
against the enforced v1 only; future schema ideas are not valid project fields.

**Current v1 (enforced today):**

```
Project
├── meta: { name, appIcon?, schemaVersion: 1 }
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

Future schema work is roadmap-governed. Do not add new background/element types, per-element RTL
fields, or connected-canvas state until the enforced schema and architecture explicitly widen.

## CLI (`screenshots ...`) — the primary interface

Status: ✅ shipped.

| Command | Action | Status |
|---------|--------|--------|
| `init` | Scaffold the project and standard directories | ✅ |
| `export [--screen --size]` | Export one screen to an exact store size (PNG, no alpha) | ✅ |
| `export [--platform --device --locale]` | Export lead-size PNG **bundles** + zip by platform/device/locale | ✅ |
| `dev` | Run the canvas editor (dev server) | ✅ |
| `screen add / list / rm / reorder` | Manage screens | ✅ |
| `import <dir>` | Ingest raw captures by directory convention | ✅ |
| `font add <file>` / `font add --google <family>` / `font list` / `font rm` | Register and manage deterministic font assets | ✅ |
| `theme set <id>` | Apply `themes/<id>.json` to all role-tagged elements | ✅ |
| `locale list / add / direction / rm` | Manage complete locale sets and baked layout direction | ✅ |

`export --screen --size` writes a single explicit target. Without `--screen`, `export` writes a
lead-size bundle for every matching screen, grouped by `platform/device/locale`, plus
`app-store-screenshots-bundle.zip`; filters are optional (`--platform`, `--device`, `--locale`).
Bundle export uses one render host and one browser context for the run. Export sizes live in
`store-specs.json` (data, not hardcode), with dimension tests. Strip the alpha channel on export —
stores require no transparency. See architecture §4.

`screen list` prints screens in bundle/export order. `screen add` requires `--platform`, `--device`,
and `--locale`; `--id`, `--name`, and `--size` are optional. `screen rm <id>` refuses to remove the
last screen. `screen reorder <id> --to <position>` uses 1-based positions. `import <dir>` expects the
documented `apple/{iphone,ipad}/{locale}/NN.png` and `android/phone/{locale}/NN.png` capture layout,
copies PNGs into `assets/imports/...`, and appends screenshot-backed screens.

`locale add <target> --from <source>` clones the complete source set with fresh screen/element ids;
`--direction rtl` bakes mirrored horizontal placement and physical text alignment.
`locale direction <locale> --to <ltr|rtl>` is repeat-safe; `locale rm <locale>` refuses to remove
the last locale. `locale list` prints direction plus screen count. `screen add --direction` is optional;
without it, an existing locale's direction is inherited and a new locale defaults to LTR.

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
using the template's platform/device/artboard plus the active screen's locale. Every instantiated
screen and element receives a fresh id; template text fonts must already exist in `fonts`.

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
