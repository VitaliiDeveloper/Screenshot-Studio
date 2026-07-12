# Phase 2 Slice 3 — Artboard target validation + UI export

Design spec. Scope is intentionally narrow: close the Phase 2 UI/CLI export parity gap without
adding broader project-management commands or a second renderer.

## Goal & risk retired

Make store-target compatibility visible while editing, then let the editor export the same
lead-size bundles the CLI exports today.

This slice retires two concrete Phase 2 risks:

- **Late artboard failure.** Today a user can freely edit artboard width/height and discover only
  at export time that `exportPixelRatio` rejects the artboard/target aspect ratio. The editor
  should show target compatibility before export and provide one-click exact target sizing.
- **CLI-only export.** The roadmap parity exit criterion requires the UI export button and CLI
  export to produce exact-size, no-alpha PNGs from the same project JSON. The UI needs an export
  entrypoint on top of the same headless `/render` orchestration, not a client-only canvas export.

## In scope

- Add framework-free artboard/target compatibility helpers in `packages/core/src/export`.
- Show active-screen artboard status in the Inspector:
  - exact store target match,
  - proportional target match (safe to export, but not exact design size),
  - invalid aspect ratio (export would fail).
- Add one-click artboard target presets for the active screen's current `platform/device`, with
  the lead bundle target visually identified.
- Keep manual artboard width/height editing.
- Block UI export when any selected bundle screen has an invalid artboard/lead-target pair.
- Add a Toolbar Export button and small export dialog for bundle filters:
  - platform: all/apple/android,
  - device: all/iphone/ipad/phone,
  - locale: all or one project locale.
- Save the current project before exporting from the UI.
- Add a web-side export route that reuses the existing web renderer and CLI export primitives:
  build bundle entries, render through `/render`, strip alpha, assert dimensions, write the
  `export/` bundle, and return the zip for browser download.
- Preserve the existing CLI `screenshots export` behavior.

## Out of scope

- `screenshots dev`, `screenshots import`, and `screenshots screen ...` commands.
- Asset picker or insertion UI for `screenshot` / `device-frame`.
- New store targets beyond `apple/iphone`, `apple/ipad`, and `android/phone`.
- Client-side export from the visible editor canvas.
- A node-canvas renderer, alternate renderer, or any second pixel path.
- Silent auto-snapping on every artboard edit.
- Export progress streaming; a single pending/success/error state is enough for this slice.

## Decisions

1. **Invalid artboards block export; they do not auto-snap.** Automatic snapping can unexpectedly
   resize a composition. The editor should make the problem visible and offer explicit target
   preset actions.
2. **Proportional artboards are allowed.** `exportPixelRatio` can scale them without distortion,
   so blocking them would be stricter than the export contract. The UI should still label them as
   proportional so users understand the design is not at the final pixel size.
3. **The UI route writes the same bundle files as the CLI and returns the zip.** This matches the
   local, self-hosted model: the project file and `export/` directory are on disk, and the browser
   gets the completed archive as a download.
4. **The UI route reuses the current Next host as the render host.** Unlike the CLI, the editor is
   already running inside the web app, so the route does not spawn another Next server. It creates
   one Playwright browser/context for the export run and renders the existing `/render` route.
5. **Shared export logic stays reusable, but not forced into `core`.** `core/export` owns pure
   selection, target, path, pixel-ratio, and PNG helpers. Side effects stay in app/CLI code.

## Core/export helpers

Add pure helpers in `packages/core/src/export`, keeping `store-specs.json` as the target source:

- `artboardTargetStatus(artboard, target)` returns:
  - `{ kind: "exact", pixelRatio }` when dimensions equal the target,
  - `{ kind: "proportional", pixelRatio }` when aspect ratio matches but dimensions differ,
  - `{ kind: "invalid", message }` when `exportPixelRatio` would reject the pair.
- `artboardTargetStatuses(screen, specs)` returns statuses for every store size under the
  screen's `platform/device`.
- `validateBundleArtboards(entries)` fails before rendering if any bundle entry is invalid for
  its lead target. The error includes screen id/name and target id.

These helpers do not import React, Next.js, Playwright, or filesystem APIs.

## Inspector behavior

When no element is selected, the Inspector keeps the current artboard width/height fields and
adds a compact target section for the active screen:

- show the screen's `platform/device`;
- list compatible target presets from `store-specs.json`;
- identify the bundle lead target (`6.9`, `13`, or `phone-portrait`);
- show the current active target status:
  - exact: neutral/success text,
  - proportional: neutral warning text,
  - invalid: blocking warning text;
- provide a per-target action that sets `screen.artboard` to that target's exact dimensions and
  schedules the same save path as manual edits.

Manual editing remains possible because some users may intentionally design at half scale or at a
different proportional size. The save path remains strict Zod validation through `/api/project`.

## UI export flow

Add an Export button to `Toolbar`. The dialog is intentionally small:

- platform filter defaults to all;
- device filter defaults to all;
- locale filter defaults to all;
- export action is disabled while a save/export is pending;
- validation errors are shown in the dialog and do not start rendering;
- success triggers a zip download and shows the written `export/` location.

Before sending the export request, the client saves the current `editorStore.project` through the
existing `/api/project` path. This keeps `/render` and the export route reading the same project
JSON the user sees in the editor.

## Web export route

Add `POST /api/export` with a JSON body:

```ts
{
  platform?: "apple" | "android";
  device?: "iphone" | "ipad" | "phone";
  locale?: string;
}
```

The route:

1. Resolves the current project path with `resolveProjectPath()`.
2. Loads and validates the project JSON through `core/model`.
3. Loads and parses `store-specs.json`.
4. Builds bundle entries with `buildBundleEntries(project, specs, filters)`.
5. Validates every entry's artboard against its lead target before launching Playwright.
6. Creates one render browser session for the run.
7. Uses the current request origin as `baseUrl` for `/render`.
8. Calls the shared bundle export writer/orchestrator.
9. Returns the zip bytes with `content-type: application/zip` and a download filename.

Implementation detail: if the current `packages/cli/src/export.ts` helpers are not exported as a
stable package API, factor the side-effect-light pieces needed by both CLI and web into a small
shared module without moving browser/Next-specific code into `core`.

## Error handling

Fail before rendering when:

- project JSON is invalid;
- filters match no screens;
- the chosen filter combination is structurally invalid;
- any selected screen cannot scale to its lead target;
- `store-specs.json` lacks the lead target for a schema-supported device.

Render failures include the screen id and target id, preserving the Slice 2 error shape. The UI
shows the message directly in the export dialog.

## Verification

- `pnpm test` covers:
  - exact/proportional/invalid artboard target statuses,
  - target preset listing for each current platform/device,
  - bundle artboard validation before rendering,
  - existing bundle path behavior stays unchanged.
- `pnpm typecheck` covers the new web route, dialog props, and shared helper types.
- `pnpm lint` covers the edited app/core files.
- A focused e2e test covers UI-triggered export:
  - open the editor on the Phase 2 bundle fixture,
  - trigger the export dialog,
  - download the zip,
  - assert zip entries have exact target dimensions and no alpha.
- Existing CLI bundle export e2e remains green, proving the UI work did not fork or regress the
  CLI path.
