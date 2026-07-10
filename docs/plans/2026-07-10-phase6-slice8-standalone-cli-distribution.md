# Phase 6 Slice 8 — Standalone CLI distribution

Status: complete. Production assembly, explicit package contents, offline temp install, installed
management commands, packaged-host export, and affected export regressions have passed.

## Goal

Install and run `screenshots` outside the monorepo while preserving the exact shared Next/browser
renderer for editor and export.

## Ratified package layout

The npm artifact is one `@screenshot-studio/cli` package:

```text
@screenshot-studio/cli/
├── dist/index.js                 # executable Node 22 ESM bundle (CLI + core)
├── dist/project-agent-guide.md   # init runtime input
├── runtime/store-specs.json      # default export targets
├── runtime/web.zip               # Next output:standalone host + static assets
├── package.json                  # bin + playwright/sharp runtime dependencies only
├── README.md
└── LICENSE
```

- Esbuild bundles authored CLI/core JavaScript and ordinary JS dependencies. Native/runtime-owned
  `playwright` and `sharp` remain normal package dependencies.
- Next production build uses `output: standalone` with the monorepo as its tracing root. The
  assembled host adds `.next/static`; no source checkout, fixture, docs tree, cache, or second
  renderer enters the package.
- The traced host is stored as `runtime/web.zip` so npm does not discard its nested `node_modules`.
  A packaged command extracts it to a unique OS temp directory, spawns `server.js` with Node, and
  removes it after stop/failure. Source commands continue spawning `next dev` from `apps/web`.
- The bin resolves store specs and the generated project guide relative to its installed package,
  not a repository root. Direct-execution detection resolves package-manager `.bin` symlinks.
- The uncompressed host archive is intentionally heavy because render parity wins over a second
  lightweight renderer. Pack size is measured and reported, not hidden.

## Verification

1. CLI/server suite — 17 files / 82 tests passed.
2. `pnpm test:e2e:package` passed the production Next build and deterministic package assembly.
3. Pack manifest is exactly 8 runtime/license files; no source, fixture, cache, or development docs.
4. Offline temp install outside the checkout passed.
5. Installed bin `init`, project validation, `screen list`, and exact 1320×2868 PNG export through
   the extracted packaged host passed (2 package E2E scenarios total).
6. Affected export E2E group — 3 files / 3 tests passed.
7. The local npm tarball is about 41 MiB (138 MiB uncompressed host archive).
8. `pnpm lint`, `pnpm typecheck`, and `git diff --check` passed.
