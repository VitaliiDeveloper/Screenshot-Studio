# AGENTS.md — Screenshot Studio

Before any task, read and apply the repository-wide workflow rules in
[`RULES.md`](RULES.md).

## Core contracts

- `app-store-screenshots.json` is the single persisted project document. The enforced strict schema
  in `packages/core/src/model/schema.ts` is the source of truth; inspect it before changing project
  fields or fixtures.
- Render/export parity is the primary invariant. The editor and CLI must use the same shared core and
  browser renderer; never introduce a second pixel-rendering path.
- Store dimensions come from `store-specs.json`, not duplicated constants.
- Schema widening requires explicit task authorization and coordinated schema, architecture,
  renderer, fixture, and parity updates. Do not invent project fields from prose or future ideas.
- Publication is separate from implementation. Follow `docs/releasing.md`; builds and green checks do
  not authorize tags, registry publication, GitHub releases, or announcements.

## Task-based reading

Read only the smallest relevant set:

| Task | Read first |
|---|---|
| Schema, renderer, export, or CLI behavior | `docs/architecture.md` and the relevant source/tests |
| Editor/UI behavior | `docs/editor.md` |
| Test selection or CI behavior | `docs/testing.md` |
| Project source, active session, catalog, or request fencing | `docs/architecture.md` and the relevant web source/tests |
| Project locking or concurrent writes | `docs/project-mutation-locking.md` |
| Asset/output publication safety | `docs/safe-file-publication.md` |
| Package or release work | `docs/releasing.md` |
| User-facing setup or documentation | `README.md` |
| Generated screenshot project | that project's `AGENTS.md` |

## Context discipline

- Read only task-relevant files and narrow ranges. Never recursively scan or print `.superpowers/`,
  `.worktrees/`, `node_modules/`, build output, lockfiles, logs, traces, or session transcripts.
- Keep command output bounded and summarize results. Prefer tracked files, exact paths, and targeted
  `rg`; do not dump repository-wide file lists or passing-test logs into context.
- Do not use sub-agents, Browser, Computer Use, live preview, or browser developer mode unless the
  user explicitly requests them or the changed behavior cannot be verified without that surface.
- Run exact tests first. Never run the full local E2E suite; use one browser file only when required
  by the changed UI/render contract. `docs/testing.md` owns the exact matrix.

## GitHub authentication boundary

- Repository setup, development, builds, and tests must not require GitHub credentials.
- Never read, copy, print, modify, or request credential files, access tokens, or private keys.
- Treat sandbox or container `gh` failures as credentials unavailable in that environment, not proof
  that the contributor is logged out. Prefer an authorized GitHub connector, then a trusted host
  credential broker or a narrowly scoped elevated command.
- If authenticated access remains unavailable, report the blocker and provide the relevant GitHub
  URL for manual completion.
