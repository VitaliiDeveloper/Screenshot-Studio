# Screenshot Studio

A code-first, open-source editor for creating App Store, Google Play, and Microsoft Store marketing
screenshots visually, from the CLI, or together with an AI coding agent.

Screenshot Studio keeps an entire campaign in one git-trackable JSON document. The visual editor and
CLI use the same browser renderer, so the preview you approve is the image you export at the exact
store size.

The application is local-first, works without an AI provider, and supports reproducible campaigns
across platforms, layouts, exact-size variants, locales, and RTL languages.

## Why Screenshot Studio

Store screenshots are rarely a one-image task. A complete campaign must stay visually consistent
across device sizes, platforms, locales, RTL languages, product revisions, and repeated exports.
Traditional design files are convenient to edit but difficult to automate and review in Git.
Code-only generators are reproducible but inconvenient for visual iteration.

Screenshot Studio combines both workflows:

- a responsive multi-artboard visual editor;
- one strict, portable, version-controlled project document;
- a CLI for repeatable editing, import, and export;
- exact store-size outputs produced by the same renderer as the editor preview;
- project-local instructions that let an AI agent work against explicit schema and workflow rules;
- no required cloud service, model, API key, or provider-specific project state.

## Current capabilities

- **One strict project document.** A complete strict schema v1 JSON file owns shared metadata and
  fonts plus ordered independent design layouts, locales, screens, backgrounds, elements, groups,
  crop/style literals, output-family policies, and store target variants.
- **One UI/CLI renderer.** Editor previews, exact exports, bundles, Web Share, and the packaged CLI
  use the same Konva stage through the Chromium render host. Store PNGs are exact-size and opaque.
- **Visual authoring.** Focus and Overview modes, isolated and connected canvases, multi-selection,
  one-level groups, snapping, guides, zoom, inline text editing, history, and schema-bounded
  inspectors work across layouts and locales. **Apply to** picks which exact-size screens an edit
  writes to, and **Issues** lists pre-export problems with Go to and Fix.
- **Complete creative surface.** Text, shapes, screenshots, decorative images, trusted vector icons,
  device frames, editable badge groups, solid/gradient/project-image backgrounds, media crop,
  shadows, gradients, and strokes share render/export parity.
- **Store and locale workflows.** Apple, Android, Windows, and responsive Web output families,
  explicit exact-size variants, synchronized or independent screen slots, complete locale sets, and
  baked RTL geometry use the same project model. Export bundles only the checked sizes and locales
  and previews their file paths.
- **Reusable local resources.** Built-in starters, Design Packs, and screen packs work alongside
  project-local fonts, themes, templates, assets, auto-crop, and flat-background removal.
- **CLI and agent workflows.** The `screenshots` CLI manages layouts, screens, imports, fonts,
  themes, locales, local assets, and exports. Generated project-local guidance and the optional
  [agent skill](skills/screenshot-studio/SKILL.md) operate on the same strict JSON and CLI contract.
- **Safe project lifecycle.** Local projects can be edited in place; browser imports create validated
  managed copies. Project archives, rendered exports, Close, Remove from recents, and permanent
  deletion remain separate, explicit operations.

## Example project

The screenshots below use the bundled [`connected-launch`](examples/README.md) example: one
connected campaign across App Store iPhone, Google Play phone, and Web desktop, with exact-size
output variants and element-level visual controls.

Start with a guided project or import an existing Folder, project ZIP, or complete JSON document.

![Screenshot Studio project launcher](docs/images/readme/project-launcher.png)

Return to recent projects without moving or rewriting their source files.

![Screenshot Studio recent projects](docs/images/readme/recent-projects.png)

Use Overview to edit a connected campaign across destinations, screens, and store sizes, then export
the same composition through the shared renderer.

![Screenshot Studio connected multi-artboard editor](docs/images/readme/editor-overview.png)

<details>
<summary><strong>See element, screen, and export controls</strong></summary>

Select a device frame to adjust its transform, screenshot content, and frame preset.

![Screenshot Studio device frame inspector](docs/images/readme/device-frame-inspector.png)

Add exact store sizes from the sizes bar, then select a screen to manage its synchronized structure
and background.

![Screenshot Studio screen and output variants](docs/images/readme/screen-variants.png)

