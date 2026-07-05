# Screenshot Studio

A code-first, open-source editor for App Store and Google Play marketing screenshots:
a visual Konva canvas with screens, editable elements, fonts, themes, and pixel-correct
export to exact store sizes — driven by the same `core` from both a web UI and a CLI.

The project state lives in a single git-trackable JSON file, so decks are versionable,
reproducible, automatable in CI, and give an AI agent a clean contract to work against.

## Documentation

- [docs/vision.md](docs/vision.md) — strategy, positioning, license, distribution _(changes rarely)_
- [docs/architecture.md](docs/architecture.md) — stack, core/shell, data model, render/export parity, CLI & conventions _(the technical contract)_
- [docs/roadmap.md](docs/roadmap.md) — MVP scope, phased plan, technical risks, exit criteria _(changes often)_

## Project structure

Monorepo (pnpm workspaces):

- `packages/core` — framework-agnostic model (Zod schema), render engine, export, fonts,
  asset loading, storage. The single source of truth for rendering (architecture.md §2).
- `packages/cli` — the `screenshots` command (`init`, `export` today; a `dev` wrapper is still to come).
- `apps/web` — the Next.js host: `/editor` (interactive canvas + left panel), `/render`
  (the headless render target the CLI drives for export), and the `/api/project` +
  `/api/asset` routes that back both.
- `fixtures/` — sample projects used by tests and local dev (e.g. `phase-0-sample`).
- `e2e/` — Playwright-driven behavioral gates (render/export parity, editor round-trip,
  left-panel interactions).
- `docs/` — vision, architecture, roadmap, and per-slice design specs/plans.
- `store-specs.json` — Apple/Google export sizes (data, not hardcoded).

A screenshots *project* (the JSON file a user edits, as opposed to this repo) has its own
layout — see [AGENTS.md § Repo conventions](AGENTS.md#repo-conventions-the-api).

## Status

**Phase 0 (render/export parity spike) — done.** One project JSON renders to a pixel-correct
PNG from the same web renderer used by both the browser and the CLI, verified on the hardest
case (an embedded custom font).

**Phase 1 (web editor) — in progress.** The interactive `/editor` canvas is up: `text`,
`shape`, `screenshot`, and `device-frame` elements over a shared render path, with select /
move / resize / rotate, inline text edit, and a screens + layers left panel (reorder, lock,
hide, rename). Still ahead in Phase 1: the per-type inspector and toolbar. Verified multi-size
export bundles are Phase 2 — see [docs/roadmap.md](docs/roadmap.md).

## Requirements

- **Node.js 20+** and **pnpm**.
- A one-time Playwright browser download (the CLI renders through a headless browser):

```bash
pnpm exec playwright install chromium chromium-headless-shell
```

Both browser builds are needed: the parity check compares a headed (`chromium`) render against
a headless (`chromium-headless-shell`) one.

## Install

```bash
git clone <repo> && cd AppReviewPlatform
pnpm install
pnpm exec playwright install chromium chromium-headless-shell
```

## Usage

### CLI (`init` / `export`)

```bash
# Scaffold a project (writes app-store-screenshots.json + standard directories)
pnpm screenshots init --dir ./my-app-screenshots

# Export a screen to an exact store size (PNG, 24-bit RGB, no alpha)
pnpm screenshots export --project ./my-app-screenshots/app-store-screenshots.json
```

`export` flags: `--screen <id>` (defaults to the first screen), `--size <id>` (defaults to
`6.9`, from [store-specs.json](store-specs.json)), `--out <dir>` (defaults to `<project>/export`).

### Editor (Phase 1, in progress)

There's no `screenshots dev` wrapper yet — run the web host directly against a project's JSON:

```bash
PROJECT_PATH=./fixtures/phase-0-sample/app-store-screenshots.json pnpm --filter @screenshot-studio/web dev
```

Open http://localhost:3000/editor. Without `PROJECT_PATH` it defaults to that same fixture —
set it explicitly (or point it at your own project) so autosave doesn't edit the committed
sample.

## Development

```bash
pnpm test        # unit tests (schema, store-specs, export helpers)
pnpm test:e2e    # Phase 0 parity gate: headed-vs-headless render + font fidelity
pnpm typecheck   # all packages
```

`pnpm test:e2e` starts the `apps/web` render host and drives Chromium, so it requires the
Playwright browsers from **Requirements** above.

## License

Apache-2.0 — see [docs/vision.md](docs/vision.md).
