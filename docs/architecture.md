# Architecture & Technical Contract

This document describes durable technical boundaries: data, rendering, persistence, resources, and
the interfaces that connect them. It is the technical source of truth when a summary disagrees with
the implementation. [`docs/editor.md`](editor.md) owns UI/UX semantics, shared UI primitives, and
accessible interaction patterns; neither document is a delivery history or a roadmap.

## 1. System shape

Screenshot Studio is a pnpm workspace with one rendering model shared by its interactive editor and
CLI:

```text
packages/core  → strict model, rendering, export, fonts, assets, storage contracts
packages/cli   → project management and headless render-host orchestration
apps/web       → Next.js editor, API routes, and the shared browser render target
```

`core` is framework-agnostic and does not depend on Next.js, HTTP, or a particular project picker.
The web shell owns selection and UI; the CLI owns command parsing and process orchestration. Both
surfaces use core model and rendering helpers rather than maintaining parallel implementations.
Inside `core`, dependencies between top-level domains use the package's public
`@screenshot-studio/core/<domain>` subpaths; relative imports remain local to one domain. This keeps
the internal dependency graph aligned with the contracts available to web and CLI.

| Concern | Contract |
|---|---|
| Model validation | Zod strict schema in `packages/core/src/model/schema.ts` |
| Render engine | Konva through one shared NodeConfig mapping |
| UI and CLI export | The same browser `/render` stage, driven by Playwright for CLI export |
| Store dimensions | `store-specs.json`, never duplicated constants |
| Fonts | File-backed browser `FontFace` loading |
| Editor state | Zustand with persistent Project content separated from transient UI state |
| UI system | Local editor primitives, Tailwind, Lucide; no package-level design system until a second consumer exists |

## 2. Project model and ownership

`app-store-screenshots.json` is the only persisted Project document. It is versioned, strict,
git-trackable JSON: unknown fields fail validation and a new persisted field needs explicit schema,
renderer, fixture, and parity work.

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

Screen-slot behavior is a layout-local output-family policy keyed by platform, device, and locale.
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

`store-specs.json` is the runtime authority for configured Apple, Android, Windows, and Web output
families and exact dimensions. Device frames are presentation elements only: they neither select a
platform nor determine an export size. Non-device targets such as the Android Play Feature Graphic
live in the platform-level `$outputs` catalog and are identified by target metadata rather than by a
fake device or frame. Play Feature Graphic is an exact `kind: "promotion"` target in the Android
phone output family. The creation starter materializes it as a standalone exact-target screen in an
independent set, so its default bundle contains no structural phone portrait. Landscape iPad and
Android tablet templates materialize their exact target as an ordinary `variantOf`/`storeTargetId`
screen beside the family lead root, so export never falls back to a portrait lead target with a
different aspect ratio.
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

Connected mode is still one project model: each exact platform/device/locale/store-target group is
rendered as a gapless strip while elements retain owner-local coordinates. Export always takes one
requested artboard crop; it never stitches a separate image or slices a finished PNG.

Export profiles are separate from platforms. The default store bundle and optional `web-share`
profile consume PNGs produced by the shared browser renderer; Web Share only packages those outputs
with local HTML, CSS, metadata, and an Open Graph image, and is not another pixel renderer.

The UI export route renders into a unique request-owned staging directory, copies the finished ZIP
into the one-shot artifact store, and removes the unpacked staging tree before responding. Its `201`
`no-store` ticket exposes only `downloadUrl`, `filename`, `expiresAt`, and preflight warnings; server
filesystem paths are not client metadata. A missing artifact returns `404`, an expired artifact
returns `410`, and clients must not buffer, reuse, or retain an export artifact after download.
An optional opaque export operation id exposes short-lived, bounded progress snapshots while that
same request retains its normal lifecycle and project-mutation guards. Progress reports completed
rendered outputs plus packaging/finalization phases; it is auxiliary status, not artifact authority.

## 4. Project sources, sessions, and persistence

An active project is a request-scoped session, not one process-global filesystem path. A source
adapter opens a local file, managed project, or future provider into a validated Project snapshot,
revision evidence, capabilities, and the resource services needed for that source. Browser clients
receive only safe descriptors; server-only locators and filesystem paths are not project fields.

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
The application also ships global read-only built-in template and Design Packs catalogs. Selecting a
built-in template materializes an ordinary editable root or root/target-variant pair. Applying a pack
bakes palette, typography, and supported spacing-scale values into render-bearing element literals;
the pack id is not persisted. No global template or pack definition is copied into a project, and
neither catalog becomes hidden renderer state. Asset preprocessing is explicit and non-destructive;
results are new local files that a user may deliberately assign to an element.

## 6. Interfaces for people and tools

The `screenshots` CLI is the management interface for structural project changes. It scaffolds a
project, manages layouts/screens/locales/fonts/themes/imports, starts the editor, and exports exact
bundles. Layout-aware mutations require an explicit layout when a project has more than one; export
otherwise uses `preferredExportLayoutId`.

`screenshots init` creates the standard directories and a self-contained project-local `AGENTS.md`.
That guide teaches literal layout, copy, localization, local asset processing, and schema guardrails
without adding provider state or an AI dependency. The optional repository skill only discovers or
initializes such a project, then defers to its generated guide.

## 7. Change rules

- Preserve one Project schema and one browser rendering path.
- Put durable data/render/persistence constraints here; put UI semantics and component conventions in
  [`docs/editor.md`](editor.md).
- Keep store sizes in `store-specs.json` and validate new outputs against it.
- Treat schema widening, filesystem publication, session identity, and render changes as high-risk
  changes with focused tests.
- Publication is separate from implementation. Candidate verification and owner authorization live in
  [`docs/releasing.md`](releasing.md).
