# Phase 6 Slice 6 — Asset picker and existing media insertion

Status: complete. Safe discovery/serving, searchable previews, both existing media insertions, and
connected-owner persistence/reload coverage have passed.

## Goal

Open the editor workflow for the already-enforced `screenshot` and `device-frame` element types
without adding uploads, external storage, a decorative image type, or another loader/render path.

## Contract

- The picker recursively discovers regular PNG, JPEG, and WebP files under documented project-local
  `assets/` and `screenshots/` roots, returns portable relative paths in stable order, and never
  follows hidden entries or symlinks.
- The asset-serving route verifies both lexical and real-path containment, so a persisted or queried
  project-relative path cannot escape through traversal or a symlink.
- Screenshot and iPhone frame entries in Add open the picker; the planned decorative Image entry
  remains disabled.
- Choosing an asset calls the existing core factory, inserts into the active owner screen, selects
  the new element, and persists through the ordinary history/save path.
- The editor's existing project image signature/cache loads the new path through `/api/asset`;
  static UI/CLI rendering keeps using the same core image cache and element mapper.
- No file upload, copy, delete, rename, or project JSON replacement occurs in the picker.

## Implementation

- Add shared asset descriptors/filtering plus a server-only contained discovery walk and `/api/assets`.
- Harden `/api/asset` against real-path escapes while preserving image/font serving and headless
  project resolution.
- Enable the two existing Add catalog rows and add one searchable preview dialog.
- Insert via `createScreenshotElement` / `createDeviceFrameElement` and `addElement`.
- Cover discovery, filtering, route safety, catalog actions, and both connected-owner insertions.

## Verification

1. Focused discovery/catalog/asset-route tests — 4 files / 14 tests passed.
2. `pnpm test:web` — 15 files / 79 tests passed.
3. `asset-picker`, `editor`, `connected-editor`, and `editor-history` E2E — 4 files / 8 tests
   passed.
4. `pnpm lint` passed without warnings.
5. `pnpm typecheck` passed through raw RTK proxy output.
6. `git diff --check` passed.
