# Screenshot Studio CLI

Built command-line distribution for Screenshot Studio. It manages strict Apple App Store, Google
Play, Microsoft Store, and Web screenshot projects, opens the local editor, and exports exact output
PNGs through the packaged shared web renderer.

After installing the `0.1.0` dry-run package artifact and its matching Chromium builds:

```bash
pnpm add --global ./screenshot-studio-cli-0.1.0.tgz
screenshots setup
ss-studio
```

`ss-studio` is another name for `screenshots`; both run the same CLI. With no command it starts the editor at `http://localhost:4747` and opens the project
library in your browser, where **New project** and **Import** create projects. Running it again
while the editor runs opens the same editor instead of starting a second one, and the fixed address
keeps the editor's layout and agent choice between launches. If another program holds port 4747,
the editor starts on a free port with a warning, and those settings start from defaults for that
run. `--port <port>` picks the port (and fails if another program holds it); `--no-open` skips the
browser, which also stays closed when `CI` is set or output is not a terminal. The editor keeps
running after you close the tab: stop it with Ctrl+C in its terminal.

Managed projects, recent projects, agent consents, and store keys live in the per-user data folder
(`~/Library/Application Support/screenshot-studio` on macOS, `$XDG_DATA_HOME/screenshot-studio` or
`~/.local/share/screenshot-studio` on Linux, `%LOCALAPPDATA%\screenshot-studio` on Windows), or in
`SCREENSHOT_STUDIO_DATA_ROOT` when it is set.

To work on a project folder in place, without copying it into the library, pass the folder:

```bash
screenshots init --dir ./my-app-screenshots
cd ./my-app-screenshots
ss-studio .
screenshots export
```

`ss-studio .` opens the folder's `app-store-screenshots.json` in the editor that is already running,
or starts the editor first, and adds the project to the library's recent projects. A folder must be
written as a path (`.`, `./name`, `../name`, or an absolute path) so it never reads as a command.
`screenshots dev` still starts an editor pinned to one project on a random port.

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

`screenshots check [--layout <id>] [--render] [--strict] [--json]` validates a project without
exporting: the editor's Issues (screen missing in a locale, image missing from the project folder,
and with `--render` text overflow measured in the export render host) plus export preflight (fonts
that are unregistered or missing on disk, unknown sizes, artboards that cannot scale, export paths
that are not portable, Android tablet screen counts). It prints one line per issue and exits 1 on
any blocker; `--strict` also fails on warnings. `--render` needs the same Chromium builds as
`export` and fails the same way without them; while a font blocker remains it skips text
measurement and reports `"textMeasured": false`. A failure that is not a report (missing project,
unknown `--layout`, bad `--store-specs`, render-host error) also exits 1 but prints no `--json`
report, only an error on stderr, so scripts should treat stdout that does not parse as a tool error.

`dev`, `screen`, `check`, and `export` accept `--store-specs <path>` to override the packaged
`store-specs.json`. Bundle export writes every locale root at its device lead target plus its
explicit persisted variants. A single-screen export resolves an explicit `--size` first, then the
screen’s persisted `storeTargetId`, then its device lead target.

`screenshots export --profile web-share` packages the same rendered PNGs into a portable local-only
static review/campaign directory and ZIP. Web Share is independent of the Web platform.

### fastlane layout

