# Release readiness evidence

Status: Phase 8 in progress. Slices 1–3 are complete; Slice 4 accessibility and browser coverage is
next. This ledger is evidence for a future go/no-go decision, not a public-release claim.

## Baseline entering Phase 8

Phase 7 closed on commit `e725c8c` with:

- 53 unit files / 370 tests;
- 33 E2E files / 54 tests;
- root lint and workspace typecheck;
- exact alpha-free exports, living v5 examples, connected LTR/RTL keyboard dogfood, package install,
  optional-skill bootstrap, community assertions, SPDX assertions, and `git diff --check`.

The closure was broad but single-environment. Phase 8 does not treat it as cross-OS, sustained-run,
performance, automated-accessibility, current-store-rule, or release-artifact evidence.

## Slice 1 — Failure and recovery hardening

Tested environment on 11 July 2026:

- branch: `phase-8`;
- system: Darwin 25.5.0 arm64;
- Node.js: 24.16.0;
- pnpm: 11.10.0.

Implemented contract:

- bundle PNGs and ZIP are fully staged before generated destinations change;
- staging/write failure leaves prior outputs untouched and removes staging;
- publication failure restores replaced generated files, removes newly published generated files,
  preserves unrelated output files, and removes staging;
- a render failure occurs before publication and preserves prior output;
- page, context, and browser cleanup retain the primary failure and still attempt later cleanup;
- render-host readiness fails promptly on unexpected child exit, later unexpected exit is observable,
  and explicit stop is idempotent;
- source single/bundle export races work against unexpected host exit and closes all acquired runtime
  resources without allowing one cleanup failure to skip another;
- the packed CLI proves a real missing-font render failure, byte-for-byte preservation of the prior
  exact PNG, extracted-host cleanup, project repair, and successful deterministic retry.

Verification:

1. `pnpm test:cli` — 17 files / 90 tests passed.
2. Targeted ESLint over the seven changed CLI source/test files passed.
3. `pnpm typecheck` — core, CLI, and web passed.
4. `pnpm test:e2e:package` — 2 tests passed, including the new packaged failure/recovery path.
5. `git diff --check` passed.

Environment note: the package E2E needed the Playwright/Sharp runtime tarballs cached for its
intentional offline consumer install. Its first sandboxed render attempt then failed with
`listen EPERM` on `127.0.0.1`; the same test passed outside the network-listen sandbox. These were
test-environment prerequisites, not product failures.

## Slice 2 — Cross-environment packaged install

Implemented:

- a dedicated four-entry package matrix for Ubuntu/macOS/Windows on Node 22 plus Ubuntu on Node 24;
- package-relevant pull-request and explicit manual triggers, without multiplying the ordinary full
  browser gate across every environment;
- explicit Chromium and Chromium Headless Shell installation on every runner, with Linux-only
  system dependency installation;
- workspace unit/typecheck coverage on the Ubuntu/Node 24 compatibility entry;
- portable ZIP assembly with a trusted internal link manifest that restores POSIX directory
  symlinks or unprivileged Windows junctions and copies file-link targets;
- argument-preserving Windows execution through pnpm's Node entrypoint and `cmd.exe` only for the
  installed `.cmd` shim, while POSIX retains direct execution.

Local evidence on Darwin 25.5.0 arm64 / Node 24.16.0:

1. `pnpm test:e2e:package` — 2 tests passed, including exact export and failure/recovery.
2. Workspace typecheck passed for core, CLI, and web.
3. Targeted ESLint for the changed package harness passed.
4. The package-link archive unit regression passed.
5. The package-matrix workflow parsed as YAML, community assertions passed, and
   `git diff --check` passed.

Remote evidence:

- [Package Matrix run 29130389081](https://github.com/VitaliiDeveloper/Screenshot-Studio/actions/runs/29130389081)
  passed the same packed install/init/manage/exact-export/failure-recovery smoke on Ubuntu, macOS,
  and Windows with Node 22, plus Ubuntu with Node 24. The Node 24 entry also passed workspace unit
  and typecheck gates. The final docs-only closure amend reruns the matrix through its workflow-file
  change so the final checkpoint SHA retains remote evidence.

## Slice 3 — Export soak and performance budgets

Environment on 11 July 2026: Darwin 25.5.0 arm64, Node 24.16.0, Apple M3 Pro with 12 logical CPUs
and 18,432 MiB memory. The opt-in harness built and installed the package once, then used fresh
packed CLI processes for every sample.

Ratified limits and verify results:

- 12-screen/four-locale living-v5 large bundle: median wall budget 10,500 ms and peak aggregate
  process-tree RSS budget 1350 MiB; verify median 8319 ms and peak 1116.4 MiB;
- repeated three-screen living-v5 bundle: median wall budget 4200 ms and peak aggregate process-tree
  RSS budget 1200 MiB; verify median 3177 ms and peak 982.5 MiB;
- five baseline and five verify samples per harness produced stable per-file/ZIP SHA-256 manifests,
  exact 1320×2868 opaque PNGs, zero leaked staging or packaged-host temp directories, zero failed
  child exits, and no material monotonic RSS growth.

The first fresh-build soak exposed an unstable flattened-pnpm-link assumption (`styled-jsx` could
not resolve from the flattened Next package). The final trusted link manifest preserves standalone
realpath topology using POSIX symlinks or Windows junctions for directories and regular copies for
file links. Targeted archive/extraction security tests, the 17-file/93-test CLI suite, workspace
typecheck, and packaged CLI E2E all passed after the correction. The ordinary per-change CI remains
free of soak cost; Slice 7 reruns the opt-in budget gate and the current package matrix.

## Remaining release blockers

- Slice 4: automated accessibility states and representative Chromium/Firefox/WebKit editor smoke.
- Slice 5: dated current store-rule and production package/dependency/license audit.
- Slice 6: candidate version/artifact and release-candidate documentation.
- Slice 7: sustained dogfood, full closure gates, and explicit go/no-go.
- Final remote package-matrix revalidation is required after the current local Slice 3 package-host
  changes are pushed; no push is performed without explicit owner authorization.
