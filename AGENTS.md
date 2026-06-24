# AGENTS.md — Screenshot Studio

Instructions for any CLI agent (Claude Code, Cursor, etc.) working inside this repo.
This file is the management interface: the conventions, schema, CLI, and guardrails an
agent needs to generate copy, lay out slides, and translate locales — no skill required.

> **Status: planning.** The code is not built yet; the contracts below are the target.
> Read `docs/` for the full rationale before generating anything. When in doubt, follow
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

```
Project
├── meta: { name, appIcon, schemaVersion }
├── platforms: ["apple", "android"]
├── locales: ["en", "de", "ar"]            # ar → RTL
├── themes: Theme[]                        # tokens: colors, fonts, spacing
├── fonts: FontAsset[]                     # system / google / uploaded(base64)
└── screens: Screen[]
    ├── id, name, platform, device, locale
    ├── artboard: { width, height }
    ├── background: solid | gradient | image
    └── elements: Element[]                # z-order = array order
```

Element base: `id, type, x, y, width, height, rotation, opacity, locked, visible`.
Types: `text`, `screenshot`, `device-frame`, `shape`, `icon`, `badge`, `image`.
MVP elements: `text`, `screenshot`, `device-frame`, `shape`. Artboards are **isolated**
(no connected canvas in the MVP). Schema is versioned; pure `v1→v2→…` migrations run on load.

## CLI (`screenshots ...`) — the primary interface

| Command | Action |
|---------|--------|
| `init` | Scaffold the project and standard directories |
| `dev` | Run the canvas editor (dev server) |
| `screen add / list / rm / reorder` | Manage screens |
| `font add <file>` | Register a custom font |
| `theme set <id>` | Apply a theme to all screens |
| `import <dir>` | Ingest raw captures by directory convention |
| `export [--platform --device --locale]` | Exact PNG bundles (same result as the UI button) |

Export sizes live in `store-specs.json` (data, not hardcode), with Vitest dimension tests.
Strip the alpha channel on export — stores require no transparency. See architecture §4.

## Design guardrails (always apply when generating slides/copy)

- Screenshots are ads, not documentation.
- Each slide sells one clear user outcome.
- The headline passes the one-second thumbnail test.
- Adjacent slides vary layout and device placement.
- Cross-screen (connected) elements never split required text or critical UI.
- Every exported crop works as a standalone screenshot.
