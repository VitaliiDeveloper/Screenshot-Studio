# AGENTS.md — Screenshot Studio

Instructions for any CLI agent (Claude Code, Cursor, etc.) working inside this repo.
This file is the management interface: the conventions, schema, CLI, and guardrails an
agent needs to generate copy, lay out slides, and translate locales — no skill required.

> **Status: Phase 0 + Phase 1 implemented and verified; Phase 2 (verified export) is next.**
> The render/export core and the web editor are built and tested; some CLI commands in the
> table below are still planned (marked ◻). Read `docs/` for the full rationale before
> generating anything. When in doubt, follow `docs/architecture.md` (the technical contract) —
> it wins over this summary.

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
| `dev` | Run the canvas editor (dev server) | ◻ Phase 2 |
| `screen add / list / rm / reorder` | Manage screens | ◻ Phase 2 |
| `import <dir>` | Ingest raw captures by directory convention | ◻ Phase 2 |
| `export [--platform --device --locale]` | Exact PNG **bundles** by platform/device/locale | ◻ Phase 2 |
| `font add <file>` | Register a custom font | ◻ Phase 3 |
| `theme set <id>` | Apply a theme to all screens | ◻ Phase 3 |

Today `export` writes a single screen (`--screen`, `--size`); the multi-target bundle form is
Phase 2. Export sizes live in `store-specs.json` (data, not hardcode), with Vitest dimension tests.
Strip the alpha channel on export — stores require no transparency. See architecture §4.

## Design guardrails (always apply when generating slides/copy)

- Screenshots are ads, not documentation.
- Each slide sells one clear user outcome.
- The headline passes the one-second thumbnail test.
- Adjacent slides vary layout and device placement.
- Cross-screen (connected) elements never split required text or critical UI.
- Every exported crop works as a standalone screenshot.

---

# Collaboration rules

General engineering and workflow rules (KISS/SOLID/DRY/YAGNI, commit & PR conventions, branch
naming, verification, escalation) live in **[RULES.md](RULES.md)**. Read it before committing
or opening a PR.
