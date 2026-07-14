# Screenshot Studio

A code-first, open-source editor for App Store and Google Play marketing screenshots:
a visual Konva canvas with screens, editable elements, fonts, themes, and pixel-correct
export to exact store sizes — driven by the same `core` from both a web UI and a CLI.

The project state lives in a single git-trackable JSON file, so decks are versionable,
reproducible, automatable in CI, and give an AI agent a clean contract to work against.

## Quick start

```bash
git clone https://github.com/VitaliiDeveloper/Screenshot-Studio.git && cd Screenshot-Studio
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

To build the installable CLI artifact locally (this does not publish it):

```bash
pnpm build:cli-package
pnpm --dir packages/cli/package pack
pnpm add --global ./packages/cli/package/screenshot-studio-cli-0.1.0.tgz
screenshots init --dir ./my-app-screenshots
```

The resulting package contains a built `screenshots` bin and the prebuilt shared Next render host;
it does not need the monorepo or `tsx` after installation. Version `0.1.0` is a dry-run candidate;
it is not a registry release.

The optional Codex skill can be installed from the same checkout after the CLI artifact is made
available on `PATH`:

```bash
mkdir -p ~/.codex/skills
cp -R skills/screenshot-studio ~/.codex/skills/screenshot-studio
```

It only discovers or initializes a project and then follows the generated project-local
`AGENTS.md`; normal CLI/editor use does not require the skill or any AI provider.

## Documentation

- [docs/architecture.md](docs/architecture.md) — stack, core/shell, data model, render/export parity, CLI & conventions _(the technical contract)_
- [docs/releasing.md](docs/releasing.md) — candidate verification, publication boundary, upgrade, and uninstall

## Project structure

Monorepo (pnpm workspaces):

- `packages/core` — framework-agnostic model (Zod schema), render engine, export, fonts, themes,
  asset loading, storage. The single source of truth for rendering (architecture.md §2).
- `packages/cli` — the `screenshots` command (`init`, `dev`, `export`, screen/import/font/theme/locale/canvas
  management, and non-destructive local asset processing).
- `apps/web` — the Next.js host: `/editor` (interactive multi-artboard workspace), `/render`
  (the headless render target the CLI drives for export), and the `/api/project` +
  `/api/asset` routes that back both.
- `fixtures/` — sample projects used by tests and local dev (e.g. `sample` and behavior-named regressions).
- `examples/` — self-contained v1 connected and RTL projects that are validated, edited, and
  exported in the closure suite.
- `e2e/` — Playwright-driven behavioral gates (render/export parity, editor round-trip,
  left-panel interactions).
- `docs/` — current architecture, operational guides, and tracked product contracts.
- `store-specs.json` — Apple/Google export sizes (data, not hardcoded).

A screenshots *project* (the JSON file a user edits, as opposed to this repo) has its own
layout — see [the management-interface contract](docs/architecture.md).

## Current capabilities

- **One strict project document.** A complete strict schema v1 JSON file owns project metadata, output
  families, locales, fonts, screens, backgrounds, elements, groups, crop/style literals, and store
  target variants. Historical internal development formats are intentionally unsupported.
- **One UI/CLI renderer.** The editor, previews, exact exports, bundles, and packaged CLI all use the
  same Konva stage through the Chromium render host. Store PNGs are exact-size and opaque.
- **Visual authoring.** The responsive workbench supports Focus and Overview, isolated or connected
  canvases, owner-aware multi-selection, one-level groups, Layers, history, snapping/guides, zoom,
  inline text editing, and schema-bounded inspectors.
- **Complete element surface.** Text, shapes, screenshots, decorative images, trusted vector icons,
  trusted device frames, editable badge groups, solid/gradient/project-image backgrounds, media
  crop controls, text shadow, shape gradients, and strokes share render/export parity.
- **Reusable project resources.** File-backed custom and Google fonts, baked themes, templates,
  secure project assets, local auto-crop, and flat/near-uniform background removal work through the
  editor and CLI without adding provider-dependent project state.
- **Store and locale workflows.** Independent Apple, Android, and Windows output families, explicit
  fresh-id store target variants, complete locale sets, baked RTL layout, and collision-safe
  platform/device/locale bundles are supported.
- **CLI and agent workflows.** The installable `screenshots` CLI manages projects, screens, imports,
  fonts, themes, locales, canvas mode, local assets, and exports. Generated project-local agent
  guidance and the optional thin skill operate on the same strict JSON and CLI contract.

Version `0.1.0` remains an unpublished dry-run candidate. Building or verifying it does not create
an npm publication, Git tag, GitHub release, or announcement; see [docs/releasing.md](docs/releasing.md).

## Requirements

- **Node.js 22.13+** and **pnpm 11** (pinned in `package.json` via `engines` and
  `packageManager`). The simplest
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

Contributors running the dedicated accessibility/cross-browser smoke also need its two additional
local browser engines (they are not CLI runtime dependencies):

```bash
pnpm exec playwright install firefox webkit
```

## Usage

### CLI (`init` / `export` / project management)

```bash
# Scaffold a project (writes JSON, standard directories, AGENTS.md, and CLAUDE.md)
pnpm screenshots init --dir ./my-app-screenshots

