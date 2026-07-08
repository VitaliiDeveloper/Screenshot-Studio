# Screenshot Studio

A code-first, open-source editor for App Store and Google Play marketing screenshots:
a visual Konva canvas with screens, editable elements, fonts, themes, and pixel-correct
export to exact store sizes — driven by the same `core` from both a web UI and a CLI.

The project state lives in a single git-trackable JSON file, so decks are versionable,
reproducible, automatable in CI, and give an AI agent a clean contract to work against.

## Quick start

```bash
git clone <repo> && cd AppReviewPlatform
corepack enable      # resolves the pinned pnpm 11 on a fresh machine
pnpm install
pnpm dev             # editor → http://localhost:3000/editor (opens the bundled sample project)
```

To edit your own project instead of the bundled sample, point `PROJECT_PATH` at its JSON —
relative paths resolve from the directory you run the command in:

```bash
PROJECT_PATH=./my-app-screenshots/app-store-screenshots.json pnpm dev
```

Exporting store-ready PNGs (and the e2e suite) additionally needs a one-time Playwright
browser download — see **Requirements** below.

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

**Phase 1 (web editor) — done.** The interactive `/editor` canvas covers `text`, `shape`,
`screenshot`, and `device-frame` elements over a shared render path, with select / move /
resize / rotate, inline text edit, a screens + layers left panel (reorder, lock, hide, rename),
a per-type inspector (plus a no-selection artboard/background editor), and a toolbar
(insert-on-click for `text`/`shape`, zoom). Phase 2 Slice 2 adds verified lead-size CLI export
bundles; UI export remains a later Phase 2 slice — see [docs/roadmap.md](docs/roadmap.md).

## Requirements

- **Node.js 20+** and **pnpm 11** (pinned in `package.json` via `packageManager`). The simplest
  way to get the exact version on a fresh clone is Corepack:

  ```bash
  corepack enable   # then `pnpm …` in this repo resolves to the pinned pnpm 11.10.0
  ```

  pnpm 10/11 blocks package build scripts by default (`ERR_PNPM_IGNORED_BUILDS`), which would
  leave the headless renderer the e2e/parity suite drives without its native deps. The repo
  allowlists exactly the two builds that matter — `esbuild` and `sharp` — via `allowBuilds` in
  [`pnpm-workspace.yaml`](pnpm-workspace.yaml), so `pnpm install` builds them automatically with
  no manual `pnpm approve-builds` step.
- A one-time Playwright browser download (the CLI renders through a headless browser):

```bash
pnpm exec playwright install chromium chromium-headless-shell
```

Both browser builds are needed: the parity check compares a headed (`chromium`) render against
a headless (`chromium-headless-shell`) one.

## Usage

### CLI (`init` / `export`)

```bash
# Scaffold a project (writes app-store-screenshots.json + standard directories)
pnpm screenshots init --dir ./my-app-screenshots

# Export every screen to its lead store target (PNGs + zip, no alpha)
pnpm screenshots export --project ./my-app-screenshots/app-store-screenshots.json

# Export a filtered lead-size bundle
pnpm screenshots export --project ./my-app-screenshots/app-store-screenshots.json --platform apple --locale en

# Export one screen to an explicit store size
pnpm screenshots export --project ./my-app-screenshots/app-store-screenshots.json --screen hero --size 6.9
```

Bundle `export` flags: optional `--platform <apple|android>`, `--device <iphone|ipad|phone>`,
`--locale <locale>`, and `--out <dir>` (defaults to `<project>/export`). Bundle mode uses the
lead size per device from [store-specs.json](store-specs.json) and writes
`app-store-screenshots-bundle.zip`.

Single-screen `export` flags: `--screen <id>`, optional `--size <id>` (defaults to `6.9`), and
`--out <dir>`.

### Editor

`pnpm dev` (see **Quick start**) runs the web host; open http://localhost:3000/editor.
There's no `screenshots dev` CLI wrapper yet (planned for Phase 2).

Without `PROJECT_PATH` the editor opens the committed sample
(`fixtures/phase-0-sample/app-store-screenshots.json`) — fine for a first look, but the
editor **autosaves to disk**, so point `PROJECT_PATH` at your own project before real edits,
or `git checkout` the fixture afterwards.

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
