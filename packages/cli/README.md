# Screenshot Studio CLI

Built command-line distribution for Screenshot Studio. It manages strict Apple App Store, Google
Play, Microsoft Store, and Web screenshot projects, opens the local editor, and exports exact output
PNGs through the packaged shared web renderer.

After installing the `0.1.0` dry-run package artifact and its matching Chromium builds:

```bash
pnpm add --global ./screenshot-studio-cli-0.1.0.tgz
screenshots setup
screenshots init --dir ./my-app-screenshots
cd ./my-app-screenshots
screenshots dev
screenshots export
```

`screenshots setup` downloads the Chromium builds (about 550 MB, in Playwright's shared per-user
cache) with the Playwright version this CLI depends on, and is safe to re-run. `export` offers the
same download on first use when run in a terminal; in CI or piped runs it exits with the install
command instead. On Linux, Chromium may also need Playwright's system packages.

To skip the download, pass `--browser chrome`, `--browser msedge`, or `--browser auto` (the
downloaded Chromium if present, otherwise installed Chrome, then Edge) to `export`, or set
`SCREENSHOTS_BROWSER`; the flag wins. System browsers are opt-in because exports are only
reproducible against the pinned Chromium: they run full headless Chrome rather than Playwright's
headless shell, so output can differ even at the same Chromium version, and Chrome and Edge
auto-update, which can change text rendering between exports.

Interactive runs check the npm registry at most once a day for a newer version and print a
one-line notice. Disable it with `SCREENSHOTS_NO_UPDATE_CHECK=1` or `NO_UPDATE_NOTIFIER=1`; it is
skipped when `CI` is set or output is not a terminal.

`dev`, `screen`, and `export` accept `--store-specs <path>` to override the packaged
`store-specs.json`. Bundle export writes every locale root at its device lead target plus its
explicit persisted variants. A single-screen export resolves an explicit `--size` first, then the
screen’s persisted `storeTargetId`, then its device lead target.

`screenshots export --profile web-share` packages the same rendered PNGs into a portable local-only
static review/campaign directory and ZIP. Web Share is independent of the Web platform.

`screen add --size` accepts only a device lead target. `screen migrate-lead --platform <platform>
--device <device> --from <previous-size>` explicitly moves every layout's primary screens authored at
a former lead onto the current lead, keeping each original as a `<previous-size>` variant; it refuses
ambiguous families and is a no-op once nothing is left to move. `screen rm <id>` protects the last locale
primary. Under the default independent policy it preserves paired exact-size screens as standalone;
add `--cascade` to explicitly remove a primary together with its paired variants. Screen mutations
use the core persisted slot policy: independent exact-size rows remain
independent, while `Keep 1:1` mirrors logical add/delete/order across created sizes without sharing
screen content.

Templates, themes, copy, and media have their own commands, so an agent or script can work without
hand-editing the project JSON. Each mutation takes the project lock and validates the complete strict
Project before an atomic write:

- `template list` and `template add <id> --locale <locale> [--built-in|--pack]` add one screen from
  a built-in starter or a project-local `templates/<id>.json`, or, with `--pack`, every screen of a
  built-in screen pack in a single write, printing their ids. A missing project template never falls
  back to a built-in one, or the other way round. `template list` also prints built-in screen packs
  as `built-in-pack <id> <platform>/<device> <style> <screen count> <name>`, where style is the id of
  the Design pack the screens were baked from. `--pack` and `--built-in` are mutually exclusive.
- `theme list` and `theme set <id> [--built-in]` apply a project-local `themes/<id>.json` theme or
  a built-in Design Pack. A Design Pack also replaces every screen background in the layout.
- `element list [--screen <id>] [--locale <locale>]` prints every leaf with its id, type, role,
  JSON-quoted text, or media path. It prints nothing when no screen matches.
- `element text <screen> <element> [--all-sizes] [--] <content>` replaces one text leaf's content.
  `--all-sizes` also writes the matching layer on every other exact size of the slot, in one locked
  write, and reports any size it skips because the layer structure diverged or the layer or its
  group is locked. A `--` terminator makes every following argument positional, so copy can start with `--`.
- `element media <screen> <element> <path>` assigns an existing project-relative PNG, JPEG, or WebP
  file to a screenshot, image, or device-frame leaf. On a device frame this is the screenshot inside
  the frame; the frame preset and geometry stay unchanged.
- `element get <screen> <element>` and `screen show <id> [--json]` print the full element or screen as JSON.
- `element set <screen> <element> --json '<patch>'` applies the same per-type field patch as the
  editor inspector, including nested group children. Unknown fields are rejected, `null` removes
  `role`, `shadow`, `gradient`, `stroke`, `crop`, `blur`, or a device frame's `assetUrl`, text fonts must be registered, and `assetUrl` must name
  an existing project image. Resizing a group scales its children like the editor does.
- `element add <screen> --type <text|shape|screenshot|image|icon|device-frame> [--json '<props>']`
  appends a core-default element on top of the stack, then applies the props as a patch.
  Screenshot and image elements need an `assetUrl`.
- `element rm <screen> <element>` removes a leaf or group; removing a group's last child removes the group.
- `screen set <id> --background '<json>'` replaces one screen's solid, linear-gradient, or image background.

Node.js 22.13 or newer is required. The package is local-first and does not include an AI provider.
The artifact carries its Apache-2.0 `LICENSE`, `NOTICE`, and generated third-party notices. Presence
of this package manifest does not mean a registry release has been published. See the repository's
`docs/releasing.md` for upgrade, uninstall, limitations, and the owner-only publication boundary.
