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

Without an explicit project source, App Home never opens or autosaves the bundled sample. Import an
existing complete project from a **Folder** (recommended), a project ZIP, or an eligible standalone
`app-store-screenshots.json`. Browser import validates the selection and creates a managed copy; it
does not edit the selected source in place. Local self-hosted workflows may still start explicitly
with `PROJECT_PATH=... pnpm dev` or `screenshots dev --project ...`. App Home intentionally exposes no
browser filesystem-path form. After source selection, App Home asks for managed-copy confirmation
before upload or server staging begins. Its bounded Recent projects list persists successful opens
without exposing local paths; Close project preserves that history, while Remove from recents changes
history only. Four starter examples route isolated, connected, RTL/multi-locale, and screenshot-import
workflows through the same strict creation/import contracts used by ordinary projects.

For example:

```bash
PROJECT_PATH=/absolute/path/to/my-app-screenshots/app-store-screenshots.json pnpm dev
```

To open the bundled sample directly in place from the repository root:

```bash
PROJECT_PATH="$PWD/fixtures/sample/app-store-screenshots.json" pnpm dev
# Equivalent monorepo CLI entry point:
pnpm screenshots dev --project "$PWD/fixtures/sample/app-store-screenshots.json"
```

Both commands start the host with the sample as a `local-file` project. Opening the root URL lists
the configured source in **Recent projects**, and its card opens `/editor` directly. The CLI also
prints the direct `/editor` URL. **Project details** remains available from the card overflow menu.
Editor saves update `fixtures/sample` directly, so copy the fixture to a separate directory first
when experimenting with changes you do not want to keep.

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

- [docs/architecture.md](docs/architecture.md) — data model, source/session boundaries, rendering,
  export, and CLI architecture _(the technical contract)_
- [docs/editor.md](docs/editor.md) — durable editor interaction, navigation, and accessibility semantics
- [docs/testing.md](docs/testing.md) — test ownership, exact browser groups, and CI policy
- [docs/project-mutation-locking.md](docs/project-mutation-locking.md) — concurrent project-write contract
- [docs/safe-file-publication.md](docs/safe-file-publication.md) — asset and output publication safety
- [docs/releasing.md](docs/releasing.md) — candidate verification, publication boundary, upgrade, and uninstall

## Project structure

Monorepo (pnpm workspaces):

- `packages/core` — framework-agnostic model (Zod schema), render engine, export, fonts, themes,
  asset loading, storage. The single source of truth for rendering (architecture.md).
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
- `store-specs.json` — Apple, Android, Windows, and Web output families and exact sizes (data, not hardcoded).

A screenshots *project* (the JSON file a user edits, as opposed to this repo) owns one or more
independent layouts — see [the management-interface contract](docs/architecture.md).

## Built-in and project-local resources

A new project may have no images or project-local template files yet, but it is not an empty
editor. Screenshot Studio ships a read-only built-in catalog with the application, so its resources
are available in every project without being copied into `app-store-screenshots.json`:

- **Screen starters.** Create project offers iPhone, iPad portrait, Android phone, Android tablet
  portrait, Play Feature Graphic, Web desktop, and Web mobile starters. The Resources → Screen
  templates library also includes landscape iPad and Android tablet starters. Choosing one creates
  an ordinary editable screen in the current project; it does not retain a link to the catalog.
- **Design Packs.** Built-in packs provide shared semantic palette, typography, and spacing values.
  Applying a pack bakes those values into role-tagged editable elements, rather than storing a
  global pack reference in the project.
- **Frames and fonts.** The editor ships trusted phone, tablet, and browser frame types plus a
  small built-in font catalog. Frame slots are initially empty and accept a project screenshot.
- **Store targets.** Exact platform/device dimensions and non-device output targets are defined in
  [`store-specs.json`](store-specs.json). Google Play Feature Graphic is an Android promotion
  output target, not an Android device; a Feature Graphic starter exports one 1024×500 graphic by
  default.

Project-local resources are portable files next to the project document. A project commonly has
this shape (folders appear when that resource type is used):

```text
my-app-screenshots/
├── app-store-screenshots.json   # the only persisted project document
├── assets/                      # images, imported assets, uploaded fonts, processed assets
├── screenshots/                 # screenshot captures for import
├── templates/<id>.json          # reusable screen templates for this project only
└── themes/<id>.json             # project-specific theme definitions
```

