# Phase 6 Slice 1 — Connected document and crop parity

Status: complete. The v2 migration, connected projection, shared crop renderer, parity/export
fixtures, contract documentation, and full shared-contract gate have passed.

## Goal

Prove the Phase 6 differentiator as a thin static vertical slice: a JSON-authored cross-screen
element renders through the existing shared browser path and contributes the correct pixels to two
exact per-screen exports. Editor authoring waits until the data and pixel contract is real.

## Contract

- Raise the enforced project contract to v2 with required project-level
  `mode: "isolated" | "connected"`.
- Keep `parseProject` / `parseProjectJson` as the migration boundary. Purely migrate v1 to v2 by
  selecting isolated mode; reject future versions and retain strict unknown-key failures.
- Define connected groups by exact `platform/device/locale` and project order.
- Keep elements in their owner screen with local coordinates. Project them into a gapless strip by
  cumulative group-screen widths; paint all group backgrounds first, then visible elements in
  screen/element order.
- Keep `renderScreen` as the one static renderer. Connected output is the requested artboard crop,
  not a stitched PNG later sliced by the CLI.
- Keep UI/CLI export orchestration, target validation, numbering, alpha stripping, zip layout, and
  browser/context reuse unchanged.
- Do not add editor mode controls, a connected authoring stage, automatic ownership changes,
  lifecycle commands, grouping, guides, or distribution work in this slice.

## Implementation steps

1. **Schema and migration seam**
   - Add `CanvasMode`, set `SCHEMA_VERSION` to 2, and require `Project.mode`.
   - Implement the pure v1→v2 migration in `packages/core/src/model/migrate.ts` without normalizing
     any other field.
   - Update typed fixtures and contract documentation that must compile with the new current model.
   - Add migration tests for pixel-preserving v1 input, already-current v2 input, malformed input,
     strict unknown keys, and unsupported future versions.
2. **Pure connected projection**
   - Add a small framework-agnostic core module for exact group keys, ordered group lookup,
     cumulative screen origins, and owner-local→strip coordinates.
   - Cover mixed platform/device/locale projects, interleaved project order, variable artboard
     widths, negative overflow, and duplicate element ids on different owner screens.
3. **Shared renderer crop**
   - Refactor `renderScreen` so isolated behavior remains byte/pixel-equivalent at the logical
     stage level.
   - In connected mode, translate the requested group by the negative target-screen origin, draw
     every group background first, then draw visible owner elements with their strip offsets.
   - Keep the returned stage width/height equal to the requested artboard so `toDataURL` is the
     precise crop used by both UI and CLI.
4. **Parity fixture and export evidence**
   - Add a two-screen connected fixture with one obvious cross-boundary shape or image and distinct
     screen backgrounds. Include an unrelated locale/device screen to prove group isolation.
   - Add a dedicated connected-canvas parity E2E that compares headed/headless output and asserts
     pixels on both sides of the boundary.
   - Add a connected bundle export scenario that asserts exact PNG dimensions, no alpha, expected
     cross-boundary pixels, stable group numbering, and no contribution from unrelated groups.
   - Register each new E2E file in exactly one root targeted group.
5. **Contract truth**
   - Update `docs/architecture.md`, `AGENTS.md`, the generated project agent guide, README schema
     wording, and the Phase 6 roadmap only for behavior that now ships.
   - Keep future editor/distribution wording clearly marked as unimplemented.

## Primary files

- `packages/core/src/model/schema.ts`
- `packages/core/src/model/migrate.ts`
- `packages/core/src/model/index.ts`
- new `packages/core/src/model/connected-canvas.ts`
- `packages/core/src/engine/render.ts`
- focused model/geometry tests beside those modules
- a new connected fixture under `fixtures/`
- new connected parity/export E2E files plus root `package.json` targeted-group registration
- contract docs named in Step 5

## Verification

During implementation:

1. `pnpm exec vitest run packages/core/src/model/schema.test.ts packages/core/src/model/migrate.test.ts packages/core/src/model/connected-canvas.test.ts`
2. `pnpm test:core`
3. `pnpm --filter @screenshot-studio/core typecheck`
4. `pnpm exec vitest run --config vitest.e2e.config.ts e2e/connected-canvas-parity.test.ts`
5. `pnpm exec vitest run --config vitest.e2e.config.ts e2e/connected-canvas-export.test.ts`

Slice completion additionally runs:

6. `pnpm test`
7. `pnpm lint`
8. `pnpm typecheck`
9. `pnpm test:e2e`
10. `git diff --check`

The full gate is required here, earlier than ordinary slice closure, because this slice changes both
the strict Zod project contract and the renderer/export parity boundary shared by every package.

## Exit criteria

- Existing v1 projects load as v2 isolated projects with unchanged visible/exported pixels.
- A connected element owned by Screen A appears in exact crops for Screen A and adjacent Screen B.
- Screens outside the target platform/device/locale group contribute no background or element
  pixels.
- UI and CLI continue to use the same `renderScreen` path and return exact, alpha-free targets.
- No connected editor authoring behavior is claimed yet.
