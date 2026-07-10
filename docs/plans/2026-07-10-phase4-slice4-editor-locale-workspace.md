# Phase 4 Slice 4 — Editor Locale Workspace Plan

**Goal:** Make complete locale sets first-class in the editor while keeping active locale derived
from the active screen and keeping editor chrome LTR.

## Surface

- Add an active-locale selector and locale manager to create, switch, mirror, and remove sets.
- Filter Screens and Overview to the active locale; reorder only that locale's screen slots.
- Keep inline editing direction-aware and make newly inserted text align with the active locale.
- Inherit locale direction when duplicating screens or instantiating LTR-authored templates.
- Protect the final screen of a locale from accidental deletion outside the locale manager.

## Contracts

- The project model remains the only persistent state; `activeLocale` is derived from
  `activeScreenId`.
- Locale creation and direction changes delegate to core operations and persist baked geometry.
- Template geometry is mirrored exactly once when the active locale is RTL.
- Screens and Overview preserve the locale's source/export order and never expose another set.

## Verification

```bash
rtk pnpm exec vitest run packages/core/src/templates/index.test.ts packages/core/src/model/factories.test.ts apps/web/lib/editor-store.test.ts
rtk pnpm test:web
rtk pnpm exec vitest run --config vitest.e2e.config.ts e2e/locale-workspace.test.ts e2e/editor-workspace.test.ts e2e/left-panel.test.ts e2e/template-library.test.ts
rtk pnpm test:e2e:editor
rtk pnpm typecheck
rtk pnpm lint
rtk git diff --check
```

Browser QA covers the create/switch/filter flow, inline RTL editing, locale-scoped reorder, and
desktop/mobile toolbar layout. Pixel parity remains owned by Slice 2's RTL fixture and parity test.