Use **Create project** for a complete first screen and **Resources → Screen templates** to add
further built-in or project-local screens. Project-specific themes live in `themes/*.json`; their
values, like a Design Pack's values, are baked into the screen on application. **Web Share** is
different from both a device and a platform: `screenshots export --profile web-share` packages
already-rendered screenshots into a local shareable web bundle and never hosts or deploys it.

For contributors, the global catalogs live in
[`packages/core/src/templates/index.ts`](packages/core/src/templates/index.ts),
[`packages/core/src/themes/index.ts`](packages/core/src/themes/index.ts), and
[`packages/core/src/model/device-frames.ts`](packages/core/src/model/device-frames.ts); adding a
new platform or output family also requires the corresponding strict schema and store-spec changes.

## Current capabilities

- **One strict project document.** A complete strict schema v1 JSON file owns shared metadata/fonts
  plus ordered independent design layouts. Each layout owns immutable mode, output families,
  locales, screens, backgrounds, elements, groups, crop/style literals, and store target variants.
  Historical internal development formats are intentionally unsupported.
- **One UI/CLI renderer.** The editor, previews, exact exports, bundles, and packaged CLI all use the
  same Konva stage through the Chromium render host. Store PNGs are exact-size and opaque.
- **Shared project creation.** CLI init and App Home managed creation use one strict scaffold factory
  for Blank, generic project templates, and platform-aware built-in screen starters while retaining
  explicit-local versus managed destination ownership. Starters are materialized through the shared
  template flow and are not persisted schema fields or copied template resources.
- **Launcher closure.** App Home provides durable bounded recent-project history and four normal
  starter workflows. Source locators remain server-only application state; Close, Remove from recents,
  and managed-only permanent deletion have separate non-overlapping effects.
- **Visual authoring.** The responsive workbench supports unconditional layout switching, clean
  creation, fresh-id duplication, rename/prefer/delete lifecycle actions, Focus and Overview,
  isolated or connected canvases, owner-aware multi-selection, one-level groups, per-layout
  history, snapping/guides, zoom, inline text editing, and schema-bounded inspectors.
- **Complete element surface.** Text, shapes, screenshots, decorative images, trusted vector icons,
  trusted device frames, editable badge groups, solid/gradient/project-image backgrounds, media
  crop controls, text shadow, shape gradients, and strokes share render/export parity.
- **Reusable project resources.** File-backed custom and Google fonts, baked project themes, global
  read-only Design Packs, templates,
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

Bundle `export` flags: optional `--layout <id-or-full-name>`,
`--platform <apple|android|windows|web>`,
`--device <iphone|ipad|macos|tvos|watchos|phone|tablet-7|tablet-10|desktop|laptop|tablet|mobile>`,
`--locale <locale>`, and `--out <dir>` (defaults to `<project>/export`). Bundle mode exports each
locale root at its device lead target and all explicit persisted variants at their own target,
then writes
`app-store-screenshots-bundle.zip`. PNGs use
`platform/device/<safe-locale>/NN-<screen>-<size>.png`: the locale folder collision-safely encodes
the exact stored identifier, and numbering restarts at `01` for each
platform/device/locale/target group.
`--locale` filtering still compares the exact stored string.

`--profile web-share` creates a portable local-only `web-share/` package containing responsive
`index.html`, `assets/`, shared-renderer PNGs under `screenshots/`, `og-image.png`, and
`manifest.json`. It is an export profile, not the Web platform, and performs no hosting or deployment.

Single-screen `export` flags: `--screen <id>`, optional `--size <id>`, and `--out <dir>`. Target
precedence is explicit `--size`, the screen’s persisted `storeTargetId`, then that device’s lead
target from the active store specs.

Screen commands mutate the same strict JSON source of truth. `screen list` prints layout-local order;
within each export group that relative order becomes the `01`, `02`, … store-slot order.
`screen add --size` accepts only the selected device’s lead target because non-lead outputs are
persisted variants. `screen rm <id>` protects the last primary screen in a locale. Under the default
independent policy, removing a primary preserves any paired exact-size screens as standalone
composition; `screen rm <id> --cascade` explicitly removes the primary and its paired variants.
`screen reorder <id> --to <position>` uses 1-based positions. These mutations honor the persisted
output-family screen-slot policy: independent rows stay independent, while `Keep 1:1` mirrors logical
slot add/delete/order across sizes without sharing layer content.

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

