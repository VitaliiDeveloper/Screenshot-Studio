# Screenshot Studio

A code-first, open-source editor for App Store, Google Play, and Microsoft Store marketing
screenshots:
a visual Konva canvas with screens, editable elements, fonts, themes, and pixel-correct
export to exact store sizes — driven by the same `core` from both a web UI and a CLI.

The project state lives in a single git-trackable JSON file, so decks are versionable,
reproducible, automatable in CI, and give an AI agent a clean contract to work against.

## Quick start

```bash
git clone https://github.com/VitaliiDeveloper/Screenshot-Studio.git && cd Screenshot-Studio
corepack enable      # resolves the pinned pnpm 11 on a fresh machine
pnpm install
pnpm dev             # App Home → http://localhost:3000
```

Without an explicit project source, App Home reports that no project is active and never opens or
autosaves the bundled sample. The Launcher 1/7 foundation intentionally does not expose a browser
filesystem-path form. Start a local project explicitly with `PROJECT_PATH=... pnpm dev` or
`screenshots dev --project ...`; browser Folder/ZIP/JSON import is delivered through managed project
storage in later launcher slices.

For example:

```bash
PROJECT_PATH=/absolute/path/to/my-app-screenshots/app-store-screenshots.json pnpm dev
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
- `packages/cli` — the `screenshots` command (`init`, `dev`, `export`, layout/screen/import/font/theme/locale
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
- `store-specs.json` — Apple, Google, and Microsoft export sizes (data, not hardcoded).

A screenshots *project* (the JSON file a user edits, as opposed to this repo) owns one or more
independent layouts — see [the management-interface contract](docs/architecture.md).

## Current capabilities

- **One strict project document.** A complete strict schema v1 JSON file owns shared metadata/fonts
  plus ordered independent design layouts. Each layout owns immutable mode, output families,
  locales, screens, backgrounds, elements, groups, crop/style literals, and store target variants.
  Historical internal development formats are intentionally unsupported.
- **One UI/CLI renderer.** The editor, previews, exact exports, bundles, and packaged CLI all use the
  same Konva stage through the Chromium render host. Store PNGs are exact-size and opaque.
- **Visual authoring.** The responsive workbench supports unconditional layout switching, clean
  creation, fresh-id duplication, rename/prefer/delete lifecycle actions, Focus and Overview,
  isolated or connected canvases, owner-aware multi-selection, one-level groups, per-layout
  history, snapping/guides, zoom, inline text editing, and schema-bounded inspectors.
- **Complete element surface.** Text, shapes, screenshots, decorative images, trusted vector icons,
  trusted device frames, editable badge groups, solid/gradient/project-image backgrounds, media
  crop controls, text shadow, shape gradients, and strokes share render/export parity.
- **Reusable project resources.** File-backed custom and Google fonts, baked themes, templates,
  secure project assets, local auto-crop, and flat/near-uniform background removal work through the
  editor and CLI without adding provider-dependent project state.
- **Store and locale workflows.** Independent Apple, Android, and Windows output families, explicit
  fresh-id store target variants, complete locale sets, baked RTL layout, and collision-safe
  platform/device/locale bundles are supported.
- **CLI and agent workflows.** The installable `screenshots` CLI manages layouts, screens, imports,
  fonts, themes, locales, local assets, and preferred or explicitly selected layout exports. Generated project-local agent
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

# Manage independent layouts
pnpm screenshots layout list --project ./my-app-screenshots/app-store-screenshots.json
pnpm screenshots layout add "Feature campaign" --mode connected --project ./my-app-screenshots/app-store-screenshots.json
pnpm screenshots layout duplicate "Feature campaign" --name "Feature campaign B" --project ./my-app-screenshots/app-store-screenshots.json
pnpm screenshots layout rename "Feature campaign B" "Feature story" --project ./my-app-screenshots/app-store-screenshots.json
pnpm screenshots layout mode "Feature story" --mode isolated --project ./my-app-screenshots/app-store-screenshots.json
pnpm screenshots layout prefer "Feature story" --project ./my-app-screenshots/app-store-screenshots.json
pnpm screenshots layout rm "Feature story" --project ./my-app-screenshots/app-store-screenshots.json

# Export the preferred layout, or select one explicitly with --layout
pnpm screenshots export --project ./my-app-screenshots/app-store-screenshots.json
pnpm screenshots export --layout "Feature campaign" --project ./my-app-screenshots/app-store-screenshots.json

# Export a filtered root-and-variant bundle
pnpm screenshots export --project ./my-app-screenshots/app-store-screenshots.json --platform apple --locale en

# Export one screen to an explicit store size
pnpm screenshots export --project ./my-app-screenshots/app-store-screenshots.json --screen hero --size 6.9

# Manage layout-local screen order (multi-layout projects require --layout)
pnpm screenshots screen list --layout "Feature campaign" --project ./my-app-screenshots/app-store-screenshots.json
pnpm screenshots screen add --layout "Feature campaign" --project ./my-app-screenshots/app-store-screenshots.json --platform apple --device iphone --locale en --name "Hero"
pnpm screenshots screen reorder hero --to 1 --layout "Feature campaign" --project ./my-app-screenshots/app-store-screenshots.json
pnpm screenshots screen rm hero --cascade --layout "Feature campaign" --project ./my-app-screenshots/app-store-screenshots.json

# Clone and manage complete locale sets; RTL conversion is baked into project geometry
pnpm screenshots locale add ar --from en --direction rtl --layout "Feature campaign" --project ./my-app-screenshots/app-store-screenshots.json
pnpm screenshots locale list --layout "Feature campaign" --project ./my-app-screenshots/app-store-screenshots.json
pnpm screenshots locale direction ar --to ltr --layout "Feature campaign" --project ./my-app-screenshots/app-store-screenshots.json

# Import PNG captures from screenshots/apple/{iphone,ipad}/{locale}/NN.png or screenshots/android/phone/{locale}/NN.png
pnpm screenshots import ./my-app-screenshots/screenshots --layout "Feature campaign" --project ./my-app-screenshots/app-store-screenshots.json

# Manage deterministic font files and bake a theme into role-tagged elements
pnpm screenshots font add ./Inter.ttf --family Inter --weight 700 --project ./my-app-screenshots/app-store-screenshots.json
pnpm screenshots theme set midnight --layout "Feature campaign" --project ./my-app-screenshots/app-store-screenshots.json

# Create non-destructive local processed assets (printed paths can then be assigned to assetUrl)
pnpm screenshots asset auto-crop assets/icons/product.png --threshold 10 --project ./my-app-screenshots/app-store-screenshots.json
pnpm screenshots asset remove-background assets/icons/product.png --background FFFFFF --tolerance 24 --project ./my-app-screenshots/app-store-screenshots.json
```