# Export every screen to its lead store target (PNGs + zip, no alpha)
pnpm screenshots export --project ./my-app-screenshots/app-store-screenshots.json

# Export a filtered lead-size bundle
pnpm screenshots export --project ./my-app-screenshots/app-store-screenshots.json --platform apple --locale en

# Export one screen to an explicit store size
pnpm screenshots export --project ./my-app-screenshots/app-store-screenshots.json --screen hero --size 6.9

# Manage project order (the relative order within each export group)
pnpm screenshots screen list --project ./my-app-screenshots/app-store-screenshots.json
pnpm screenshots screen add --project ./my-app-screenshots/app-store-screenshots.json --platform apple --device iphone --locale en --name "Hero"
pnpm screenshots screen reorder hero --to 1 --project ./my-app-screenshots/app-store-screenshots.json

# Clone and manage complete locale sets; RTL conversion is baked into project geometry
pnpm screenshots locale add ar --from en --direction rtl --project ./my-app-screenshots/app-store-screenshots.json
pnpm screenshots locale list --project ./my-app-screenshots/app-store-screenshots.json
pnpm screenshots locale direction ar --to ltr --project ./my-app-screenshots/app-store-screenshots.json

# Import PNG captures from screenshots/apple/{iphone,ipad}/{locale}/NN.png or screenshots/android/phone/{locale}/NN.png
pnpm screenshots import ./my-app-screenshots/screenshots --project ./my-app-screenshots/app-store-screenshots.json

# Manage deterministic font files and bake a theme into role-tagged elements
pnpm screenshots font add ./Inter.ttf --family Inter --weight 700 --project ./my-app-screenshots/app-store-screenshots.json
pnpm screenshots theme set midnight --project ./my-app-screenshots/app-store-screenshots.json

