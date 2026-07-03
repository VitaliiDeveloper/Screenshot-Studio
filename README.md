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

## Status

**Phase 0 (render/export parity spike) — done.** One project JSON renders to a pixel-correct
PNG from the same web renderer used by both the browser and the CLI, verified on the hardest
case (an embedded custom font). The canvas editor is Phase 1 and not built yet — see
[docs/roadmap.md](docs/roadmap.md).

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

## Usage (Phase 0 CLI)

```bash
# Scaffold a project (writes app-store-screenshots.json + standard directories)
pnpm screenshots init --dir ./my-app-screenshots

# Export a screen to an exact store size (PNG, 24-bit RGB, no alpha)
pnpm screenshots export --project ./my-app-screenshots/app-store-screenshots.json
```

`export` flags: `--screen <id>` (defaults to the first screen), `--size <id>` (defaults to
`6.9`, from [store-specs.json](store-specs.json)), `--out <dir>` (defaults to `<project>/export`).

The `dev` command (the canvas editor) arrives in Phase 1.

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
