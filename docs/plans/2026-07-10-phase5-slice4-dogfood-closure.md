# Phase 5 Slice 4 — Dogfood and closure

## Goal

Prove the generated agent workflow and both local asset commands through the real CLI entry point,
align every public status surface, and close Phase 5 with the repository's full gate.

## Dogfood evidence

Use a newly initialized temporary project rather than the autosaving committed fixture:

1. Run `pnpm screenshots init` and confirm the generated `AGENTS.md` / `CLAUDE.md` exist.
2. Copy a committed PNG into the project's `assets/icons/` directory.
3. Run `asset auto-crop` and `asset remove-background` through `pnpm screenshots`.
4. Confirm both printed paths exist under `assets/processed/` and `screen list` still parses the
   unchanged project.
5. Confirm the generated guide contains both exact asset command recipes.

## Documentation closure

- Mark all four Phase 5 slices complete in `docs/roadmap.md` only after the full gate passes.
- Mark Phase 5 complete in `AGENTS.md` and `README.md` and identify Phase 6 as next.
- Keep `docs/architecture.md` and the Phase 5 design spec truthful about deterministic
  flat-background removal versus semantic segmentation.

## Full gate

Run once after implementation and dogfood:

1. `pnpm test`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm test:e2e`

After docs-only completion markers, run `git diff --check` and inspect the final status/diff; do not
repeat the full gate unless code changes.
