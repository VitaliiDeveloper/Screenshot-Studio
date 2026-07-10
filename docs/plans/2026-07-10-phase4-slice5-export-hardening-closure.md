# Phase 4 Slice 5 — Export Hardening and Closure Plan

**Goal:** Make free-form locale export paths portable and containment-safe, restart screenshot
numbering for every exact platform/device/locale group, then close Phase 4 against the full gate.

## Contract

- Filtering compares the raw persisted locale exactly.
- Filesystem paths encode locale and store-size identity only at the filename/path sink; path
  punctuation, case variants, and non-Latin values cannot collide or escape the export root.
- Prefixes restart at `01` for each exact platform/device/locale tuple while entry order remains
  the project screen order.
- Bundle and explicit single-screen export share the locale and target token helpers.
- The Node writer preflights the complete batch for absolute/traversal/backslash/NUL paths and
  normalized duplicates, rejects symlinked ancestors/finals, and uses no-follow file opens before
  any file or ZIP mutation.

## Coverage

- Core unit tests cover traversal, Unicode, case/separator identity, custom size ids, exact
  filtering, portable length limits, and interleaved per-group numbering.
- CLI unit tests cover explicit filenames, writer containment, duplicate/symlink rejection, and no
  partial or external output on a failed batch.
- A committed six-screen fixture independently asserts exact filesystem and UI ZIP paths across
  interleaved locales, another device, another platform, and a traversal-shaped locale.
- Export E2E verifies exact target dimensions and no alpha channel for every entry.

## Verification

```bash
rtk pnpm exec vitest run packages/core/src/export/bundle.test.ts packages/cli/src/index.test.ts packages/cli/src/export.test.ts
rtk pnpm test:core
rtk pnpm test:cli
rtk pnpm test:e2e:export
rtk pnpm test
rtk pnpm lint
rtk proxy pnpm typecheck
rtk pnpm test:e2e
rtk git diff --check
```

The final four broad commands run once at phase closure; implementation iterations stay scoped to
bundle, CLI, and export E2E surfaces.
