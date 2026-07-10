# Phase 4 Slice 3 — Locale CLI Plan

**Goal:** Expose whole-locale creation, direction conversion, listing, and removal through the
primary `screenshots` CLI without duplicating core logic.

## Commands

```text
screenshots locale list
screenshots locale add <target> --from <source> [--direction ltr|rtl]
screenshots locale direction <locale> --to <ltr|rtl>
screenshots locale rm <locale>
```

`screen add` also accepts optional `--direction`; without it, core inherits an existing locale's
direction and defaults a brand-new locale to LTR.

## Tasks

- [ ] Add `locale-commands.ts` with pure action parsing/list formatting and one load/mutate/save
  host boundary over `cloneLocaleSet`, `setLocaleDirection`, and `removeLocaleSet`.
- [ ] Add focused tests for argument errors, default/source direction, RTL baking, repeat-safe
  direction changes, removal guards, fresh ids, and persisted manifests.
- [ ] Route `locale` from `index.ts` and extend `screen add` with strict direction parsing.
- [ ] Update AGENTS/README/architecture CLI truth and mark the roadmap slice only after checks pass.

## Verification

```bash
rtk pnpm exec vitest run packages/cli/src/locale-commands.test.ts packages/cli/src/screen-commands.test.ts packages/cli/src/index.test.ts
rtk pnpm test:cli
rtk proxy pnpm --filter @screenshot-studio/cli typecheck
rtk pnpm lint
rtk git diff --check
```

No browser test is needed: this slice only serializes projects through core operations whose RTL
render output passed Slice 2 parity.
