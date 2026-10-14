# AGENTS.md — Connected Launch example

This directory is a living Screenshot Studio example. Keep it self-contained, editable, and valid
against the repository's current strict v1 schema. The root [`AGENTS.md`](../../AGENTS.md),
[`RULES.md`](../../RULES.md), and [`docs/testing.md`](../../docs/testing.md) also apply.

## Project contract

- `app-store-screenshots.json` is the only persisted project document. Unknown fields fail schema
  validation; do not widen the schema from this example.
- Preserve stable layout, screen, and element ids unless the example is intentionally demonstrating
  a new object. Array order owns layout order, screen order, and element z-order.
- Asset and font paths stay project-relative. Do not add remote URLs, absolute paths, or system-font
  dependencies.
- Every text font identity must match a file registered in `fonts`. Keep required copy and media
  useful inside each exported artboard even though this project uses connected mode.
- Destination (`platform`), device family (`device`), exact export target, and visual device-frame
  preset are separate concepts. A frame element must not determine or imply the screen's output.

## Device-frame presets

The current strict ids are:

<!-- DEVICE_FRAME_IDS:START -->
```text
iphone
android-phone
tablet
desktop
laptop
browser
tv
watch
phone-modern-dark
phone-modern-light
phone-punch-hole-dark
phone-outline
frameless-phone
tablet-rounded-dark
tablet-rounded-light
tablet-outline
frameless-tablet
browser-light
browser-dark
browser-minimal
frameless-browser
laptop-silver
laptop-dark
display-stand
display-minimal
tv-flat
watch-rounded
watch-square
frameless-watch
foldable
automotive-display
xr-viewport
```
<!-- DEVICE_FRAME_IDS:END -->

The first eight ids are retained for backward compatibility. All bundled presets use brand-neutral
renderer-owned vector geometry; official Apple artwork and other vendor frame assets are not bundled.
Only the preset id is persisted, and changing it affects visual treatment rather than export size.

## Verification

From the repository root, run the exact living-example owner after changing this project:

```bash
pnpm test:e2e:examples
```

That check parses the current schema and exports an exact opaque PNG through the shared browser
renderer. Do not run the full local E2E suite for an example-only change.
