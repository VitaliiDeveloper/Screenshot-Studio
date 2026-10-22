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
metadata, file-backed fonts, a preferred export layout, and ordered layouts. A layout owns ordered
screens; each screen owns its artboard, background, locale/direction, optional explicit store-target
variant identity, and ordered elements. Array order is meaningful for layout, screen, and z-order.

Layouts are independent authoring alternatives with an explicit `isolated` or `connected` mode.
Elements stay owned by one screen even when connected rendering lets decoration cross a crop boundary.
Only strict v1 element types and literals are valid. Workspace selections, viewport state, open panels,
history, source locators, recents, credentials, and server lifecycle metadata never enter Project JSON.
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
on a separate path.

Connected mode is still one project model: each exact platform/device/locale/store-target group is
rendered as a gapless strip while elements retain owner-local coordinates. Export always takes one
requested artboard crop; it never stitches a separate image or slices a finished PNG.

Export profiles are separate from platforms. The default store bundle and optional `web-share`
profile consume PNGs produced by the shared browser renderer; Web Share only packages those outputs
with local HTML, CSS, metadata, and an Open Graph image, and is not another pixel renderer.

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

Custom fonts are registered project assets under `assets/fonts/`. The shared renderer also ships a
small versioned built-in font catalog so text authoring works before a project adds font resources.
Built-in identities resolve to local renderer-owned bytes in both editor and CLI export. Operating
system fallbacks remain rejected because they make output depend on a machine. Google-font requests
may occur only at add time; later editor rendering and CLI export use local bytes.

Themes and project templates are project-local inputs that produce ordinary strict Project literals.
The application also ships global read-only built-in template, screen pack, and Design Packs
catalogs, defined in code and never read from disk. Selecting a built-in template materializes an
ordinary editable root or root/target-variant pair. A built-in screen pack (`TemplatePack`: id, name,
platform, device, style tag, and an ordered list of `ScreenTemplate`s) appends each of its screens the
same way, in one project update; the style tag names the Design pack its literals were baked from and
is not persisted. Applying a Design pack writes its solid or linear-gradient background to every
screen of the target layout, including exact-target variants, and bakes palette and typography into
role-tagged element literals. Typography sizes are fractions of each screen's artboard short side,
and letter spacing is a fraction of the baked size, so one pack fits artboards from 384 to 3840 px.
Applying a pack does not move or resize elements; the pack id is not persisted. No global template,
screen pack, or Design pack definition is copied into a project, and no catalog becomes hidden
renderer state. Asset preprocessing is explicit and non-destructive;
results are new local files that a user may deliberately assign to an element.

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

The editor may run an official agent CLI that the user installed and signed in to with their own
subscription. The static server registry in `apps/web/lib/agents` defines each agent's binary,
verified version range, model aliases, and policy (`supported`, `at-own-risk`, or `unavailable`, with
reason, consequences, source, and check date); there is no remote configuration. Detection runs only
the CLI's own `--version`, `--help`, and auth-status commands under a timeout that kills the process
tree, shares one probe round between reads for a few seconds, and answers loopback Hosts only. It
never reads credential files and returns states, never account identity. Every agent process receives
an allowlisted environment, so API keys and provider switches in the server environment cannot move a
CLI off the subscription. A future Claude Code release may default `-p` to `--bare`, which ignores the
subscription, so any release whose `--help` no longer lists `--bare` as opt-in reports
`unsupported-version`; a flip the help check misses still cannot bill an API key, because the
environment carries none. `models` lists only aliases the CLI resolves itself; an empty list means the
CLI default. A run starts only from a loopback Host for the cookie-selected project session, after a
server-side policy and readiness check: `unavailable` never runs, and `at-own-risk` does not run until
consent storage exists. It runs in the project folder, at most one per project, receives the user
message on stdin, and streams normalized events. Completion, cancel, timeout, or server exit kills its
whole process tree.

Codex runs as `codex exec --json` in the `workspace-write` sandbox (writes only to the project folder
and temp directories, no network) with approvals set to `never`. It ignores `$CODEX_HOME/config.toml`
and the execpolicy rules, whose `allow` decisions bypass the sandbox. Web search and the connector,
plugin, browser, computer-use, memory, hook, and sub-agent features are off. The server reads only
`cli_auth_credentials_store` from that file (`file` when absent) and passes it to both the readiness
probe and the run; an `ephemeral` store reports not signed in. Unlike Claude Code's restricted tools,
Codex has no command allowlist and can read the whole disk. It may also edit project files directly;
only `app-store-screenshots.json` is covered by the run's schema verdict and Undo run.

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
as one locked write, refused once the editor has written past the run's revision). A run cancelled
before launch never touched the project and ends with `done: cancelled` alone. Undo is per run, not
per change; snapshots live in server memory, so a restart drops a pending undo.

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
