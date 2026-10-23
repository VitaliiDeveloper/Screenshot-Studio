# RULES.md — Agent & Contributor Collaboration Rules

[AGENTS.md](AGENTS.md) routes agents to the sources relevant to the active task. Keep this file
focused on repository workflow; product and architecture contracts belong in their routed sources
of truth.

## Decision making

- Challenge assumptions and surface material constraints or trade-offs before acting.
- Keep review requests read-only. For diagnosis, identify and explain the cause; implement a fix only
  when the request includes a change.
- For implementation, make the smallest maintainable change that satisfies the request. Do not pull
  unrelated cleanup or speculative future work into scope.
- Do not invoke optional workflows, sub-agents, browser tools, or broad verification unless the task
  requires them. Ask only when a missing decision makes a reasonable choice risky.
- Comments should state durable intent, invariants, or non-obvious constraints. Keep temporary
  measurements and one-off verification evidence out of source comments.

## Context and token economy

- Use the smallest sufficient investigation and verification unless the task explicitly requires an
  exhaustive analysis.
- Limit command output to 1,500 tokens by default. Expand only the exact missing fragment; never dump
  full passing logs, traces, lockfiles, broad diffs, repository-wide listings, or unchanged status.
- Prefer native wait or monitoring mechanisms over repeated CI and long-running-job polling. Report
  only state changes or actionable failures.
- Start with exact files and exact tests. Expand the scope only when concrete evidence requires it.
- After two unproductive diagnostic attempts, reassess the evidence and hypothesis before running
  more tools.
- Once a failure is confirmed to be local-environment-only and authoritative CI covers the behavior,
  do not repair unrelated local tooling unless the task requires it.
- Stop when the requested acceptance criteria are satisfied. Avoid opportunistic cleanup and keep
  progress updates and final responses concise.

## Agent planning artifacts

- Superpowers specs and implementation plans are local execution artifacts. Keep them under the tool
  defaults `docs/superpowers/specs/` and `docs/superpowers/plans/`.
- Do not create tracked `docs/specs/` or `docs/plans/`. Never stage or commit execution-only agent
  artifacts; `docs/superpowers/` and `.superpowers/` are ignored.
- Add durable architecture, product contracts, or retained evidence to tracked documentation only
  when the task explicitly requires it.

## Git workflow

- Use `prefix: concise description` with `feat`, `fix`, `refactor`, `chore`, `test`, `docs`, `style`,
  `perf`, or `build`.
- Use imperative English, no trailing period or attribution trailers, and split unrelated changes.
- Resolve the base from the explicit task and live local/remote topology. Never invent a conventional
  branch such as `dev` when it does not exist.
- Use `<agent>/<short-kebab-slug>` for agent branches. If Git has a real slash-namespace conflict,
  fall back to `<agent>-<short-kebab-slug>` and report it.
- Keep the primary checkout on `dev` so the in-repo skills and CLI run from current `dev`; never
  switch branches there. Do branch work in a git worktree: reuse the session's own worktree when it
  already runs in one (for example `.claude/worktrees/<name>`), otherwise run plain
  `git worktree add --no-track -b <agent>/<slug> .worktrees/<slug> <base>`. This is the repository's
  declared worktree preference; it needs no separate approval or Superpowers workflow.
- After the PR merges, remove its worktree with `git worktree remove` and delete the local branch.
- Target `main` only for an explicitly requested integration/release PR. PR titles follow the commit
  convention; bodies record scope, validation, and risks. Never open a PR with an empty body.
- PRs that change visible UI add a `Screenshots` section that shows each changed surface. Host the
  images outside code branches, link them pinned to a commit SHA, and never commit capture scripts.
- The repository is public and the issue tracker is private. Keep tracker ids and links out of PR
  titles, bodies, and commit messages; link the PR from the tracker issue instead. An issue id in the
  branch name is fine because it drives automatic linking.

## Verification

`docs/testing.md` owns the exact test matrix, leaf groups, and CI policy.

- Choose the lightest check that can fail for the changed behavior.
- Run exact unit/integration files first; run the affected package suite only when a behavior or
  contract changed.
- Use E2E only when the risk requires a real browser, render host, interaction, persistence path, or
  packed consumer. Prefer one exact file; generic regression confidence is not a reason to run E2E.
- Never run the full `pnpm test:e2e` suite locally. GitHub CI owns it for the `dev` to `main`
  integration PR. If that gate fails, reproduce only the failing file locally and let CI rerun the
  complete gate.
- Run cross-browser, package, skill, and example checks only for that surface or authorized release
  readiness. A missing test script is a failure, not a pass.
- Bug fixes with a practical seam get a targeted regression test. Render/export changes require an
  exact-dimension or visual-diff check as appropriate.
- Docs-only changes may skip runtime tests; report exactly what was and was not verified. Surface all
  failures instead of hiding them.

## Stop conditions

Stop and request direction when the safe solution requires broader authorization, materially changes
the requested scope, weakens the strict schema, or risks render/export parity, security, or data loss.
