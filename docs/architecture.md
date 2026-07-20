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

`store-specs.json` is the runtime authority for configured Apple, Google, and Microsoft dimensions.
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

The UI export route returns a `201` `no-store` ticket with `downloadUrl`, `outputDir`, and
`expiresAt`. Its download URL is one-shot: a missing artifact returns `404`, an expired artifact
returns `410`, and clients must not buffer, reuse, or retain an export artifact after download.

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

Fonts are registered project assets under `assets/fonts/`. System fallbacks are rejected because they
make output depend on a machine. Google-font requests may occur only at add time; editor rendering and
CLI export load the same local file bytes through browser `FontFace`.

Themes and templates are project-local inputs that produce ordinary strict Project literals. They do
not become hidden renderer state. Asset preprocessing is explicit and non-destructive; results are
new local files that a user may deliberately assign to an element.

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
