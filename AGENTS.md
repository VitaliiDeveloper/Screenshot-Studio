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

## Sources of truth

- `docs/architecture.md` — durable technical contracts for data, rendering, persistence, and tools.
- `docs/editor.md` — UI/UX semantics, shared components/tokens, and accessible interaction patterns.
- `docs/testing.md` — test ownership, cost rules, and CI policy.
- `README.md` — user-facing setup, usage, and current capabilities.
- `packages/cli/src/project-agent-guide.md` — canonical guide generated into screenshot projects for
  copy, literal layout, locale translation, and local asset processing.
- `docs/releasing.md` — candidate verification and the publication boundary.

## Task-based reading

Read only the smallest relevant set:

| Task | Read first |
|---|---|
| Schema, renderer, export, or CLI behavior | `docs/architecture.md` and the relevant source/tests |
| Editor/UI behavior | `docs/editor.md` |
| Test selection or CI behavior | `docs/testing.md` |
| Project locking or concurrent writes | `docs/project-mutation-locking.md` |
| Asset/output publication safety | `docs/safe-file-publication.md` |
| Package or release work | `docs/releasing.md` |
| User-facing setup or documentation | `README.md` |
| Generated screenshot project | that project's `AGENTS.md` |

Do not load `docs/superpowers/`, `packages/cli/package/`, or font-license texts unless the task is
specifically about execution-plan history, package/legal audit, or font licensing.

## Repository map

- `packages/core` — schema, model, rendering, export, fonts, themes, templates, assets, and storage.
- `packages/cli` — project management commands and packaged render-host orchestration.
- `apps/web` — Next.js editor, APIs, and the shared browser render target.

## Context discipline

- Open only the files and documentation relevant to the active task; do not scan all of `docs/` by
  default.
- Discover first with `rg --files`, targeted `rg`, and narrow ranges. Avoid broad output from
  lockfiles, generated logs, session transcripts, build artifacts, and `node_modules`.
- Use fresh, scoped handoffs for independent follow-up work. Give sub-agents only the minimum files
  and contracts required for independent work streams.
- Follow the behavioral-risk verification rules in `RULES.md`; exact commands and CI ownership live
  in `docs/testing.md`.

## GitHub authentication boundary

- Repository setup, development, builds, and tests must not require GitHub credentials.
- Never read, copy, print, modify, or request credential files, access tokens, or private keys.
- Treat sandbox or container `gh` failures as credentials unavailable in that environment, not proof
  that the contributor is logged out. Prefer an authorized GitHub connector, then a trusted host
  credential broker or a narrowly scoped elevated command.
- If authenticated access remains unavailable, report the blocker and provide the relevant GitHub
  URL for manual completion.