`pnpm dev` (see **Quick start**) runs App Home at http://localhost:3000. **Import project** accepts a
complete Folder, project ZIP, or standalone JSON. Folder/ZIP is required when the strict project
references screenshots, uploaded fonts, an app icon, or other project-local resources; a failed JSON
import lists the missing paths so the complete source can be chosen. Import is bounded by
`SCREENSHOT_STUDIO_MAX_IMPORT_UPLOAD_BYTES` (256 MiB by default),
`SCREENSHOT_STUDIO_MAX_PROJECT_FILES`, and `SCREENSHOT_STUDIO_MAX_PROJECT_BYTES`, then atomically
activates the managed copy and opens Workspace. Selection remains in the browser until the user
confirms the managed copy; choosing another source, cancellation, or failure preserves the previous
active session.

**Create project** captures a project name, store platform, and isolated or connected initial layout,
then offers **Blank**, supported generic project templates, and platform-aware built-ins: iPhone and
iPad portrait; Android phone, Android tablet portrait, and Play Feature Graphic; or Web desktop and
Web mobile. Built-ins use the same screen-template materializer as onboarding and Resources, need no
pre-existing assets, and keep device-frame slots empty and assignable. The browser never accepts a
server path: it validates and atomically publishes into managed storage, activates the new session,
and opens Workspace. CLI
`screenshots init --dir <directory>` uses the same scaffold contract with an explicit local destination.

**Capture import** is distinct from complete project import. Choose a directory containing the
documented `screenshots/<platform>/<device>/<locale>/<file>.png` structure (and supported `assets/`
when selecting the project root), explicitly select the current project/layout or a named new managed
project, review the no-write counts, planned fresh ids/resource paths, warnings, and invalid entries,
then confirm. Current-project requests are fenced by active project identity and revision; new-project
destinations reuse the same strict scaffold and atomic managed publication as **Create project**.
Failure rolls back Project/resource changes or managed publication, and success opens only the
verified receiving Workspace. The CLI command remains supported through the same discovery and
atomic apply services:

```bash
pnpm screenshots import ./my-app-screenshots --layout "Feature campaign" --project ./my-app-screenshots/app-store-screenshots.json
```

Each project card opens Workspace directly. Its overflow menu opens a preview-first **Project
details** view with shared-renderer screen previews, compact layout/output metadata, and any known
project issues. The same card menu can **Export archive** as `screenshot-studio-project.zip`. This
archive action is also available beside **Open in Editor** in Project details. This portable
archive contains the strict document and supported project resources, and can be imported again from
App Home. It excludes managed catalog/session state, locks, staging/temp files, credentials, rendered
store output, and other unsupported paths. Project archive export is a backup/transfer action; it is
separate from Workspace store-image export. To open an existing local project in place instead, set
`PROJECT_PATH` to an absolute `app-store-screenshots.json` before starting the host, or run
`screenshots dev --project /absolute/path/to/app-store-screenshots.json`.

The managed-project card menu also provides **Delete project…**. It is distinct from **Close
project** in the Project details overflow, is never shown for a local-file source, and cannot target
an arbitrary path. Before
confirmation you can download the same portable archive or explicitly continue without one. The
dialog requires the exact project name plus an irreversible acknowledgement; a failed archive or
unsaved Workspace change does not start deletion. Success removes the managed copy and its
project-local resources and returns to App Home. There is no Trash or Restore surface, so use the
archive option when a future import copy may be needed. The originally selected Folder/ZIP/JSON input
is never modified by deleting its managed copy.

App Home **Recent projects** records successful managed/local opens and managed creation/import/capture
activation outside Project JSON. It is ordered by most recent use, bounded, survives restart, filters
deleted managed catalog entries, and keeps stale local sources safely removable. **Open project**
activates through the ordinary session boundary. **Remove from recents** removes history only; it does
not Close project, move anything to Trash, delete managed storage, or modify a local source.

The Resources shelf manages file-backed fonts, applies global read-only Design Packs or
`themes/*.json`, and creates screens from a global read-only built-in catalog or strict project-local
templates in `templates/*.json`. Packs bake palette, typography, and supported spacing literals with
no persisted global reference. Built-ins are available without copying resource files and materialize
ordinary editable screens. Empty
projects offer family-specific starters, capture import, and a blank-screen path. The Add shelf
inserts text, shape, and
trusted built-in icons directly;
separates empty device-mockup creation from placing/replacing a local screenshot; opens the safe
project-local asset picker for screenshot, decorative image, and
official store-badge assets; and creates editable rating/press-proof badge groups when a registered
font is available. The top bar selects and manages complete locale sets; Screens and Overview show
the active locale in isolated mode or the active exact platform/device/locale group in connected
mode. Inline editing and new text honor the active screen's LTR/RTL direction.