`screenshots export --profile fastlane` writes the same store-ready PNGs into the tree that
[fastlane](https://docs.fastlane.tools) reads, under one `fastlane/` folder in `--out`:

- App Store screens go to `fastlane/screenshots/<locale>/<NN>_<screen>_<device>-<size>.png`. `fastlane
  deliver` reads every device class from one flat locale folder and picks the class by pixel size, so
  the name carries the device and size to stay unique. Vision Pro names contain `vision`, which deliver
  needs to tell 3840×2160 apart from Apple TV, so the `--out` path itself must not contain `vision`
  when it holds Apple TV 4K screens: deliver checks the whole path. deliver merges a size's portrait
  and landscape files into one set, and iPad 13 with 12.9 (a 2048×2732 iPad lands in the 13" set);
  App Store Connect keeps at most 10 screenshots per set.
- Google Play screens go to `fastlane/metadata/android/<locale>/images/<slot>/<NN>.png`, where the
  slot is `phoneScreenshots`, `sevenInchScreenshots`, `tenInchScreenshots`, `tvScreenshots`, or
  `wearScreenshots` by output family. The Feature Graphic becomes `images/featureGraphic.png`.
- Project locales map to store codes: an exact store code (`en-US`, `uk`, `zh-Hans`) is kept, a bare
  language with one store code (`de` → `de-DE`) or a common default (`en` → `en-US`, `es` → `es-ES`,
  `fr` → `fr-FR`) is expanded, and anything else, such as `pt` or `zh`, stops the export before
  rendering. App Store Connect and Google Play use different code lists (`ja` vs `ja-JP`).
- Windows, Web, Chromebook, Automotive, and XR sizes have no fastlane upload slot; the export skips
  them and prints one summary line.

Then `fastlane deliver --skip_binary_upload --skip_metadata` and `fastlane supply
--skip_upload_apk --skip_upload_aab --skip_upload_metadata --skip_upload_changelogs` upload the
screenshots with your own store credentials. Run from the `--out` folder, they read
`./fastlane/screenshots` and `./fastlane/metadata/android` by default; elsewhere, pass
`--screenshots_path` / `--metadata_path`. fastlane uploads
every image it finds there, so export into a clean folder, and add `--overwrite_screenshots` to
deliver to replace the screenshots already in App Store Connect instead of appending to them.

### Upload to Google Play

`screenshots upload --store google [--layout <id>] [--dry-run] [--json] [--changes-not-sent-for-review]`
replaces the project's Google Play screenshots directly, with no fastlane or Ruby. It is a human-only
action: run it yourself in a terminal or CI job.

1. Store the app's package name in the project (identifiers only, never keys):
   `screenshots publishing set --google-package com.example.app`. `publishing show` prints it and
   `publishing clear google` removes it; `--apple-app-id <id>` is stored the same way for the App
   Store Connect upload below.
2. Point `GOOGLE_PLAY_SERVICE_ACCOUNT_PATH` (or `--service-account <path>`) at the JSON key of a
   service account that has release access to the app in Play Console. The key is read from that file
   only; it never goes into the project, a flag value, or the output.
3. Run `screenshots upload --store google --dry-run` to see the plan, then without `--dry-run` to
   upload.

The plan uses the fastlane locale and slot mapping above. Each slot with project screens
(`phoneScreenshots`, `sevenInchScreenshots`, `tenInchScreenshots`, `tvScreenshots`,
`wearScreenshots`, `featureGraphic`) is replaced as a whole, in project screen order; every other slot
and every other store locale is left as it is. A slot with more than 8 screenshots (or more than one
Feature Graphic) stops the command before anything is rendered or sent. `--dry-run` is offline: it
needs no credentials, renders nothing, and opens no edit, so it says "replaces every current image"
instead of a count. It still checks that every artboard scales to its store size and prints export
preflight warnings (such as Android tablet screen counts) on stderr, as a real upload does.

A real upload exchanges the key for an access token first, so a revoked key fails before rendering.
It then renders through the ordinary bundle export, opens one Play edit, checks that every planned
locale already has a store listing, lists the touched slots, deletes their images, uploads the new
PNGs, and commits the edit once. Any failure before the commit abandons the edit, so Google Play is
unchanged. Each request times out after 60 seconds and nothing is retried; every step only changes
the uncommitted edit, so running the command again after a failure starts cleanly. If the commit
request gets no response, the command says the outcome is unknown; check Play Console before running
it again. Failures exit 1 with an error on stderr and no `--json` report, like `check`.

Add `--changes-not-sent-for-review` when Play rejects the commit because the app's changes cannot be
sent for review automatically, which typically follows an earlier review rejection. The edit is then
committed with `changesNotSentForReview=true`: Play adds it to the changes waiting in Play Console and
reviews nothing until you send them for review there.

Agents the editor starts carry `SCREENSHOT_STUDIO_AGENT=1` and none of the credential variables;
`upload` refuses to run when that variable is set, even with `--dry-run`. This guards against an
accidental run, not a determined agent; agents you start yourself in a terminal carry no marker and
are kept from uploading only by the project guide.

### Upload to App Store Connect

`screenshots upload --store apple [--layout <id>] [--version <string>] [--dry-run] [--json] [--key-path <path>]`
replaces the project's App Store screenshots through the App Store Connect API, with no fastlane. It is
human-only and refuses to run under `SCREENSHOT_STUDIO_AGENT`, even with `--dry-run`, like the Google
command.

1. Store the numeric Apple ID of the app: `screenshots publishing set --apple-app-id 1234567890`.
2. Create an App Store Connect API key with the App Manager role and set `APP_STORE_CONNECT_KEY_ID`,
   `APP_STORE_CONNECT_ISSUER_ID`, and `APP_STORE_CONNECT_KEY_PATH` (or pass `--key-path <path>`) to the
   downloaded `.p8` file. The key is read from that file only; the command signs a short-lived ES256
   token from it and never writes the key or the token to the project, a flag value, or the output.
3. Run `screenshots upload --store apple --dry-run` to see the plan, then without `--dry-run`.

Each App Store target in `store-specs.json` names its App Store Connect display type, so a screen
uploads into the set of its target: iPhone 6.9 into `APP_IPHONE_67`, 6.5 into `APP_IPHONE_65`, 6.3
into `APP_IPHONE_61`, 6.1 into `APP_IPHONE_58`, iPad 13 and 12.9 into `APP_IPAD_PRO_3GEN_129`, iPad 11
into `APP_IPAD_PRO_3GEN_11`, Mac into `APP_DESKTOP`, Apple TV into `APP_APPLE_TV`, Vision Pro into
`APP_APPLE_VISION_PRO`, and Apple Watch Ultra, Series 11, 9, 6, and 3 into `APP_WATCH_ULTRA`,
`APP_WATCH_SERIES_10`, `_7`, `_4`, and `_3`. A landscape target uploads into the same set as its
portrait twin. iPhone Duo targets have no display type in the API and are listed as skipped with the
reason. Locales use the fastlane mapping above. A set takes one size, so when screens of two sizes
fill the same display type (for example an iPad 13 root with a 12.9 variant, Watch Ultra 3 and Ultra
2, or Apple TV 4K and HD), the family's lead size from `store-specs.json` is uploaded, or a root
screen's size where the lead is not among them, and the other screens are listed as skipped with
both sizes named; the command stops only when neither applies. A set with more than 10 screenshots
stops the command before anything is rendered or sent. `--dry-run` is
offline: it needs no key, renders nothing, and contacts nothing, but checks artboards and prints
preflight warnings like a real upload.

iPhone, iPad, and Watch sets belong to the app's iOS version; Mac, Apple TV, and Vision Pro sets to
its macOS, tvOS, and visionOS versions. For each platform the plan touches, the command lists the
app's editable versions (Prepare for Submission, Ready for Review, Developer Rejected, Rejected,
Metadata Rejected, Waiting for Review, Invalid Binary). A platform with one editable version uses it.
On a platform with several, `--version <string>` picks one by its version string, so Mac and iOS
version numbers may differ; without a match, or with no editable version, the command stops and
lists them. Every
planned locale must already have a localization on that version. These reads happen before
rendering, so a bad key, an ambiguous version, or a missing localization stops the command with
nothing changed.

App Store Connect has no edit to commit, so the upload is not atomic. Sets are replaced one at a time
in plan order: a missing set is created, its current screenshots are deleted, each new PNG is
reserved, uploaded in the parts App Store Connect asks for, and committed with its MD5 checksum, and
the command then waits (up to 5 minutes per screenshot) until App Store Connect reports each one
processed. The first failure stops the run, and the report gives every set's state:

- `replaced`: its old screenshots are gone and every new one finished processing.
- `partial`: some change reached the set (or a request got no response) before it failed, so the set
  may be empty or half filled; upload again or fix it in App Store Connect.
- `failed`: the first change to the set was rejected, so the set is as it was.
- `untouched`: the run stopped before reaching the set.

The report goes to stdout (also with `--json`), and the command exits 1 unless every set is
replaced. Requests time out after 60 seconds and nothing is retried; running the command again
replaces each set from scratch. Errors before any change exit 1 with the error on stderr and no
report. A custom `--store-specs` catalog without `appStoreConnect` on a target is still valid; that
target is skipped with a reason.

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
