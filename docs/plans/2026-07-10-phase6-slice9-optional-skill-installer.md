# Phase 6 Slice 9 — Optional skill installer

Status: complete. The skill validator, packaged-CLI clean-folder smoke, no-fetch failure path,
repeat-init guard, and affected repository checks have passed.

## Goal

Ship one thin, installable Screenshot Studio skill that discovers or initializes a project through
the packaged CLI and then delegates the product contract to the generated project-local
`AGENTS.md`.

## Contract

- The skill contains no copy of the strict project schema, layout recipes, or render/export rules.
- Existing projects are never initialized again; their own `AGENTS.md` is authoritative.
- Clean projects are initialized only through the packaged `screenshots init` path.
- CLI resolution is explicit and offline-safe: `--cli`, `SCREENSHOT_STUDIO_CLI`, or `PATH`.
- Missing CLI availability fails with an actionable message and never triggers an implicit fetch.
- The skill adds no AI provider, key, hidden state, or files outside the chosen project directory.

## Verification

- [x] Validate skill metadata and structure with the official `skill-creator` validator.
- [x] Run the bootstrap script directly against the built CLI artifact.
- [x] Install the skill into a temporary Codex home, initialize a clean project, validate v2 output
  and generated guides, and prove repeat initialization is refused.
- [x] Run lint, typecheck, and the relevant CLI/package regression groups.

The standalone package itself remains an artifact, not a registry release. This slice proves the
optional discovery/bootstrap layer without making it part of the product runtime.

Verification passed: the official skill validator; 3 isolated skill E2E scenarios; 17 CLI files / 82
tests; repository lint; workspace typecheck; and `git diff --check`.
