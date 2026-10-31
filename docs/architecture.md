# Architecture & Technical Contract

This document describes durable technical boundaries: data, rendering, persistence, resources, and
the interfaces that connect them. It is the technical source of truth when a summary disagrees with
the implementation. [`docs/editor.md`](editor.md) owns UI/UX semantics, shared UI primitives, and
accessible interaction patterns; neither document is a delivery history or a roadmap.

## 1. System shape

Screenshot Studio is a pnpm workspace with one rendering model shared by its interactive editor and
CLI:

```text
packages/core  → strict model, rendering, validation, export, fonts, assets, storage contracts
packages/cli   → project management and headless render-host orchestration
apps/web       → Next.js editor, API routes, and the shared browser render target
```

`core` is framework-agnostic and does not depend on Next.js, HTTP, or a particular project picker.
The web shell owns selection and UI; the CLI owns command parsing and process orchestration. Both
surfaces use core model and rendering helpers rather than maintaining parallel implementations.
Inside `core`, dependencies between top-level domains use the package's public
`@screenshot-studio/core/<domain>` subpaths; relative imports remain local to one domain. This keeps
the internal dependency graph aligned with the contracts available to web and CLI.
Inside `apps/web`, dependencies outside the importing file's directory use the stable `@web/*`
alias; relative imports are reserved for modules in the same directory. ESLint enforces this boundary
so moving editor, component, or API files cannot silently reintroduce fragile parent traversals.
Root-owned E2E tests consume core and CLI through the same `@screenshot-studio/*` public subpaths as
runtime code; they never reach into `packages/*/src` by filesystem traversal.

| Concern | Contract |
|---|---|
| Model validation | Zod strict schema in `packages/core/src/model/schema.ts` |
| Render engine | Konva through one shared NodeConfig mapping |
| UI and CLI export | The same browser `/render` stage, driven by Playwright for CLI export |
| Output catalog | `store-specs.json` owns destination/family metadata and exact dimensions; TypeScript only decodes and selects it |
| Fonts | File-backed browser `FontFace` loading |
| Editor state | Zustand with persistent Project content separated from transient UI state |
| UI system | Local editor primitives, Tailwind, Lucide; no package-level design system until a second consumer exists |

## 2. Project model and ownership

`app-store-screenshots.json` is the only persisted Project document. It is versioned, strict,
git-trackable JSON: unknown fields fail validation and a new persisted field needs explicit schema,
renderer, fixture, and parity work.

Persisted `platform` and `device` values are technical identity, not user-facing copy. The strict
schema owns which pairs are valid. The unified `store-specs.json` catalog owns their shared
presentation and creation metadata together with every exact output target. Its vertical structure
is `platforms → families → targets`, so one family contains its labels, creation policy, lead target,
legacy replacement, and complete size list. `packages/core/src/export/specs.ts` strictly decodes that
document and rejects missing schema families, duplicate identities or dimensions, invalid
recommendations, unsafe replacement references, and lead IDs that do not resolve inside their
family. A platform is presented as a **destination** (for example, Google Play), and a
platform/device pair is presented as an **output family** (for example, Google Play · Android phone).
These catalog values are runtime configuration and are not persisted project fields.

The enforced schema is the authority for exact members and bounds. At a high level, a Project owns
metadata, file-backed fonts, a preferred export layout, ordered layouts, and optional publishing
identifiers. A layout owns ordered
screens; each screen owns its artboard, background, locale/direction, optional explicit store-target
variant identity, and ordered elements. Array order is meaningful for layout, screen, and z-order.

Layouts are independent authoring alternatives with an explicit `isolated` or `connected` mode.
Elements stay owned by one screen even when connected rendering lets decoration cross a crop boundary.
Only strict v1 element types and literals are valid. Workspace selections, viewport state, open panels,
history, source locators, recents, credentials, and server lifecycle metadata never enter Project JSON.

The optional `publishing` block holds store app identifiers and nothing else:
`publishing: { apple?: { appId }, google?: { packageName } }`. `appId` is the numeric App Store
Connect Apple ID; `packageName` is a dotted Android application id, validated by the schema because it
becomes a store API path segment. The renderer and export never read it, so it cannot change pixels.
`screenshots publishing set|clear` edits it through the ordinary validated project write, and an empty
block is dropped so a project without identifiers keeps its bytes.

