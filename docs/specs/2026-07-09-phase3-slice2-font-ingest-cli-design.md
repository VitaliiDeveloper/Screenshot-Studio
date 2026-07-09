# Phase 3 Slice 2 — Font ingest CLI

## Goal

Make every font used by an export an explicit, file-backed project asset. The CLI is the
only network boundary: it copies a supplied font or materializes a Google Font once under
`assets/fonts/`; render and export remain offline and use the Slice 1 asset route.

## Commands

```
screenshots font add <file> --family <family> [--weight <100..900>]
screenshots font add --google <family> [--weight <100..900>]
screenshots font list
screenshots font rm <family> [--weight <100..900>]
```

`weight` defaults to `400`. A `(family, weight)` pair is the font identity already enforced
by `Project`; `add` rejects an existing identity before copying or downloading bytes. The
uploaded-file command requires `--family`: parsing font-name tables is deliberately outside
this slice and would add an unreliable second source of truth.

Files are written as `assets/fonts/<slug-family>-<weight>.<original-extension>`. Supported
extensions are `.ttf`, `.otf`, `.woff`, and `.woff2`. `rm` removes the project entry and,
only when no remaining entry references it, its file under `assets/fonts/`; paths elsewhere
are never deleted.

For `--google`, the CLI requests the documented CSS2 URL for one family and exact weight,
with no browser `User-Agent`, extracts the returned font URL, downloads its bytes, and records
`source: "google"`. No URL or network dependency is persisted in the project. A CSS response
without exactly one usable font URL is rejected rather than selecting an arbitrary subset.

## Export guard

`findUnresolvedFonts(project)` lives in `core/model`: it compares every text element's
`(fontFamily, weight)` against `project.fonts`. It does not touch disk; missing files still
fail at the existing font-load readiness gate. Both CLI and UI export call it before launching
a web host or Chromium and report all missing identities together. This rejects system-font
fallbacks deterministically.

The Phase 0 starter currently contains `sans-serif`, which would violate that rule. `init`
therefore starts with an empty artboard rather than a non-portable headline. The Phase 2 export
fixture is made font-free for the same reason; the dedicated Phase 0 fixture remains the
positive custom-font parity proof.

## Out of scope

Font upload/preview/picker UI (Slice 3), font parsing and style/italic variants, browser-time
Google requests, themes, and templates.

## Verification

- Unit tests for command parsing, upload copy/list/remove, Google CSS+bytes materialization,
  duplicate protection, and unsupported extensions.
- Core tests for all unresolved text-font identities.
- CLI and UI export rejection before browser launch for an unresolved font.
- Existing Phase 0 parity e2e stays green with the file-backed Pacifico fixture.
