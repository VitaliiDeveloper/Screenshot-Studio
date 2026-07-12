# Phase 5 Slice 1 — Project agent guide scaffold

## Goal

Make a newly initialized screenshots project immediately understandable to a CLI agent by creating
the promised project-local instruction files and concrete copy/layout/translation recipes.

## Contract

- Keep the guide template beside the CLI implementation as one canonical source.
- `screenshots init` writes `AGENTS.md` and a minimal `CLAUDE.md` forwarding file beside the project.
- Preflight `app-store-screenshots.json`, `AGENTS.md`, and `CLAUDE.md`; overwrite none of them.
- Recipes operate on the shipped CLI and strict v1 literals only. They introduce no AI SDK, schema
  field, render behavior, or persistent workflow state.

## Files

- Add `packages/cli/src/project-agent-guide.md`.
- Modify `packages/cli/src/init.ts`.
- Add `packages/cli/src/init.test.ts`.
- Update `docs/architecture.md`, `docs/roadmap.md`, `README.md`, and root `AGENTS.md` only to describe
  behavior that ships in this slice.

## Verification

1. `pnpm exec vitest run packages/cli/src/init.test.ts`
2. `pnpm test:cli`
3. `pnpm --filter @screenshot-studio/cli typecheck`

No browser or render/export gate is required: the slice changes initialization and instruction files,
not project parsing, pixels, editor interaction, or export behavior.
