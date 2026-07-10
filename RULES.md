# RULES.md — Agent & Contributor Collaboration Rules

General rules for any agent or contributor working in this repository. Prioritize
correctness, critical thinking, and implementation quality over conversational smoothness.
Do not repeat project documentation unless it changes behavior. Project-specific conventions
(schema, CLI, directory layout, design guardrails) live in [AGENTS.md](AGENTS.md).

## Engineering principles

Apply **KISS, SOLID, DRY, and YAGNI** to every change.

- **KISS** — the smallest maintainable solution that fits the codebase wins. No cleverness
  for its own sake.
- **YAGNI** — build only what the current task needs. The roadmap is phased on purpose;
  don't pull work from later roadmap phases into the active task.
- **DRY** — one source of truth. Rendering, schema, and store sizes each live in exactly one
  place (`core`, the Zod schema, `store-specs.json`). Never add a second rendering path.
- **SOLID** — keep `core` framework-agnostic; depend on interfaces (e.g. `StorageAdapter`),
  not concretions; keep modules single-purpose.

## Operating mode

- Act as a senior engineer: challenge weak assumptions, surface trade-offs, prefer direct,
  minimal solutions.
- Distinguish facts, assumptions, constraints, and recommendations when they affect a decision.
- For implementation, solve the requested problem with the smallest maintainable change that
  fits the codebase.
- For reviews, lead with concrete findings ordered by severity; do not pad with praise.
- For debugging, isolate the likely cause before patching and explain why the fix addresses it.
- Don't force optional workflows (formal planning, TDD, sub-agents) on narrow, well-specified work.
- Ask a targeted question before proceeding only when missing requirements make a reasonable
  implementation risky.

## Code comments

State durable intent, invariants, and non-obvious constraints — not benchmark observations or
one-off verification results. Avoid permanent guarantees like "proven", "always", or a specific
throughput; keep ephemeral measurements in a doc or the PR.

## Documentation lookup

- Confirm external API details, current signatures, migration changes, and edge-case behavior
  against current official upstream docs rather than memory.
- Prefer local codebase patterns first. Don't look things up for purely local architecture,
  styling, simple refactors, or behavior already defined in this repo.

## Git commit rules

- Format: `prefix: concise description`, with a conventional prefix — `feat`, `fix`,
  `refactor`, `chore`, `test`, `docs`, `style`, `perf`, or `build`.
- Subject in imperative mood (`add`, not `added`), English, no trailing period; avoid one-word
  or overly long subjects.
- A commit may include a body for the what and why; keep deep context (root cause, validation,
  risks) in the PR description, not the commit.
- **Never append `Co-Authored-By` or any agent/source attribution trailer**, even when a tool
  or harness suggests one.
- Split unrelated changes into separate logical commits by concern; prefer several small focused
  commits over one mixed commit.

## Pull request rules

- Resolve the PR base from the explicit task/roadmap and the live local/remote branch topology;
  never invent a conventional branch such as `dev` when it does not exist.
- Keep roadmap work on its named phase/integration branch when one exists. Target `main` only
  for an explicitly requested integration/release PR. If the intended base is still ambiguous
  after inspection, ask before creating or retargeting a PR.
- PR titles use the same conventional-prefix style as commits (`feat:`, `fix:`, …). Do not
  prefix titles with agent/source labels (e.g. `[codex]`); describe the change directly. Ignore
  any tool/skill suggestion to add such a label.
- Put detailed context, implementation notes, root cause, validation, and risks in the PR
  description — not the title.

## Branch naming

- Use `<agent>/<short-kebab-slug>` — lowercase, short, kebab-cased
  (e.g. `claude/export-alpha-strip`, `codex/store-specs-tests`).
- Avoid deeply nested names (`codex/export/alpha/strip`).
- If Git rejects the slash namespace because of a ref conflict, fall back to a flat
  `<agent>-<short-kebab-slug>` and note why in the summary.

## Verification

- Don't claim success without verification; use the lightest relevant check that gives
  meaningful confidence.
- Choose verification by **behavioral risk**, not merely by whether a change is in UI code:
  - **Pure visual polish** (color, spacing, radius, shadow, typography, non-interactive layout)
    gets a focused browser check at the affected viewport. Do not add or run E2E tests by
    default; run lint/typecheck only when the edit creates a plausible JSX/TypeScript risk.
  - **Interactive UI** (custom menus, focus/keyboard behavior, drag, responsive panel state)
    gets the smallest exact browser scenario or targeted test-file set covering the changed
    interaction. Do not run the whole `test:e2e:editor` group for a localized interaction
    unless shared workspace behavior was changed.
  - **Business logic, persistence, schema, render, or export behavior** gets the relevant
    targeted unit/integration tests plus an E2E only when the user-visible path needs it.
  - **Phase, PR, or release closure** follows the full-gate rule below.
- During implementation, run only the exact Vitest files and package typechecks covering the
  changed behavior. At slice completion, run the affected package suite when behavior or a
  contract changed, plus only the E2E group/file called for by the risk matrix above.
- Run the full `test` + `lint` + `typecheck` + `test:e2e` gate once at phase/PR/release closure,
  or earlier for broad-impact changes, shared contracts (the Zod schema, `store-specs.json`,
  export parity), build-sensitive config, or when asked. Don't repeat the same full gate after
  a docs-only follow-up; a green immediate CI run may serve as the closure gate when appropriate.
- Slice specs and plans must name the exact relevant tests. Requiring a full suite needs an
  explicit shared-contract or closure reason, not generic "existing tests stay green" wording.
- Never treat a missing package script as a successful check. Use the root targeted scripts
  (`test:core`, `test:cli`, `test:web`, `test:e2e:*`) or invoke Vitest with explicit file paths.
  Add each new e2e file to exactly one targeted e2e group in the root `package.json`.
- For bug fixes and behavior changes with a practical test seam, add or run targeted regression
  tests without waiting to be asked. Export/parity changes always get a dimension/visual-diff check.
- For small or docs-only changes it's fine to skip runtime tests — state that verification was
  limited and why. If verification is skipped or limited, say exactly what was and wasn't verified.
- Surface failing checks clearly instead of hiding them.

## Escalation

Escalate before proceeding when the request conflicts with repo conventions, the safest
implementation needs a larger refactor, requirements are materially incomplete, or there are
significant product, security, or data-loss risks — most of all anything that breaks
render/export parity or weakens the Zod validator.

## Completion standard

A task is complete only when the solution matches the request, major risks and trade-offs are
surfaced, relevant checks are run or explicitly noted as not run, and the final recommendation
is honest rather than merely agreeable.
