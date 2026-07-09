# AGENTS.md — Screenshot Studio

Instructions for any CLI agent (Claude Code, Cursor, etc.) working inside this repo.
This file is the management interface: the conventions, schema, CLI, and guardrails an
agent needs to generate copy, lay out slides, and translate locales — no skill required.

> **Status: Phase 0, Phase 1, and Phase 2 implemented and verified; Phase 3 is next.**
> The render/export core, web editor, verified export flow, and dogfood CLI management commands
> are built and tested; later theme/font commands remain planned (marked ◻). Read only the docs directly relevant to the
> active task; do not scan all of `docs/` by default. When in doubt, follow
> `docs/architecture.md` (the technical contract) — it wins over this summary.

## What this project is

A code-first, open-source editor for App Store and Google Play marketing screenshots.
A Konva canvas with screens, elements, fonts, and themes, exporting pixel-correct PNGs to
exact store sizes — driven by the same `core` from both a web UI and a CLI. The source of
truth is a single git-trackable JSON file (`app-store-screenshots.json`).

- Stack: Next.js + React + TypeScript, Konva/react-konva, Tailwind + shadcn/ui, Zustand +
  Immer, Zod (schema + validation), Playwright (headless export), Vitest. Node.js 20+.
- Monorepo: `packages/core` (model · engine · export · fonts · storage), `packages/ui`,
  `packages/cli`, `apps/web`.
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
│   └── android/{phone,tablet-7,tablet-10,feature-graphic}/{locale}/NN.png
├── assets/                        # fonts (.ttf/.otf/.woff2), icons, decor
├── themes/                        # theme tokens
├── templates/                     # reusable layouts
└── export/                        # CLI writes finished bundles here (gitignored)
```

## Project JSON schema (validated by Zod — never write an invalid one)

The **enforced** schema lives in `packages/core/src/model/schema.ts` and is `.strict()`:
an unknown key or out-of-range value fails loudly. It is deliberately **narrower** than the
target sketch below — when writing or editing project JSON, write against the enforced v1,
never the target.

**Current v1 (enforced today):**

```
Project
├── meta: { name, appIcon?, schemaVersion: 1 }
├── platforms: ["apple" | "android", …]    # derived manifest: set-equal to the screens' platforms
├── locales: ["en", …]                     # free-form strings
├── fonts: FontAsset[]                     # uploaded (base64) only
└── screens: Screen[]
    ├── id, name, platform, device, locale  # apple→{iphone,ipad}, android→{phone}
    ├── artboard: { width, height }
    ├── background: solid only
    └── elements: Element[]                # z-order = array order
```

Element base: `id, type, x, y, width, height, rotation, opacity, locked, visible, name?`.
Element types today: `text`, `shape` (rect), `screenshot`, `device-frame` (iphone).
There is **no `themes` key yet** (Phase 3) — the strict validator rejects it.

**Target (later phases):** platforms `["apple", "android"]`; `themes: Theme[]` (tokens:
colors, fonts, spacing); background `solid | gradient | image`; fonts system / google /
uploaded; extra element types `icon`, `badge`, `image`; locales with RTL (`ar`). Artboards
are **isolated** (no connected canvas in the MVP). Schema is versioned; pure `v1→v2→…`
migrations run on load — though enum widenings are additive and need no migration.

## CLI (`screenshots ...`) — the primary interface

Status: ✅ shipped · ◻ planned (target surface, not yet implemented — do not assume it exists).

| Command | Action | Status |
|---------|--------|--------|
| `init` | Scaffold the project and standard directories | ✅ |
| `export [--screen --size]` | Export one screen to an exact store size (PNG, no alpha) | ✅ |
| `export [--platform --device --locale]` | Export lead-size PNG **bundles** + zip by platform/device/locale | ✅ |
| `dev` | Run the canvas editor (dev server) | ✅ |
| `screen add / list / rm / reorder` | Manage screens | ✅ |
| `import <dir>` | Ingest raw captures by directory convention | ✅ |
| `font add <file>` | Register a custom font | ◻ Phase 3 |
| `theme set <id>` | Apply a theme to all screens | ◻ Phase 3 |

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
  verification commands.
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

---

# Collaboration rules

General engineering and workflow rules (KISS/SOLID/DRY/YAGNI, commit & PR conventions, branch
naming, verification, escalation) live in **[RULES.md](RULES.md)**. Read it before committing
or opening a PR.