Layout-aware mutation commands infer the target only for one-layout projects; otherwise pass
`--layout <id-or-full-name>`. `export` instead defaults to `preferredExportLayoutId`, while the
editor exports its locally active layout. `dev`, `screen`, and `export` accept
`--store-specs <path>` when a project needs an explicit
store-spec override; otherwise the source checkout or packaged CLI uses its bundled
[store-specs.json](store-specs.json).

Bundle `export` flags: optional `--layout <id-or-full-name>`, `--platform <apple|android|windows>`,
`--device <iphone|ipad|macos|tvos|watchos|phone|desktop>`,
`--locale <locale>`, and `--out <dir>` (defaults to `<project>/export`). Bundle mode exports each
locale root at its device lead target and all explicit persisted variants at their own target,
then writes
`app-store-screenshots-bundle.zip`. PNGs use
`platform/device/<safe-locale>/NN-<screen>-<size>.png`: the locale folder collision-safely encodes
the exact stored identifier, and numbering restarts at `01` for each
platform/device/locale/target group.
`--locale` filtering still compares the exact stored string.

Single-screen `export` flags: `--screen <id>`, optional `--size <id>`, and `--out <dir>`. Target
precedence is explicit `--size`, the screen’s persisted `storeTargetId`, then that device’s lead
target from the active store specs.

Screen commands mutate the same strict JSON source of truth. `screen list` prints layout-local order;
within each export group that relative order becomes the `01`, `02`, … store-slot order.
`screen add --size` accepts only the selected device’s lead target because non-lead outputs are
persisted variants. `screen rm <id>` protects the last root in a locale and refuses to remove a
root that still owns variants; `screen rm <id> --cascade` removes that root and its variants.
`screen reorder <id> --to <position>` uses 1-based positions.

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

`pnpm dev` (see **Quick start**) runs the no-active-project App Home at http://localhost:3000. To open
a local project in the current foundation, set `PROJECT_PATH` to an existing absolute
`app-store-screenshots.json` path before starting the host, or run
`screenshots dev --project /absolute/path/to/app-store-screenshots.json`. Both seed the same
local-file session; App Home itself does not ask the user to paste a filesystem path.

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
