# Release readiness evidence

Status: Phase 8 in progress. Slices 1–2 are complete; Slice 3 export soak and performance budgets
are next. This ledger is evidence for a future go/no-go decision, not a public-release claim.

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
- direct portable ZIP assembly that follows pnpm directory links/junctions without reproducing
  privileged links in staging;
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

## Remaining release blockers

- Slice 3: large/repeated export soak plus ratified wall-time/RSS budgets.
- Slice 4: automated accessibility states and representative Chromium/Firefox/WebKit editor smoke.
- Slice 5: dated current store-rule and production package/dependency/license audit.
- Slice 6: candidate version/artifact and release-candidate documentation.
- Slice 7: sustained dogfood, full closure gates, and explicit go/no-go.