Template screens inherit the active screen's locale and direction while using the template's
explicit platform, device, artboard, background, and element layout. LTR-authored geometry is
mirrored exactly once when a template is instantiated into an RTL locale.
Non-lead screen templates normally create a lead root plus an exact target variant. Landscape iPad
and Android tablet canvases therefore export against their landscape target. The Play Feature Graphic
creation starter instead uses the schema's standalone exact-target contract so its default bundle is
only 1024×500. It remains an Android `kind: "promotion"` output in the phone family, never an Android
device.
Responsive canvases continue to use `platform: "web"` with desktop, laptop, tablet, or mobile devices;
`web-share` remains an export/package profile.

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
pnpm test:e2e:editor:workspace   # launcher/import + locale/connected/responsive workspace
pnpm test:e2e:editor:authoring   # fonts/themes/templates/assets/group authoring
pnpm test:e2e:accessibility # desktop + compact Axe states
pnpm test:e2e:browsers # Chromium/Firefox/WebKit editor smoke
pnpm test:e2e:package  # production build + packed temp-install/export smoke
pnpm test:e2e:skill    # optional skill install + clean-project bootstrap smoke
pnpm test:e2e:examples # validate and export the living example projects
pnpm test:e2e:ci       # targeted browser subset for explicit local/automation use
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

## How Codex and GPT-5.6 were used

Screenshot Studio was built through an AI-assisted development workflow using OpenAI Codex and GPT-5.6.

These tools were involved in approximately 99% of the project's development activities—from the
initial product idea and planning through repeated product and UI redesigns, implementation,
testing, refactoring, documentation, and release-readiness work. The product vision, priorities,
final decisions, reviews, and acceptance remained the responsibility of the human author.

The collaboration covered:

- **Product discovery, strategy, and planning.** Codex and GPT-5.6 helped break the idea into
  implementation stages, evaluate trade-offs, define milestones, prioritize work, and refine the
  product scope as requirements evolved. They were used to shape the core goal of Screenshot Studio:
  a code-first tool for creating store-ready marketing screenshots.

- **Product design and marketing direction.** We explored how the product should be positioned,
  presented, and explained to users. This included feature definition, onboarding, project creation,
  project import, project management, workspace navigation, screenshot-authoring workflows, product
  copy, README content, and documentation structure.

- **UI/UX design and repeated redesigns.** Codex and GPT-5.6 supported many iterations of the
  application experience: interface concepts, layout variations, mockups, interaction patterns,
  panel and toolbar design, visual hierarchy, empty states, project-launcher flows, and editor
  refinements. Multiple alternatives were explored and reviewed before selected designs were
  implemented.

- **Design tools and plugins.** Plugins and design-tool integrations were used during exploration
  and implementation to create and review mockups, accelerate design iterations, inspect visual
  ideas, and translate selected concepts into implementable UI.

- **Architecture and implementation.** Codex assisted with TypeScript, React, and Next.js
  development; the shared browser rendering pipeline; CLI workflows; schema design and validation;
  project storage and management; import and export flows; localization and RTL support; assets,
  templates, themes, fonts, and store specifications; as well as focused test coverage.

- **Documentation and developer experience.** Codex helped create, improve, and maintain setup
  instructions, architecture documentation, contributor guidance, testing rules, implementation
  contracts, workflow rules, safe file-handling guidance, and release procedures. It also helped
  keep the CLI, editor, project format, and documentation aligned as the product evolved.

- **Quality, review, and iteration.** GPT-5.6 was used to reason through edge cases, review
  proposed changes, identify potential regressions, compare design and implementation alternatives,
  improve consistency between the editor and CLI, and select focused validation steps for each task.

AI acted as an active product, design, and engineering partner throughout the project. It
accelerated execution and made it possible to apply existing engineering experience in an unfamiliar
web-development environment. The human author directed the work, selected and reviewed the proposed
designs and changes, validated the results, and approved all final product and technical decisions.

## License

Apache-2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE). Contributions are welcome under the same
terms; see [CONTRIBUTING.md](CONTRIBUTING.md).