Store credentials never enter the project document, git, logs, CI artifacts, or the environment of
agents. The CLI reads them only from environment variables that name key files
(`GOOGLE_PLAY_SERVICE_ACCOUNT_PATH`; `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, and
`APP_STORE_CONNECT_KEY_PATH`) or from a `--service-account <path>` or `--key-path <path>` flag; key
material itself is never a command-line argument. The repository GitHub Action does not
upload.
Text elements persist horizontal alignment and an optional vertical alignment; the shared renderer
treats an omitted vertical value as `top` so existing strict documents keep their pixels unchanged.
Screenshot and decorative-image elements may persist a bounded Gaussian blur radius. Device-frame
elements use the same field for screenshot content only, leaving the bezel sharp. The editor and
browser export renderer apply that effect through the same cached Konva filter contract.

Screen-slot behavior is a layout-local output-family policy keyed by persisted platform, device, and locale.
New project scaffolds and newly created output families persist `synchronized`; an omitted policy
still means `independent` for backward compatibility with existing v1 documents. A primary-size screen has no
`storeTargetId`; an exact-size screen has one. In independent mode an exact-size screen may use
`variantOf` to pair with a compatible primary slot, or remain standalone when that size has more
screens. Removing a primary slot in independent mode preserves its exact-size composition by
detaching any paired exact screens; an explicit force-cascade operation may remove the whole pair.
In `synchronized` mode every exact target has the same ordered logical slots as the primary
size and every exact screen references its primary slot. Core mutation helpers mirror slot add,
delete, and reorder across those rows without sharing element identity or content. Enabling
synchronization reconciles to the longest existing row, preserves existing content, and materializes
fitted counterparts only for missing slots. Editor and CLI mutations consume this core policy rather
than implementing their own platform- or size-specific rules. Removing an exact output target removes
the complete size row; it is distinct from deleting one independent screen slot.

A primary-size screen persists no target and exports at its family's current catalog lead, so the
lead implicitly binds every saved primary screen. The iPhone family leads with its Dynamic Island · Medium target (id `6.3`)
because App Store Connect requires a screenshot in that display class, which makes a lead-only export
submittable. iPhone target labels name the App Store Connect display group (Dynamic Island or
Face ID, Large or Medium) instead of inches, because one inch size spans several upload groups
(6.1" is both iPhone 16 and 17e); the persisted ids keep their inch form. Each iPhone target also
lists the `devices` whose store listing shows that upload, newest first, identically on its landscape
twin. The list is display data only and is updated when Apple adds a phone to a group; the git
history of `store-specs.json` is the record of past lineups. The Android tablet family leads with a 9:16 portrait target because Google Play's
large-screen guidance and recommendation eligibility name only 16:9 and 9:16; its former 10:16 lead
stays in the catalog as the migration source. Changing a family's lead is therefore a breaking
catalog change that requires the explicit core `migrateLeadTarget` operation (CLI
`screen migrate-lead`); projects are never migrated on load. Per layout and locale it moves a family
whose primary screens all fit the previous lead:
each root takes over its existing current-lead variant's content, or is fitted in place through
`fitElementsToArtboard`, and its original content stays unchanged as a previous-lead variant. Screen
ids, slot order, and other variants' pairing are preserved. Families already compatible with the lead
are left alone, ambiguous families are refused rather than guessed, and exporting an unmigrated
family fails with a pointer to the command.

`store-specs.json` is the single runtime authority for configured Apple, Android, Windows, and Web
destinations, output families, creation policy, and exact dimensions. The catalog is deliberately
curated, not an archive of every size a
store has accepted historically: Apple entries cover selected accepted sizes, while Google Play and
Microsoft Store entries are recommended presets within their broader requirements. Store rules can
change independently of an application release. Before submission, compare the runtime catalog with
the official [App Store screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/),
[Google Play preview-asset requirements](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en),
and [Microsoft Store screenshot guidance](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/screenshots-and-images).
Documentation may explain policy, but it must not duplicate the dimensions or become a competing
source of runtime truth.

Device frames are presentation elements only: they neither select a destination/device family nor
determine an export size. Bundled presets use renderer-owned, brand-neutral vector geometry; official
Apple device artwork and other vendor frame assets are not bundled. A persisted frame preset id
therefore selects visual treatment inside the artboard, not a claim about the exported target or a
specific hardware model. Non-device targets such as the Android Play Feature Graphic live alongside
device sizes in their owning family's `targets` list and are identified by target metadata rather
than by a fake device or frame. Play Feature Graphic is an exact `kind: "promotion"` target in the Android phone output
family. The creation starter materializes it as a standalone exact-target screen in an independent
set, so its default bundle contains no structural phone portrait. Landscape iPad and Android tablet
templates materialize their exact target as an ordinary `variantOf`/`storeTargetId` screen beside the
family lead root, so export never falls back to a portrait lead target with a different aspect ratio.
When no explicit `STORE_SPECS_PATH` is configured, the web runtime resolves this authority from the
invocation/workspace root even when a package runner changes its process directory to `apps/web`.
The exporter validates configured targets, exact dimensions, opaque output, and safe paths; it does
not validate store-listing copy, count, or portal metadata.

## 3. Rendering and export parity

Render/export parity is the primary invariant. The editor preview, static render route, UI export,
and CLI export all traverse the same core mapping and browser Konva stage. The CLI launches the
packaged web render host with Playwright; it never substitutes a Node canvas, Cairo, or a second text
layout path.

Every output is rendered at the selected exact target with `Stage.toDataURL({ pixelRatio })` and
flattened to an opaque PNG. Equivalent files need not be byte-identical because metadata and
compression may differ, but dimensions and visual output are verified by targeted parity coverage.
New render-affecting fields must extend the shared mapping and parity tests together.
Validation that depends on rendered geometry, such as text overflow, measures the same
`elementToNodeConfig` text config with Konva's own layout in the browser; it never estimates metrics
on a separate path. `screenshots check --render` reads the core Issues engine from the `/render` host
(`window.__collectIssues`, set with the stage's fonts and images), so the CLI reports the same issues
as the editor; without `--render` it runs the same engine in Node and skips text measurement.

Parity coverage runs against the pinned Playwright Chromium; `screenshots export --browser
chrome|msedge|auto` can launch an installed system browser, which is outside that coverage.

Connected mode is still one project model: each exact platform/device/locale/store-target group is
rendered as a gapless strip while elements retain owner-local coordinates. Export always takes one
requested artboard crop; it never stitches a separate image or slices a finished PNG.

Export profiles are separate from platforms. The default store bundle and optional `web-share`
profile consume PNGs produced by the shared browser renderer; Web Share only packages those outputs
with local HTML, CSS, metadata, and an Open Graph image, and is not another pixel renderer. The
CLI-only `fastlane` profile renames the same store-bundle PNGs into the `fastlane deliver`/`supply`
tree and skips sizes fastlane cannot upload.

`screenshots upload --store google` renders through the same bundle export into a temporary folder,
laid out by the shared store upload plan (`packages/cli/src/store-upload-plan.ts`), which also owns
the store locale and Android slot mapping the fastlane profile uses. The plan replaces each touched
Play slot as a whole in project screen order, leaves other slots and locales alone, and enforces the
8-screenshot and single-Feature-Graphic limits before anything is rendered. The Google Play client
uses `fetch` and `node:crypto` only: a service-account RS256 JWT is exchanged for an OAuth token, and
one androidpublisher v3 edit is opened, every planned locale is checked against the existing listings,
the touched slots are listed, deleted, and refilled, and the edit is committed once. Any failure
before the commit abandons the edit; requests time out after 60 seconds and are never retried. Production endpoints are constants in code;
tests inject a loopback mock through the command's dependencies, never through the environment.
`--dry-run` is offline and opens no edit.

`screenshots upload --store apple` uses the same plan module and render path. Which App Store Connect
screenshot set a target fills is catalog data: every App Store target in `store-specs.json` carries
`appStoreConnect: { displayType }` (an API `ScreenshotDisplayType` value, validated against the enum)
or `appStoreConnect: { unsupported: "<reason>" }`, which the plan reports as skipped. Landscape
targets share their portrait twin's display type; iPhone Duo targets are unsupported because the API
has no display type for them. The data is optional so custom catalogs stay valid; an unmapped App
Store target is skipped. The plan groups sets by App Store platform (Mac, Apple TV, and Vision Pro
display types belong to their own platform's version, everything else to iOS), locale, and display
type in export order, and enforces 10 screenshots and one size per set. The client signs an ES256
JWT over the `.p8` key with `node:crypto` (15-minute lifetime, reissued a minute before expiry) and
calls the v1 API with `fetch`. Version selection and localization lookup run before rendering. App
Store Connect has no atomic commit, so execution is set by set: delete, then reserve, upload the
parts (sent to Apple's presigned URLs with only the headers Apple returns, never the token), commit
with the MD5 checksum, and poll `assetDeliveryState` with a bounded wait. The first failure stops
the run and the report records each set as replaced, partial, failed, or untouched; the exit code is
non-zero unless all are replaced. The API root is a constant overridable only through the command's
dependencies.

The UI export route renders into a unique request-owned staging directory, copies the finished ZIP
into the one-shot artifact store, and removes the unpacked staging tree before responding. Its `201`
`no-store` ticket exposes only `downloadUrl`, `filename`, `expiresAt`, preflight warnings, and the
`written`/`total` counts, `failures` (screen id, bundle-relative path, reason), and `stopped`; server
filesystem paths are not client metadata. A missing artifact returns `404`, an expired artifact
returns `410`, and clients must not buffer, reuse, or retain an export artifact after download.
Optional `sizes` (`platform/device/targetId`) and `locales` lists filter the full `buildBundleEntries`
list, so the selected files keep the paths an unfiltered bundle gives them. Unlike the CLI, the UI
route skips a file that fails to render and reports it, and fails only when no file renders.
An optional opaque export operation id exposes short-lived, bounded progress snapshots while that
same request retains its normal lifecycle and project-mutation guards. Progress reports attempted
outputs plus packaging/finalization phases; it is auxiliary status, not artifact authority.
`POST /api/export/progress?operationId=…` asks that running export to stop (`202`; `404` once it is
not running). `exportBundle` checks the stop before each file and reports `attempted`, `written`, and
`stopped` once rendering ends; files rendered so far are packaged and published as usual, and a stop
before the first file returns the `201` result with `written: 0`, `stopped: true`, and no artifact
ticket. Unlike the export `POST`, the stop request carries no project session or revision fence: the
unguessable operation id is its only guard, which is acceptable for the localhost-only host.

## 4. Project sources, sessions, and persistence

An active project is a request-scoped session, not one process-global filesystem path. A source
adapter opens a local file, managed project, or future provider into a validated Project snapshot,
revision evidence, capabilities, and the resource services needed for that source. Browser clients
receive only safe descriptors; server-only locators and filesystem paths are not project fields.
The canonical Workspace route is `/editor/[entryId]`, where `entryId` is an opaque managed
`project_*` or local-history `recent_*` Project Library identity. That route activates the named
entry before editor resources mount and fails closed when the entry is invalid or unavailable; it
must never render a different cookie-selected project as a fallback. A local session's SHA-256
`projectId` remains a request fence and is not interchangeable with its `recent_*` entry identity.
The legacy `/editor` route remains a session-based compatibility entry and may canonicalize only
when the active selection already exposes an exact managed entry identity.

Every project-bound operation resolves one active context and sends its `X-Project-Id`; a missing
identity returns `428` and an inactive identity returns `409`. Versioned operations such as save,
interactive resource mutation, and export additionally send exactly one strong quoted `If-Match` ETag.
A missing revision returns `428`, a malformed ETag returns `400`, and a revision conflict returns `412`
with the current ETag. Routes use request-fence helpers or equivalent direct validation. Identity-only
lifecycle operations, such as Close project, require the project identity but not a revision. A failed
open or save preserves the last known-good active state rather than silently targeting another project.

Other writers, such as the CLI or an agent the user runs in the project folder, change the file
without telling the editor. While its Workspace is visible, the editor sends `GET /api/project` with
`If-None-Match` set to its revision every 2 seconds and on window focus. These checks wait for the
editor's own queued saves to finish first, so its own write is never mistaken for an external one. The
route answers `304` while the revision is unchanged. A `200` for the same `X-Project-Id` at another
revision reloads the project through the normal resource load, the only render path. A `422`
half-written file is ignored until it validates. A save the user started is never cancelled for an
external change: it fails its `If-Match` with `412`, the bytes on disk stay untouched, and the user
resolves the conflict ([`docs/editor.md`](editor.md)). Only `app-store-screenshots.json`
is compared, so a change to an asset file alone is not detected.

The core `StorageAdapter` owns loading/saving the Project document and explicitly submitted asset
bytes. Resource services own fonts, templates, themes, imports, processed assets, and export
artifacts. This separation keeps storage extensions from accidentally claiming ownership of every
file in a project.

Local read-modify-write operations use the core mutation-lock adapter around the complete
read → calculate → atomic-write transaction. The coordinator is for one local filesystem, not a
distributed lock. See [Project mutation locking](project-mutation-locking.md) for lifecycle,
recovery, defaults, and tests.

Generated files use a separate fail-closed publication boundary with path containment, no-follow
checks, owned staging, and identity-aware cleanup. See [Safe file publication](safe-file-publication.md)
for the exact contract and its local-filesystem limitations.

## 5. Resources and trust boundaries

Project assets and fonts are project-relative, local files. Asset discovery and serving enforce both
lexical and canonical containment; symlink escapes and unsafe paths are rejected. The browser never
treats a selected Folder, ZIP, or JSON input as a trusted server path: browser transfer validates a
bounded input and publishes a managed copy before activation.

Interactive image import accepts bounded PNG, JPEG, or WebP bytes, derives the stored extension from
the content, and publishes a collision-safe file under project-local `assets/imported/` while holding
the project mutation lease. Import itself does not rewrite the Project document; the ordinary editor
mutation assigns the resulting project-relative path to a screen element or background.

Capture import names every capture resource `assets/imports/<capture-key>-<digest12>.png`, where the
capture key is `slugify(platform-device-locale-stem)` (`captureImportKey`) and the digest prefix is
the SHA-256 of the bytes. That filename is the persisted refresh identity, so its derivation must not
change: `import --refresh` repoints every raster reference in the selected layout (image backgrounds,
screenshot, image, and device-frame leaves, including group children) whose `assetUrl` is exactly
that key with any digest to the new bytes. Refresh never adds, removes, reorders, or resizes screens
or elements; a capture nothing references is reported, not added. Replaced files stay on disk,
unreferenced. Captures imported before the key naming (resources named after a suffixed screen id)
are not matched.

Custom fonts are registered project assets under `assets/fonts/`. The shared renderer also ships a
small versioned built-in font catalog so text authoring works before a project adds font resources.
Built-in identities resolve to local renderer-owned bytes in both editor and CLI export. Operating
system fallbacks remain rejected because they make output depend on a machine. Google-font requests
may occur only at add time; later editor rendering and CLI export use local bytes.

The catalog holds two families. Studio Sans (Noto Sans, Latin and Latin-1, weight 400) stays the
default text font, so existing documents and new text keep their metrics. Studio Display (static
Inter Display 4.1 at 400, 600, and 800, covering Latin Extended-A, Cyrillic, and Greek) gives built-in
Design Packs and screen packs headline weights and those scripts. Built-in packs and templates cannot
carry font files, and registering a font at apply time would need the network and copy files into the
project, so the renderer ships these bytes instead. Hebrew, Arabic, and CJK still need a project font.
Importing an installed font copies the chosen file into the project as an ordinary `uploaded` font,
so it does not make the operating system a dependency of the project.

Themes and project templates are project-local inputs that produce ordinary strict Project literals.
The application also ships global read-only built-in template, screen pack, and Design Packs
catalogs, defined in code and never read from disk; a project may add its own packs in the same
shapes (see Project packs below). Selecting a built-in template materializes an
ordinary editable root or root/target-variant pair. A built-in screen pack (`TemplatePack`: id, name,
platform, device, style tag, and an ordered list of `ScreenTemplate`s) appends each of its screens the
same way, in one project update; the style tag names the Design pack its literals were baked from and
is not persisted. Five styles (Clean, Aurora, Midnight, Poster, Sunrise) each pair a Design pack with
a six-screen pack (hero, three features, social proof, call to action) for iPhone 6.3″ and Android
phone portrait. iPad 13″ and Android tablet portrait carry Clean and Aurora, and macOS 2880×1800
carries Clean and Poster. A landscape artboard keeps the copy in a phone-width column beside the
device, so it wraps as on a phone, and draws no style art, which is laid out around a portrait stack.
Each pack derives its geometry from the exact store artboard, sets type in Studio
Display, and draws generated art from shapes, because a global pack cannot carry image assets. The
picker previews in `apps/web/public/template-previews/<pack>/<screen>.png` come from the same renderer
and are static files; templates without one show a static placeholder, never a second render path.
`GET /api/templates` returns project `templates`, starter `builtIns`, and the full built-in `packs`.
A single pack screen is a built-in template too: `POST /api/templates` with `source: "built-in"` and
CLI `template add <id> --built-in` accept a pack screen id (`clean-iphone-hero`) and append only that
screen, while `source: "built-in-pack"` / `--pack` still append the whole pack. Panorama packs
reuse those six screens for the four styles whose background has no horizontal component, and add
shape art drawn once across the pack's strip. Each shape belongs to the screen holding its left edge
and leads that screen's elements, so connected rendering draws it behind every later screen's copy
and device. A panorama pack is added only whole and only to a connected layout; its screens are not
single templates, because each carries just its share of the art. Showcase packs (Midnight and Poster on both phones)
reuse the same six-screen stack but stage each slot differently through `SHOWCASE_SLOTS`: text above
or below, a device tilted about its centre (stored as a literal `rotation` with the top-left `x`/`y`
Konva needs), a second smaller `device-frame` behind the first on Feature 1, and a stat headline on
Social proof. Every device's rotated bounds stay inside the artboard width and clear of every text box. Applying a Design pack writes its solid or linear-gradient background to every
screen of the target layout, including exact-target variants, and bakes palette and typography into
role-tagged element literals. Typography sizes are fractions of each screen's artboard short side,
and letter spacing is a fraction of the baked size, so one pack fits artboards from 384 to 3840 px.
Applying a pack does not move or resize elements; the pack id is not persisted. No global template,
screen pack, or Design pack definition is copied into a project, and no catalog becomes hidden
renderer state. Asset preprocessing is explicit and non-destructive;
results are new local files that a user may deliberately assign to an element.

### Project packs

A project may carry its own packs in `packs/<id>/` next to `app-store-screenshots.json`, so a team
can copy a house pack between projects. Each folder holds exactly one manifest:
`screen-pack.json` is a `TemplatePack` and `design-pack.json` a `DesignPack`, validated by the same
strict schemas as the built-in catalogs (`packages/core/src/templates`, `packages/core/src/themes`),
so there is no second format or validator and no project field. The folder name must equal the pack
id, and an id that repeats a built-in pack of the same kind is rejected, so lookup by id is never
ambiguous.

The trust boundary matches other project resources. `@screenshot-studio/core/packs` reads packs on
the server or in the CLI only; the browser receives parsed packs from the fenced `GET /api/themes`
route. Screen pack asset URLs are `ProjectRelativePath`s, which rejects `..`, absolute paths, and
schemes, and they resolve against the pack folder. Every manifest and asset must be a regular file
whose canonical path equals its lexical path, so a symbolic link anywhere below the project folder
(the `packs/` folder, a pack folder, or an asset ancestor) is refused, and files open with no-follow
flags and an identity check. A manifest is capped at 1 MB and an asset at the 25 MB upload cap,
checked before reading. Asset names that project archives drop (hidden, credential-like, or
temporary) are refused, so a pack survives an archive round trip. Design packs carry no assets: their
background is solid or gradient. Discovery (`listProjectPacks`) never throws for a broken pack. It
returns the valid packs plus one `{ file, message }` per broken entry, with errno failures reduced to
their code so no absolute path reaches the browser, and the picker and `template list`/`theme list`
show both. Listing reads only each asset's leading bytes to recognize PNG, JPEG, or WebP; applying
reads the whole file and runs the same decode and pixel-limit checks as an uploaded image.

Applying a screen pack runs inside the project mutation lease. Each referenced asset is published
through the managed-resource path as `assets/packs/<id>/<sha256-12>-<stem>.<ext>`, with the stem
sanitized and bounded like an upload's and the extension of the decoded format (create-only, so a
re-apply converges and an edited pack gets a new file), the pack is rewritten to those paths, and
the result goes through `createScreensFromTemplatePack`, the path built-in packs use. Files created
by an update that rolls back are removed. The project document therefore references only ordinary
project assets and stays portable without its `packs/` folder; `packs/` is still a supported
project archive root. `template export-pack <layout-id> --out packs/<id>` snapshots one layout's
root screens (one locale, one output family, left-to-right) with literal artboards and copies each
referenced asset to the same relative path inside the pack folder. A relative `--out` resolves
against the project folder and must be exactly `packs/<slug>` there; a symbolic link is refused.
Under the project mutation lease it refuses an existing folder unless `--force` is given, and then
overwrites that screen pack's files one by one: files the new pack does not write stay in place,
and nothing is deleted. Packs
carry no font files, so text in a non-built-in font applies only where that font is registered.

## 6. Interfaces for people and tools

The `screenshots` CLI is the management interface for structural project changes. It scaffolds a
project, manages layouts/screens/locales/fonts/themes/imports, starts the editor, and exports exact
bundles. Layout-aware mutations require an explicit layout when a project has more than one; export
otherwise uses `preferredExportLayoutId`.

`screenshots template add <pack-id> --pack` appends a built-in screen pack through the shared
`createBuiltInTemplatePackScreens`, the same function the editor API uses.

`screenshots init` creates the standard directories and a self-contained project-local `AGENTS.md`.
That guide teaches literal layout, copy, localization, local asset processing, a list-pick-edit
"choose a style" flow over built-in packs, and schema guardrails without adding provider state or an
AI dependency. The optional repository skill only discovers or initializes such a project, then defers to its generated guide.
Its `references/` hold the art-direction guide (slide story, copy rules, and a pattern catalog limited
to existing schema fields, with an export-and-look loop) and the read-only critic rubric; both are
instructions, never project state.

The editor may run an official agent CLI that the user installed and signed in to with their own
subscription. The static server registry in `apps/web/lib/agents` defines each agent's binary,
verified version range, models, effort levels, official setup page, Terminal sign-in command, and policy
(`supported`, `at-own-risk`, or `unavailable`, with reason, consequences, source, and check date);
there is no remote configuration. Detection runs only
the CLI's own `--version`, `--help`, and auth-status commands under a timeout that kills the process
tree, shares one probe round between reads for a few seconds, and answers loopback Hosts only. It
never reads credential files and returns states, never account identity. Every agent process receives
an allowlisted environment, so API keys and provider switches in the server environment cannot move a
CLI off the subscription. The same allowlist keeps store credential variables away from agents, and
`agentEnv()` adds `SCREENSHOT_STUDIO_AGENT=1`; `screenshots upload` refuses to run when that variable
is set, even with `--dry-run`. The marker is an accident guard, not a security boundary: an agent can
unset it, and `--service-account <path>` or `--key-path <path>` accepts any key file the agent process
can read. An external
agent the user starts in a terminal inherits the user's environment and carries no marker, so for
external agents the protection is instruction-only: the project guide and skill describe `upload` as
human-only. A future Claude Code release may default `-p` to `--bare`, which ignores the
subscription, so any release whose `--help` no longer lists `--bare` as opt-in reports
`unsupported-version`; a flip the help check misses still cannot bill an API key, because the
environment carries none. `models` lists exact model IDs with display labels, the default first, so the
picker names the model that runs and a new model release needs a manual registry update; `efforts`
lists the levels of the CLI's effort option with a `defaultEffort`. An empty list means the CLI's own
default; Codex has neither, because its CLI default model is not pinned and its reasoning-effort levels
depend on the model. A run with a model or effort its agent does not list is refused
(`400 unknown-model`, `400 unknown-effort`). A run starts only from a loopback Host for the cookie-selected project session, after a
server-side policy and readiness check: `unavailable` never runs, and `at-own-risk` does not run
without the user's consent (`403 consent-required`). Consent is app-level local state in
`agent-consents.json` under the data root, never in a project document, and is bound to the policy's
`checkedAt`, so a re-verified policy asks again; a missing or unreadable file means no consent.
`POST /api/agents/consent` grants or revokes it for `at-own-risk` agents only, behind the project
session's `X-Project-Id` header so a cross-site page cannot grant it, and `/api/agents` reports each
agent's `consented` outside its probe cache; a grant for an agent without an adapter is refused. Consent
is checked again after the readiness probe, right before launch. Antigravity `agy` is listed with its
`at-own-risk` policy but has no adapter (it has no auth-status command, and its stream was never run
because that is the account-ban case), so it reports `no-adapter` and never runs. A run in the project folder, at most one per project, receives the user
message on stdin, and streams normalized events. Completion, cancel, timeout, or server exit kills its
whole process tree.

Codex runs as `codex exec --json` in the `workspace-write` sandbox (writes only to the project folder
and temp directories, no network) with approvals set to `never`. It ignores `$CODEX_HOME/config.toml`
and the execpolicy rules, whose `allow` decisions bypass the sandbox. Web search and the connector,
plugin, browser, computer-use, memory, hook, and sub-agent features are off. The server reads only
`cli_auth_credentials_store` from that file (`file` when absent) and passes it to both the readiness
probe and the run; an `ephemeral` store reports not signed in. Unlike Claude Code's restricted tools,
Codex has no command allowlist and can read the whole disk. It may also edit project files directly;
only `app-store-screenshots.json` is covered by the run's schema verdict and Undo run, and the run's
result lists the other files it changed.

A request may carry up to 5 PNG, JPEG, or WebP images of at most 10 MB each as context for that run.
They travel in the same `POST /api/agents/session` as a multipart body (`agentId`, `message`, `model`,
`effort`, and `image` parts), so the upload has exactly the run's guards: loopback Host, the cookie session's
`X-Project-Id`, and no client-supplied paths. The body is read through a size cap before it is parsed,
and each image's type is decided from its leading bytes, never its file name or declared type (`413`
for size, `400` for type and count; text-only requests stay JSON). Nothing is written until the run
passes the policy, consent, and readiness gate and has its project slot: then the images are saved as
`1.png`, `2.jpg`, ... (names chosen by the server) in a private folder under
`<os tmpdir>/screenshot-studio-agent-attachments-<uid>/<server pid>/run-*`, outside every project (the
root and pid folders must be real directories owned by the user and closed to others, or the run
fails instead of writing into a folder another user could have prepared), and that
folder is deleted when the run ends with any outcome (accepted, rejected, failed, timeout, or Stop),
after its process tree is dead. Another run never learns that folder's path. A server exit removes its
own folders, and server start (`instrumentation.ts`) removes the numbered folders of servers that no
longer exist, never a live server's. A text-only request never touches this folder. Codex receives one `--image <file>` per image; Claude Code receives
`--add-dir <run folder>`, since its restricted file tools read only added directories. Both get the
file paths in their instructions, which name `screenshots asset import <file>` as the only way to
place an image in the project, and only when the user asks for it. That command reads one regular
file from any path the CLI can read (rejecting non-files and files over 25 MB before reading), runs
the same validation and safe publication as `POST /api/assets`, and stores a copy under
`assets/imported/`. Like `font add`, it lets Claude Code bring in a local image
from beyond its added directories. The images are never part of the project document or schema. Undo run and Stop
leave an imported copy on disk, unreferenced, like any other file the run wrote outside the project
document.

An agent changes the project only through the `screenshots` CLI, which takes the regular project
mutation lock per write; the editor's own writers (`PUT /api/project`, every
`withProjectMutationRequest` route, and Undo run) answer `423 agent-running` while a run is active
instead of racing it. A run first reserves its project slot, so new editor writes are refused, then
waits for editor writes already in flight to finish (`409 project-busy` after 30 s, e.g. behind a long
export), and only then snapshots `app-store-screenshots.json` under the mutation lock; so no editor
write lands between the snapshot and the verdict. This fence is in-process: a terminal `screenshots`
CLI writing during a run is not refused, and Undo run drops it like any change after the snapshot.
After the process tree is dead the server reads the file back through the strict schema, under the
same lock. An invalid or deleted document is written back from the snapshot and the stream carries
`result: rejected` with the reason and the restored revision before `done: failed`; a valid one
carries `result: accepted` with the changed screen ids and the new revision, and the snapshot stays
pending so `/api/agents/outcome` can `keep` it (drop the snapshot) or `undo` it (restore the snapshot
as one locked write, refused once the editor has written past the run's revision). Every `result`,
accepted or rejected, also carries `otherFiles`: the files outside `app-store-screenshots.json` that
were added, changed, or removed in the project folder during the run, as relative paths (the first 50,
`AGENTS.md` and `CLAUDE.md` first, since later runs read them) with a total count. The server compares
an `lstat` fingerprint (mode, size, mtime, ctime) of every entry taken right after the snapshot with
one taken once the process tree is dead; symlinks are recorded, never followed, and the project
file's own temp and lock files and `.DS_Store` are skipped. A folder of more than 5,000 entries, or
one that cannot be read, gives `otherFiles: null`, never a partial list. Changes by the CLI's own
commands (imported images, fonts, themes, templates, exports) are listed the same way. Neither a
rejected verdict, Undo run, nor Stop restores these files; the pending outcome keeps the list for the
review. A run cancelled before launch never touched the project and ends with `done: cancelled` alone. Undo is per run, not
per change; snapshots live in server memory, so a restart drops a pending undo.

A session request may set `mode: "critic"` (default `edit`; any other value is `400`). The critic
gets the same agent, sandbox, and tool restrictions, but its instructions point at the skill's
read-only `references/critic.md` instead of `references/art-direction.md`, and the run is refused
with `409 critic-unavailable` when that file is missing. The server looks for the skill beside the
store specs, so the packed CLI ships `SKILL.md` and both references under `runtime/skills/` (a
custom `--store-specs` path leaves them out). Read-only is enforced by the verdict, not by
the sandbox, because the critic must export to see the set: a critic run that changed or broke
`app-store-screenshots.json` is restored from its snapshot as `result: rejected`. A critic run never
drops or replaces the pending outcome of the run it reviews; after such a restore that outcome's
revision follows the rewritten file, so Undo run still works. Its exports are listed in `otherFiles`.

The agent resolves `screenshots` from the server's `PATH`. In a source checkout `pnpm dev` puts
`apps/web/node_modules/.bin` first, and its `screenshots` runs `packages/cli/bin/screenshots.mjs`. That
launcher registers tsx's loader in-process with its disk cache off and the CLI's own `tsconfig.json`,
so a run listens on no IPC pipe, writes nothing to the OS temp directory, and compiles the same way
from any project folder. Agent sandboxes may deny both: the `tsx` CLI fails in Claude Code's sandbox with
`listen EPERM`, and tsx's cache fails when the temp directory is not writable. The launcher needs the
workspace dev dependencies (`pnpm install`); the installed package's bin is the bundled `dist/index.js`.

## 7. Change rules

- Preserve one Project schema and one browser rendering path.
- Put durable data/render/persistence constraints here; put UI semantics and component conventions in
  [`docs/editor.md`](editor.md).
- Keep store sizes in `store-specs.json` and validate new outputs against it.
- Treat that file as a curated runtime catalog, not a promise of exhaustive historical store sizes;
  verify changing submission rules against the official store documentation linked above.
- Treat schema widening, filesystem publication, session identity, and render changes as high-risk
  changes with focused tests.
- Publication is separate from implementation. Candidate verification and owner authorization live in
  [`docs/releasing.md`](releasing.md).
