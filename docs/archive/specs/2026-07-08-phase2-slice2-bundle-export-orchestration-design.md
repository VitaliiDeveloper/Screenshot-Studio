# Phase 2 Slice 2 — Bundle export orchestration

Design spec. Scope is intentionally narrow: make export bundling reliable from the CLI before
adding the UI export button or broader project-management commands.

## Goal & risk retired

Export all matching screens for one bundle target set through the existing web renderer, producing
store-ready PNGs and a zip grouped by `platform/device/locale`.

This slice retires two concrete Phase 2 risks:

- **Cold-start per PNG.** Today every `exportScreenToPng` call can launch a browser. Bundle export
  must reuse one render host and one Playwright browser/context for the whole run.
- **Fixed render-host port.** Today `startWebServer()` defaults to port `3100`, which can collide
  as soon as tests or exports overlap. The export host must pick an available port unless a caller
  explicitly supplies one.

## In scope

- Keep the existing one-screen export mode: `screenshots export --screen <id> --size <id>`.
- Add bundle export mode through filters:
  - `--platform <apple|android>`
  - `--device <iphone|ipad|phone>`
  - `--locale <locale>`
- Bundle mode exports every screen matching the supplied filters. Omitted filters mean "all".
- Bundle targets use the **lead size per device**:
  - `apple/iphone` → `6.9`
  - `apple/ipad` → `13`
  - `android/phone` → `phone-portrait`
- Other sizes in `store-specs.json` remain available only through explicit one-screen
  `--screen --size` export.
- Output PNGs are flattened (no alpha) and dimension-asserted exactly as the current single-screen
  export does.
- Write a zip bundle organized by `platform/device/locale`.
- Start one web render host for the run and reuse one Playwright browser/context for all PNGs.
- Pick a free port by default; keep tests able to pass an explicit port when needed.

## Out of scope

- UI export button/dialog.
- Artboard store-target validation or snapping in the editor.
- `screenshots dev`, `screenshots import`, and `screenshots screen ...`.
- New store targets beyond the current Slice 1 device set.
- New renderer, node-canvas fallback, or any second rendering path.

## CLI behavior

The command stays `screenshots export`.

Single-screen mode remains compatible:

```bash
pnpm screenshots export --project ./app-store-screenshots.json --screen hero --size 6.9
```

Bundle mode is selected when `--screen` is omitted and any bundle filter is present, or when no
`--screen`/`--size` flags are present:

```bash
pnpm screenshots export --project ./app-store-screenshots.json --platform apple
pnpm screenshots export --project ./app-store-screenshots.json --platform apple --device ipad
pnpm screenshots export --project ./app-store-screenshots.json --locale en
```

Invalid combinations fail before rendering:

- `--screen` with bundle filters is rejected.
- `--size` without `--screen` is rejected, because bundles intentionally use lead sizes only.
- A filter that matches no screens is rejected with a clear message.

The default `--out` remains `<project>/export`.

## Output layout

Bundle mode writes both individual PNGs and one zip:

```text
export/
├── apple/
│   ├── iphone/
│   │   └── en/
│   │       └── 01-hero-6.9.png
│   └── ipad/
│       └── en/
│           └── 01-hero-ipad-13.png
├── android/
│   └── phone/
│       └── en/
│           └── 01-hero-phone-phone-portrait.png
└── app-store-screenshots-bundle.zip
```

Screen order is the existing `project.screens` array order. The numeric prefix is one-based in
that order after filtering. Filenames include a sanitized screen name plus target id; if two names
collide after sanitization, append the screen id.

## Core/export helpers

Add framework-free helpers in `packages/core/src/export`:

- `leadStoreSizeId(platform, device)` returns the lead size id for the current Phase 2 scope.
- `selectBundleScreens(project, filters)` returns ordered screens matching optional
  platform/device/locale filters.
- `buildBundleEntries(project, specs, filters)` returns render jobs:
  `{ screen, target, relativePath }`.

These helpers know nothing about Playwright, Next.js, or files. They make target selection and
path layout unit-testable without launching a browser.

## CLI orchestration

`packages/cli` owns side effects:

1. Load and validate the project JSON.
2. Load `store-specs.json`.
3. Build bundle entries through `core/export`.
4. Start one web server on a free port.
5. Open one Playwright browser/context.
6. Render each entry through `/render` using the shared context.
7. Strip alpha and assert target dimensions.
8. Write each PNG to disk.
9. Add each PNG to a zip and write it once at the end.
10. Stop the browser and server in `finally`.

The existing `exportScreenToPng` can remain as a compatibility wrapper, but the reusable browser
path must be factored so bundle mode does not call a function that launches Chromium per image.

## Port selection

`startWebServer()` should accept `port?: number`. If omitted, it asks the OS for a free local port
before spawning Next. It must still return `{ url, stop }`.

Tests should cover that two servers can start concurrently without both trying port `3100`.

## Error handling

Fail fast before rendering when:

- project JSON is invalid,
- filters match no screens,
- a screen's artboard aspect ratio cannot scale to its lead target,
- `store-specs.json` lacks a lead target for a schema-supported device.

If rendering one PNG fails, stop the run and surface the screen id plus target id in the error.
Partial files may exist in `export/`; no cleanup is attempted in this slice.

## Verification

- `pnpm test` covers:
  - lead size selection,
  - bundle screen filtering,
  - output path generation,
  - zip entries,
  - exact dimensions and no-alpha post-processing,
  - free-port server behavior.
- `pnpm typecheck` covers the widened `Screen` union through the new export helpers.
- `pnpm lint` covers the new CLI/core files.
- `pnpm test:e2e` stays green and should include one bundle-export path if runtime cost is
  acceptable; otherwise keep the full bundle render as a focused CLI integration test.
