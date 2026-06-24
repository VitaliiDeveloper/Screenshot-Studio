# AGENTS.md — Screenshot Studio

Instructions for any CLI agent (Claude Code, Cursor, etc.) working inside this repo.
This file is the management interface: the conventions, schema, CLI, and guardrails an
agent needs to generate copy, lay out slides, and translate locales — no skill required.

> **Status: planning.** The code is not built yet; the contracts below are the target.
> Read `docs/` for the full rationale before generating anything. When in doubt, follow
> `docs/architecture.md` (the technical contract) — it wins over this summary.

## What this project is

A code-first, open-source editor for App Store and Google Play marketing screenshots.
A Konva canvas with screens, elements, fonts, and themes, exporting pixel-correct PNGs to
exact store sizes — driven by the same `core` from both a web UI and a CLI. The source of
truth is a single git-trackable JSON file (`app-store-screenshots.json`).

- Stack: Next.js + React + TypeScript, Konva/react-konva, Tailwind + shadcn/ui, Zustand +
  Immer, Zod (schema + validation), Playwright (headless export), Vitest. Node.js 20+.
- Monorepo: `packages/core` (model · engine · export · fonts · storage), `packages/ui`,
  `packages/cli`, `apps/web`.
- **Render/export parity is the #1 rule:** one JSON must render identically in UI and CLI.
  The CLI delegates pixel rendering to the web renderer in a headless browser — never add a
  second rendering path. See `docs/architecture.md` §2.

## Repo conventions (the "API")

A screenshots project follows this layout:

```
my-app-screenshots/
├── app-store-screenshots.json     # source of truth (the project)
├── AGENTS.md / CLAUDE.md          # this file
├── screenshots/                   # source captures
│   ├── apple/{iphone,ipad}/{locale}/NN.png
│   └── android/{phone,tablet-7,tablet-10,feature-graphic}/{locale}/NN.png
├── assets/                        # fonts (.ttf/.otf/.woff2), icons, decor
├── themes/                        # theme tokens
├── templates/                     # reusable layouts
└── export/                        # CLI writes finished bundles here (gitignored)
```

## Project JSON schema (validated by Zod — never write an invalid one)

```
Project
├── meta: { name, appIcon, schemaVersion }
├── platforms: ["apple", "android"]
├── locales: ["en", "de", "ar"]            # ar → RTL
├── themes: Theme[]                        # tokens: colors, fonts, spacing
├── fonts: FontAsset[]                     # system / google / uploaded(base64)
└── screens: Screen[]
    ├── id, name, platform, device, locale
    ├── artboard: { width, height }
    ├── background: solid | gradient | image
    └── elements: Element[]                # z-order = array order
```

Element base: `id, type, x, y, width, height, rotation, opacity, locked, visible`.
Types: `text`, `screenshot`, `device-frame`, `shape`, `icon`, `badge`, `image`.
MVP elements: `text`, `screenshot`, `device-frame`, `shape`. Artboards are **isolated**
(no connected canvas in the MVP). Schema is versioned; pure `v1→v2→…` migrations run on load.

## CLI (`screenshots ...`) — the primary interface

| Command | Action |
|---------|--------|
| `init` | Scaffold the project and standard directories |
| `dev` | Run the canvas editor (dev server) |
| `screen add / list / rm / reorder` | Manage screens |
| `font add <file>` | Register a custom font |
| `theme set <id>` | Apply a theme to all screens |
| `import <dir>` | Ingest raw captures by directory convention |
| `export [--platform --device --locale]` | Exact PNG bundles (same result as the UI button) |

Export sizes live in `store-specs.json` (data, not hardcode), with Vitest dimension tests.
Strip the alpha channel on export — stores require no transparency. See architecture §4.

## Design guardrails (always apply when generating slides/copy)

- Screenshots are ads, not documentation.
- Each slide sells one clear user outcome.
- The headline passes the one-second thumbnail test.
- Adjacent slides vary layout and device placement.
- Cross-screen (connected) elements never split required text or critical UI.
- Every exported crop works as a standalone screenshot.

---

# Agent collaboration rules

General rules for any agent contributing to this repository. Prioritize correctness,
critical thinking, and implementation quality over conversational smoothness. Do not repeat
project documentation unless it changes agent behavior.

## Engineering principles

Apply **KISS, SOLID, DRY, and YAGNI** to every change.

- **KISS** — the smallest maintainable solution that fits the codebase wins. No cleverness
  for its own sake.
- **YAGNI** — build only what the current task needs. The roadmap is phased on purpose;
  don't pull future phases forward (no connected canvas, AI, themes, etc. in the MVP).
- **DRY** — one source of truth. Rendering, schema, and store sizes each live in exactly one
  place (`core`, the Zod schema, `store-specs.json`). Never add a second rendering path.
- **SOLID** — keep `core` framework-agnostic; depend on interfaces (e.g. `StorageAdapter`),
  not concretions; keep modules single-purpose (`model` / `engine` / `export` / `fonts` /
  `storage`).

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
  against current upstream docs rather than memory (Context7 is available for this when using
  Claude Code).
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

- Open `feat` / `fix` / `refactor` / `chore` PRs against **`dev`** by default. Never open normal
  work PRs directly against `main`.
- Update `main` only from `dev`, via a `dev → main` PR/merge. If a change lands on `main` by
  accident, align `dev` with it before continuing.
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
- Scope verification to the changed behavior — run only the Vitest tests / build steps covering
  the affected package or risk area. Don't run the full suite by default; reserve that for
  broad-impact changes, shared contracts (the Zod schema, `store-specs.json`, export parity),
  build-sensitive config, or when asked.
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
