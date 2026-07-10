# Phase 4 Slice 2 — RTL Direction and Render Parity Plan

**Goal:** Persist an explicit screen direction, bake reversible RTL placement into project JSON,
and feed the same bidi direction to editor and headless Konva rendering.

**Architecture:** `Screen.direction` is an additive `ltr | rtl` field with an LTR default. Physical
coordinates/alignment stay literal; `elementToNodeConfig` receives a small render context and only
maps direction into Konva text. No render-time geometry mirroring or locale inference is allowed.

## Task 1: Schema and creation contract

- [ ] Add failing tests for the LTR default, explicit RTL, invalid values, and one direction per
  locale set.
- [ ] Add `LayoutDirection`, `Screen.direction`, and optional direction input to screen creation.
- [ ] Update typed screen constructors/fixtures with explicit LTR where TypeScript requires it.

## Task 2: Baked direction conversion

- [ ] Add failing project-op tests for `x' = artboard.width - x - width`, left/right alignment
  swap, center stability, unchanged media/content/y/dimensions/rotation, reversibility, and repeat
  idempotence.
- [ ] Implement pure screen/locale direction helpers and extend locale cloning with an optional
  target direction.

## Task 3: Shared renderer and inline editor

- [ ] Add failing node-config assertions that LTR/RTL reach Konva while physical alignment remains
  unchanged.
- [ ] Replace the mapper's positional image argument with `{ images?, direction? }` render context.
- [ ] Pass the screen direction from `renderScreen` and `EditorStage`; apply `dir` to the inline
  textarea without adding another store subscription.

## Task 4: RTL parity fixture

- [ ] Materialize one OFL-licensed, Arabic-capable font as a project file; render/export must stay
  offline.
- [ ] Add an RTL parity scenario containing Arabic text, punctuation, and numerals and register its
  test file only in `test:e2e:parity`.
- [ ] Assert UI/headless visual parity, exact dimensions/no alpha where exported, and that explicit
  RTL differs from the same LTR base direction.

## Verification

```bash
rtk pnpm exec vitest run packages/core/src/model/schema.test.ts packages/core/src/model/project-ops.test.ts packages/core/src/engine/node-config.test.ts
rtk pnpm test:core
rtk proxy pnpm --filter @screenshot-studio/core typecheck
rtk proxy pnpm --filter @screenshot-studio/web typecheck
rtk pnpm test:e2e:parity
rtk git diff --check
```

Because this slice widens the strict schema and shared render contract, parity is mandatory even
though the editor management UI does not land until Slice 4.