# Create non-destructive local processed assets (printed paths can then be assigned to assetUrl)
pnpm screenshots asset auto-crop assets/icons/product.png --threshold 10 --project ./my-app-screenshots/app-store-screenshots.json
pnpm screenshots asset remove-background assets/icons/product.png --background FFFFFF --tolerance 24 --project ./my-app-screenshots/app-store-screenshots.json
```

Bundle `export` flags: optional `--platform <apple|android|windows>`,
`--device <iphone|ipad|macos|tvos|watchos|phone|desktop>`,
`--locale <locale>`, and `--out <dir>` (defaults to `<project>/export`). Bundle mode uses the
lead size per device from [store-specs.json](store-specs.json) and writes
`app-store-screenshots-bundle.zip`. PNGs use
`platform/device/<safe-locale>/NN-<screen>-<size>.png`: the locale folder collision-safely encodes
the exact stored identifier, and numbering restarts at `01` for each platform/device/locale group.
`--locale` filtering still compares the exact stored string.

Single-screen `export` flags: `--screen <id>`, optional `--size <id>` (defaults to `6.9`), and
`--out <dir>`.

Screen commands mutate the same strict JSON source of truth. `screen list` prints project order;
within each export group that relative order becomes the `01`, `02`, … store-slot order.
`screen rm <id>` refuses to remove the last screen, and `screen reorder <id> --to <position>` uses
1-based positions.

Locale commands delegate to the same core transformations as the editor. `locale add` clones a
source set with fresh ids and shared asset paths, `locale direction` changes placement only when the
stored direction changes, and `locale rm` protects the last locale.

An initialized project's `AGENTS.md` is the self-contained agent workflow: it documents strict v1
guardrails and exact recipes for copy generation, literal layout, locale translation, and local asset
processing. Init preflights the JSON and both agent control files and refuses to overwrite any of them.

Asset inputs resolve relative to the project root and must remain inside it after real-path/symlink
resolution. Results are collision-safe PNGs under `assets/processed/`; neither command updates project
JSON automatically. Background removal targets edge-connected flat or near-uniform colours and is not
semantic object/person segmentation for complex scenes.

### Editor

`pnpm dev` (see **Quick start**) runs the web host; open http://localhost:3000/editor.
`pnpm screenshots dev --project ./my-app-screenshots/app-store-screenshots.json` runs the same
editor through the CLI and prints the selected local URL.

Without `PROJECT_PATH` the editor opens the committed sample
(`fixtures/sample/app-store-screenshots.json`) — fine for a first look, but the
editor **autosaves to disk**, so point `PROJECT_PATH` at your own project before real edits,
or `git checkout` the fixture afterwards.

The Resources shelf manages file-backed fonts, applies `themes/*.json`, and creates screens from
strict `templates/*.json`. The Add shelf inserts text, shape, and trusted built-in icons directly;
opens the safe project-local asset picker for screenshot, iPhone-frame, decorative image, and
official store-badge assets; and creates editable rating/press-proof badge groups when a registered
font is available. The top bar selects and manages complete locale sets; Screens and Overview show
the active locale in isolated mode or the active exact platform/device/locale group in connected
mode. Inline editing and new text honor the active screen's LTR/RTL direction.

Template screens inherit the active screen's locale and direction while using the template's
explicit platform, device, artboard, background, and element layout. LTR-authored geometry is
mirrored exactly once when a template is instantiated into an RTL locale.

## Development

```bash
pnpm test              # full unit suite
pnpm test:core         # core unit tests only
pnpm test:cli          # CLI unit tests only
pnpm test:web          # web unit tests only
pnpm test:e2e:parity:foundation # base renderer/font/media/RTL/connected parity
pnpm test:e2e:parity:elements   # group/image/icon/badge parity
pnpm test:e2e:export   # CLI + UI export paths
pnpm test:e2e:editor:interaction # canvas/panels/inspector/history/snapping
pnpm test:e2e:editor:workspace   # locale/connected/responsive workspace
pnpm test:e2e:editor:authoring   # fonts/themes/templates/assets/group authoring
pnpm test:e2e:accessibility # desktop + compact Axe states
pnpm test:e2e:browsers # Chromium/Firefox/WebKit editor smoke
pnpm test:e2e:package  # production build + packed temp-install/export smoke
pnpm test:e2e:skill    # optional skill install + clean-project bootstrap smoke
pnpm test:e2e:examples # validate and export the living example projects
pnpm test:e2e:ci       # targeted browser subset automated on pushes to dev
pnpm test:e2e:release-surfaces # browsers/package/skill/examples aggregate
pnpm test:e2e          # full browser gate (dev -> main CI only; do not run locally)
pnpm build:cli-package # assemble the installable CLI + standalone render host
pnpm audit:release     # pack and audit files, runtime deps/licenses, portability, and size
pnpm check:release-candidate # audit candidate version, metadata, and public docs
pnpm check:spdx        # enforce Apache-2.0 headers on authored source files
pnpm typecheck         # all packages
```

Unit/package scripts are the normal implementation-loop checks. Run a browser E2E only for a
specific changed workflow that requires it, preferring an exact Vitest file over a leaf group. The
unsuffixed parity/editor commands remain aggregates. Do not run `pnpm test:e2e` locally: GitHub CI
owns the full browser gate for the integration PR from `dev` into `main`. See the ownership and cost
matrix in [`docs/testing.md`](docs/testing.md).

## License

Apache-2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE). Contributions are welcome under the same
terms; see [CONTRIBUTING.md](CONTRIBUTING.md).
