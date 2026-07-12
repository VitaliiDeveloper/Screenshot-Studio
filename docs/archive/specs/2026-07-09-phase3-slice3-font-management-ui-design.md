# Phase 3 Slice 3 — Font management UI

## Goal

Make the file-backed font model from Slices 1–2 usable from the editor: add custom or Google
fonts, inspect and preview registered identities, remove them, and apply an exact
`(fontFamily, weight)` identity to a text element. Render and export stay offline and keep using
the existing `FontFace` readiness gate.

## Shared ingest boundary

The CLI's font filesystem/network operations move behind an exported Node service in
`@screenshot-studio/cli/font-service`. Both the CLI command and the Next.js API route call that
service. `core` remains browser-safe and network/filesystem agnostic.

Google Fonts are still materialized only at add-time. The editor POST reaches Google from the
server route, writes one full-coverage file under `assets/fonts/`, then records the same
`FontAsset` shape as the CLI. The browser, canvas, `/render`, and export never fetch Google.

## API

`/api/fonts` is the local editor host's font-management boundary:

- `GET` returns the registered `FontAsset[]` from the current project.
- `POST multipart/form-data` accepts `file`, `family`, and `weight` for a custom upload.
- `POST application/json` accepts `{ source: "google", family, weight }`.
- `DELETE application/json` accepts `{ family, weight }` and uses the same managed-file cleanup
  rules as `screenshots font rm`.

Every mutation returns the validated current project. Unsupported extensions, invalid weights,
duplicate identities, missing files, and Google download failures are explicit 4xx responses.

Before a UI mutation, the editor's serialized persistence coordinator waits for any in-flight
save, cancels a queued debounce, flushes the latest project through `/api/project`, and keeps later
saves behind the font mutation until its durable project result is synchronized into the store.

## Editor UI

The toolbar gains a Fonts button that opens a compact management dialog:

- upload tab/section: local file, explicit family, and weight;
- Google section: family and weight;
- registered list: family, weight, provenance, live preview, remove, and Apply when a text
  element is selected.

Newly added fonts are registered with the browser `FontFace` API before they are exposed for
selection. Removing a font follows CLI semantics even when it is used; affected text becomes an
unresolved identity and the existing export guard reports it. The dialog warns when an identity
is currently used.

The text inspector replaces its independent free-form family and weight inputs with one picker
whose options are the project's registered font identities. Family and weight are patched
atomically. An unresolved current identity remains visible as a labelled option so the user can
repair an older project.

## Out of scope

Font metadata parsing, italic/style variants, variable-font axes, browsing/searching the entire
Google catalogue, render-time network access, themes, and templates.

## Verification

- Node-service and API tests cover custom upload, Google materialization and URL validation,
  exclusive create, rollback, duplicate/weight/file validation, list, and safe removal.
- Store/inspector tests cover atomic family+weight application.
- Editor e2e covers upload, preview/list visibility, apply, persistence, and reload.
- Existing CLI font tests, typecheck, unit suite, and render/export e2e remain green.