Export the checked destinations, sizes, and locales as one store bundle, with a preview of its paths.

<img src="docs/images/readme/export-dialog.png" alt="Screenshot Studio export dialog" width="560">

</details>

## Quick start

Requirements: Node.js 22.13+ and pnpm 12.10.1, the version pinned in `package.json`. Install pnpm
once with `npm install -g pnpm@12.10.1`; an existing Corepack setup also works.

```bash
git clone https://github.com/VitaliiDeveloper/Screenshot-Studio.git && cd Screenshot-Studio
./run.sh
```

`./run.sh` is the only command you need. It installs or refreshes the pinned dependencies and the
Playwright Chromium builds used for export when they are missing or outdated (a quick no-op
otherwise), then starts Screenshot Studio.

| Task | Command |
|---|---|
| Start | `./run.sh` |
| Update | `git pull && ./run.sh` |
| Prepare without starting | `./install.sh` |
| Recover from a stale build cache | `./clean.sh && ./run.sh` |

None of these scripts removes projects or exports.

Open [http://localhost:3000](http://localhost:3000), then choose **New project** and a built-in
starter, or use **Import** to create a managed copy of an existing Folder, project ZIP, or complete
`app-store-screenshots.json` project.

To open the bundled sample directly in place:

```bash
PROJECT_PATH="$PWD/fixtures/sample/app-store-screenshots.json" pnpm dev
```

The sample appears in **Recent projects** and opens directly in Workspace. Editor saves update the
fixture in place, so copy it to a separate directory before experimenting with changes you do not
want to keep.

Exact PNG export uses the Chromium builds that `./run.sh` installs. From the CLI:

```bash
pnpm screenshots export --project "$PWD/fixtures/sample/app-store-screenshots.json"
```

## How it works

```mermaid
flowchart LR
    P["app-store-screenshots.json"] <--> E["Visual editor"]
    P <--> C["CLI or AI agent"]
    E --> R["Shared browser renderer"]
    C --> R
    S["store-specs.json"] --> R
    R --> O["Exact store PNGs and bundles"]
```

`app-store-screenshots.json` is the single persisted project document. Store dimensions come from
[`store-specs.json`](store-specs.json). The visual editor and CLI both use the framework-agnostic
core and the same browser render stage; Web Share packages those rendered PNGs and never substitutes
another pixel path.

### Destinations, output families, sizes, and frames

These concepts are independent:

| Concept | Example | What it controls |
|---|---|---|
| Destination | App Store or Google Play | The publishing surface and its configured output families |
| Device family | iPhone or Android phone | A destination-scoped group of compatible export targets |
| Export size | 1206×2622 or 1080×1920 | The exact pixel dimensions of one rendered PNG |
| Visual frame preset | Modern Phone — Dark or Browser — Dark | Only the decorative device-frame element drawn inside an artboard |

Choosing a frame never changes a screen's destination, device family, or export size. Screenshot
Studio bundles brand-neutral vector frame styles rather than vendor product artwork; official Apple
device artwork is not bundled.

The sizes in [`store-specs.json`](store-specs.json) are a curated working set: accepted Apple sizes
and recommended presets within Google Play and Microsoft Store requirements. They are not a claim
that every historically accepted resolution is bundled. Store requirements change, so
`store-specs.json` remains the runtime authority for what this version exports, while the official
[App Store screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/),
[Google Play preview-asset requirements](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en),
and [Microsoft Store screenshot guidance](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/screenshots-and-images)
remain the submission authority. Check the relevant store guidance before publishing.

Projects can be opened explicitly as local files or imported into app-managed storage. A browser
Folder, ZIP, or JSON selection is always treated as import input, validated, and copied before the
managed project becomes active. Detailed source, session, rendering, and persistence contracts are
in [`docs/architecture.md`](docs/architecture.md).

## CLI workflow

The monorepo CLI covers the common project lifecycle:

```bash
# Create a strict project with local agent guidance
pnpm screenshots init --dir ./my-app-screenshots

# Open its visual editor
pnpm screenshots dev --project ./my-app-screenshots/app-store-screenshots.json

# Export the preferred layout
pnpm screenshots export --project ./my-app-screenshots/app-store-screenshots.json

# Import organized PNG captures into a selected layout
pnpm screenshots import ./my-app-screenshots/screenshots \
  --layout "Feature campaign" \
  --project ./my-app-screenshots/app-store-screenshots.json

# After re-capturing, swap the new pixels into the screens that already use those captures
pnpm screenshots import ./my-app-screenshots/screenshots --refresh \
  --layout "Feature campaign" \
  --project ./my-app-screenshots/app-store-screenshots.json

# Add a starter screen, then change its copy, screenshot, and placement without editing JSON
pnpm screenshots template add iphone-starter --built-in --locale en --project ./my-app-screenshots/app-store-screenshots.json
pnpm screenshots element list --locale en --project ./my-app-screenshots/app-store-screenshots.json
pnpm screenshots element text <screen-id> <element-id> "Track every run" --project ./my-app-screenshots/app-store-screenshots.json
pnpm screenshots element media <screen-id> <element-id> assets/captures/01.png --project ./my-app-screenshots/app-store-screenshots.json
pnpm screenshots element set <screen-id> <element-id> --json '{"rotation":-6,"x":76,"y":524}' --project ./my-app-screenshots/app-store-screenshots.json
```

Layout-aware mutations require `--layout <id-or-full-name>` when a project has multiple layouts.
`dev`, `screen`, and `export` accept `--store-specs <path>` for an explicit store specification.
Bundle export writes locale roots at their device lead target and all explicit persisted variants at
their own targets. A single-screen export resolves explicit `--size`, then its persisted `storeTargetId`,
then its device lead target. `export --profile fastlane` writes the bundle in the folder layout
`fastlane deliver` and `supply` upload from. `screen rm <id> --cascade` explicitly removes a primary
screen together with paired variants. After a device lead change, `screen migrate-lead --platform
<platform> --device <device> --from <previous-size>` moves primary screens onto the current lead and
keeps each original as a `<previous-size>` variant.

The full command and export reference lives in
[`packages/cli/README.md`](packages/cli/README.md).

## Use an agent in the editor

The **Agent** item in the editor's tool rail (⌘J) and the **Start with agent** starting point in New
project run an official agent CLI that you installed and signed in to with your own subscription.

<img src="docs/images/readme/agent-new-project.png" alt="Screenshot Studio New project dialog with the Start with agent starting point" width="640">

Describe the app, attach app screenshots or a logo, and pick the agent, model, and effort. The agent
creates the first screens on a blank project. Attached images are sent to the agent's provider with
your request.

![Screenshot Studio Agent panel after a run](docs/images/readme/agent-panel.png)

After a run the panel shows the agent's result, the screens it changed with **Go to**, and the
validation checks. **Undo run** restores the project file from the snapshot taken before the run;
**Keep changes** accepts it.

To drive a project from your own terminal instead, see the next section.

## Work with your own agent

You can let any coding agent you already use (Claude Code, Codex, Antigravity, Cursor, Copilot, and
others) change a project while the editor is open. Screenshot Studio does not start or wrap that
agent: you run it yourself, with your own account, in the project folder.

1. Create the project with `pnpm screenshots init --dir ./my-app-screenshots`. This writes the
   project's `AGENTS.md`, which tells the agent how to use the `screenshots` CLI on this project.
   Optionally install the [agent skill](skills/screenshot-studio/SKILL.md).
2. Open the project in place with
   `pnpm screenshots dev --project ./my-app-screenshots/app-store-screenshots.json`.
3. In a separate terminal, `cd my-app-screenshots` and start your agent there, for example
   `claude`, `codex`, or `agy`.
4. Ask for changes in plain words, and ask the agent to make them with the `screenshots` CLI
   rather than by editing the JSON by hand. The CLI validates every write and takes the project lock.

Example requests:

- "List the screens for the `en` locale and change the Hero headline to 'Track every run'."
- "Apply the `neutral-default` design pack, then add the `neutral-iphone-basics` screens."
- "Add a `de` locale and translate every headline and subline."
- "Use `assets/captures/01.png` as the screenshot in the Hero mockup."
- "Export the preferred layout and tell me where the PNGs were written."

Each change appears in the open editor within a few seconds, with no restart. If you edit in the
editor at the same moment, the editor never saves over the agent's change: it shows
**This project changed outside the editor.**, and **Load latest version** loads the agent's result.
Your unsaved edits from that moment are discarded. Projects imported in the browser from a folder,
ZIP, or JSON are managed copies. An agent in your original folder changes the original, not the
copy the editor shows, so open the project in place as in step 2.

## Design packs and screen packs

| Pack | Kind | Id | What it gives you |
|---|---|---|---|
| Neutral default | Design pack | `neutral-default` | A light slate-to-blue gradient background, dark high-contrast type, a blue accent, and white surfaces. |
| Neutral basics · iPhone | Screen pack (2 iPhone screens) | `neutral-iphone-basics` | A hero screen and a feature screen, each with a headline, a subline, and an empty mockup, styled with Neutral default. |
| Clean | Design pack | `clean` | White space, centered copy, and quiet semibold type. |
| Aurora | Design pack | `aurora` | A violet-to-pink gradient with soft glows and extra-bold type. |
| Midnight | Design pack | `midnight` | Deep navy, a cyan glow behind the device, and copy that alternates top and bottom. |
| Poster | Design pack | `poster` | Signal yellow, huge extra-bold headlines, and a device that runs off the bottom edge. |
| Sunrise | Design pack | `sunrise` | A warm peach gradient with a generated sun and light editorial type. |
| `<style>` · iPhone, `<style>` · Android phone | Screen packs (6 screens each) | `<style>-iphone`, `<style>-android-phone` | For each style above: hero, three features, social proof, and a call to action, laid out for iPhone 6.3″ or Android phone portrait. |
| `<style>` panorama · iPhone, `<style>` panorama · Android phone | Panorama screen packs (6 connected screens each) | `<style>-panorama-iphone`, `<style>-panorama-android-phone` | The same six screens over art that crosses every screen edge: Clean (one stage and a timeline), Midnight (orbit rings on each seam), Poster (a bold stripe and split discs), and Sunrise (one horizon, rolling hills, and a sun between the first two screens). Panorama layouts only. |
| `<style>` showcase · iPhone, `<style>` showcase · Android phone | Screen packs (6 screens each) | `midnight-showcase-iphone`, `midnight-showcase-android-phone`, `poster-showcase-iphone`, `poster-showcase-android-phone` | The same six screens with a different composition on each: a large tilted hero device, two overlapping devices, copy under the device, a big-number rating proof, and tilted devices on the rest. Midnight and Poster only. |

Styled packs set type in the built-in Studio Display family, which covers Latin, Cyrillic, and Greek.
Arabic, Hebrew, and CJK copy needs a font registered in the project.

`theme list` and `template list` print the catalog that your installed version ships.

- A **Design pack** restyles screens you already have. **Apply pack** replaces the background of every
  screen in the layout and bakes color, font, size, line height, and letter spacing into its
  role-tagged text, shapes, and icons. It does not move or resize anything.
- A **screen pack** adds finished screens. **Add screens from pack** appends each one as an ordinary
  editable screen to the active layout and locale.
- A **panorama pack** needs a Panorama (connected) layout, where art draws across screen edges. Each
  shape belongs to the screen holding its left edge, so reordering or deleting screens shifts the art.
  Applying a Design pack with a diagonal background (Neutral default, Aurora) shows a seam at every
  screen edge. RTL locales are not supported yet: the strip always runs left to right, so mirroring
  moves each shape toward the previous screen, where it covers that screen's device.

To apply one manually, open the **Design packs** dialog (**Packs** in the editor tool rail), then use
**Apply pack** or **Add screens from pack**. Screen packs are listed for the active screen's output
family.

From the CLI, or for an agent, list the packs, apply one, then edit the copy:

```bash
pnpm screenshots theme list --project ./my-app-screenshots/app-store-screenshots.json
pnpm screenshots theme set neutral-default --built-in --project ./my-app-screenshots/app-store-screenshots.json
pnpm screenshots template list --project ./my-app-screenshots/app-store-screenshots.json
pnpm screenshots template add neutral-iphone-basics --pack --locale en --project ./my-app-screenshots/app-store-screenshots.json
pnpm screenshots element list --locale en --project ./my-app-screenshots/app-store-screenshots.json
```

## Project format and resources

A portable screenshot project commonly has this shape:

```text
my-app-screenshots/
├── app-store-screenshots.json   # the only persisted project document
├── AGENTS.md                    # generated schema and workflow guidance
├── assets/                      # screenshots, images, fonts, and processed assets
├── screenshots/                 # organized PNG captures for import
├── templates/<id>.json          # project-local screen templates
├── themes/<id>.json             # project-local design packs
└── export/                      # generated outputs
```

Built-in screen starters, Design Packs, frames, icons, and fonts are application resources and do
not become hidden project state. Applying a starter, template, or pack materializes ordinary strict
project fields that remain editable. Project-local resources stay beside the document and can travel
with its portable project archive.

Four living starter workflows cover isolated, connected, RTL/multi-locale, and capture-import paths.
The self-contained projects under [`examples/`](examples/README.md) are also validated and exported
as part of the repository's release surfaces.

## Installable CLI candidate

To build the local installable artifact without publishing it:

```bash
pnpm build:cli-package
pnpm --dir packages/cli/package pack
pnpm add --global ./packages/cli/package/screenshot-studio-cli-0.1.0.tgz
screenshots setup
screenshots init --dir ./my-app-screenshots
```

`screenshots setup` downloads the Chromium builds (about 550 MB, in Playwright's shared per-user
cache) using the Playwright version the CLI depends on; it is safe to re-run. Without it,
`screenshots export` asks before downloading on first use and, in CI or other non-interactive
runs, exits with the install command instead of downloading. On Linux, Chromium may also need
Playwright's [system packages](https://playwright.dev/docs/browsers#install-system-dependencies).

Interactive runs of the installed package (not a source checkout, which updates with `git pull`)
also make one optional request per day to the public npm registry
(`registry.npmjs.org/@screenshot-studio/cli/latest`) and print a one-line notice when a newer
version exists. Nothing is sent but the request itself, and failures are ignored. Disable it with
`SCREENSHOTS_NO_UPDATE_CHECK=1` or `NO_UPDATE_NOTIFIER=1`; it is also skipped when `CI` is set or
output is not a terminal.

The package contains the built `screenshots` binary, shared store specifications, and prebuilt Next
render host. Version `0.1.0` is an unpublished dry-run candidate; it is not a registry release.
Building or verifying it does not create an npm publication, Git tag, GitHub release, or
announcement. Publication requires explicit owner authorization under
[`docs/releasing.md`](docs/releasing.md).

## Repository structure

- `packages/core` — strict model, project operations, renderer mapping, export, resources, and store
  specifications.
- `packages/cli` — the `screenshots` command and packaged standalone render host.
- `apps/web` — Projects, Project details, Workspace, API routes, and the shared `/render` target.
- `fixtures` — sample and behavior-specific regression projects.
- `examples` — portable connected and RTL living projects.
- `e2e` — focused Playwright/Vitest workflow and render-parity gates.
- `docs` — durable architecture, interaction, testing, safety, and release contracts.

## Documentation

- [Architecture](docs/architecture.md) — model, sources, sessions, rendering, export, and CLI.
- [Editor UI and UX](docs/editor.md) — durable interaction, navigation, and accessibility semantics.
- [Testing](docs/testing.md) — test ownership, focused browser groups, and CI policy.
- [Project mutation locking](docs/project-mutation-locking.md) — concurrent write and recovery contract.
- [Safe file publication](docs/safe-file-publication.md) — asset and output publication boundaries.
- [Releasing](docs/releasing.md) — candidate verification, publication, upgrade, and uninstall.
- [Contributing](CONTRIBUTING.md) and [Security](SECURITY.md) — contributor workflow and private
  vulnerability reporting.

## Development

```bash
pnpm test          # full unit suite
pnpm test:core     # core unit tests
pnpm test:cli      # CLI unit tests
pnpm test:web      # web unit tests
pnpm typecheck     # all packages
pnpm lint          # repository lint
```

Use focused browser files only for behavior that requires a real Next.js host, rendering, user
interaction, or persistence. Do not run the complete `pnpm test:e2e` gate locally; GitHub CI owns it
for the integration PR from `dev` into `main`. See [`docs/testing.md`](docs/testing.md) for the exact
matrix and release-surface commands.

## License

Apache-2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE). Contributions are welcome under the same
terms; see [CONTRIBUTING.md](CONTRIBUTING.md).
