# Phase 5 Slice 2 — Deterministic auto-crop CLI

## Goal

Add an explicit local command that trims a project-local image to its visible/content bounds and
writes a new collision-safe PNG without mutating the source or project JSON.

## Contract

- `screenshots asset auto-crop <file> [--threshold 0..255] --project <json>` resolves relative
  sources from the project root.
- The project and real source path must remain inside the project root, including through symlinks.
- Sharp decodes/encodes RGBA while the shared edge-connected mask computes deterministic
  top-left-background bounds, including images smaller than 3×3.
- Output is `assets/processed/<safe-stem>-auto-crop[-N].png`; existing files are never overwritten.
- The command prints the project-relative output path and dimensions. It never edits element URLs.

## Files

- Add `packages/cli/src/asset-service.ts` and `packages/cli/src/asset-commands.ts`.
- Add `packages/cli/src/asset-service.test.ts` and `packages/cli/src/asset-commands.test.ts`.
- Modify `packages/cli/src/index.ts` and the CLI dependency manifest.
- Update agent/user documentation only after the command is verified.

## Verification

1. `pnpm exec vitest run packages/cli/src/asset-service.test.ts packages/cli/src/asset-commands.test.ts`
2. `pnpm test:cli`
3. `pnpm --filter @screenshot-studio/cli typecheck`
