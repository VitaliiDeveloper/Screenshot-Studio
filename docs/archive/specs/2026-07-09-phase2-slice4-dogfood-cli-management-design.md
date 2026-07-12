# Phase 2 Slice 4 - Dogfood CLI management

Design spec. Scope is intentionally narrow: make the existing file-backed screenshot workflow
manageable from the CLI after verified export is already in place. This slice does not change the
renderer, schema version, export sizes, or editor data model.

## Goal

Add the missing Phase 2 CLI management surface:

- `screenshots dev` runs the existing web editor for a project.
- `screenshots screen list` prints screens in export order.
- `screenshots screen add` appends a schema-valid screen.
- `screenshots screen rm` removes a screen without allowing an empty project.
- `screenshots screen reorder` changes the `screens[]` order, which is also bundle export order.
- `screenshots import <dir>` ingests raw captures from the documented directory convention as
  screenshot screens.

The result should let a user initialize or open a project, import captures, manage screen order,
run the editor, and export bundles without hand-editing JSON for routine operations.

## Non-goals

- No second render path, export refactor, or browser-side canvas export.
- No schema v2 or new element/background/font/theme types.
- No asset picker UI.
- No image analysis, OCR, or generated marketing copy.
- No recursive support for every future Google surface; this slice stays within the current schema:
  `apple/iphone`, `apple/ipad`, and `android/phone`.

## CLI contract

All commands accept `--project <path>`, defaulting to `app-store-screenshots.json` in the current
directory. Commands that mutate the project must load through `parseProjectJson`, write pretty JSON
with a trailing newline, and re-parse the result before writing so strict Zod validation remains the
backstop.

### `screenshots dev`

Runs the existing Next editor through `startWebServer`.

- `--project <path>` sets the web app's `PROJECT_PATH` environment variable.
- `--port <number>` optionally requests a port; omitted means choose a free localhost port.
- The command prints the editor URL and stays alive until interrupted.

This is a thin wrapper around the same web app used by export. It must not create a new editor host
or renderer.

### `screenshots screen list`

Prints one line per screen in `project.screens` order:

```text
1 hero apple/iphone en Hero
2 ipad-hero apple/ipad en iPad Hero
```

This command is read-only and is the CLI view of bundle export order.

### `screenshots screen add`

Adds one screen:

```bash
screenshots screen add --platform apple --device iphone --locale en --name "Hero"
```

Rules:

- `--platform`, `--device`, and `--locale` are required.
- `--id` is optional; if omitted, derive a unique slug from the name.
- `--name` defaults to a title-cased id.
- `--size <store-size-id>` is optional and defaults to the platform/device lead target.
- The new screen uses a solid dark background and an empty `elements` array.
- `project.locales` and derived `project.platforms` are updated from the resulting screens.

### `screenshots screen rm`

Removes a screen by id:

```bash
screenshots screen rm hero
```

It fails if the id is unknown or if removing it would leave the project with no screens. After a
successful removal, `project.locales` and `project.platforms` are recomputed from remaining screens.

### `screenshots screen reorder`

Moves a screen by id to a 1-based position:

```bash
screenshots screen reorder hero --to 1
```

The array order is the source of truth. The command fails for unknown ids or out-of-range positions.

### `screenshots import <dir>`

Imports PNG captures from the documented convention:

```text
screenshots/
├── apple/{iphone,ipad}/{locale}/NN.png
└── android/phone/{locale}/NN.png
```

Rules:

- Only `.png` files are imported in this slice.
- Unsupported platform/device folders are ignored with a warning.
- Imported files are copied into the project `assets/imports/...` tree using stable relative paths.
- Each imported image creates one screen with one full-artboard `screenshot` element.
- Artboard dimensions come from the source PNG. If the PNG aspect ratio is not compatible with the
  lead target, the import still succeeds because Slice 3 already surfaces target compatibility.
- Screen order follows sorted file order by platform, device, locale, then filename.
- Existing screens are preserved; imported screens append to the end.
- Duplicate generated ids are made unique with `-2`, `-3`, etc.

## Shared helpers

Add CLI-local project management helpers rather than expanding the UI store:

- `packages/cli/src/project-io.ts`: resolve, load, validate, and write project JSON.
- `packages/cli/src/screen-commands.ts`: pure-ish screen list/add/remove/reorder operations plus
  command runners.
- `packages/cli/src/import-command.ts`: filesystem import orchestration.

If a helper becomes useful to the web UI later, move it to `core` in a later slice. For now, keeping
CLI side effects in `packages/cli` follows the existing export split.

## Verification

- Unit tests cover CLI mode parsing and command dispatch.
- Unit tests cover screen add/list/rm/reorder mutations and derived `platforms`/`locales`.
- Unit tests cover import path parsing, unsupported folder handling, copied assets, and generated
  screenshot elements.
- Existing `pnpm test` and `pnpm typecheck` remain green.
- A smoke command against a temporary project proves `screen add`, `screen reorder`, and `screen
  list` work through the real CLI entrypoint.
