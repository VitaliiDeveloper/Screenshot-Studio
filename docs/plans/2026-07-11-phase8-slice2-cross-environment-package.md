# Phase 8 Slice 2 — Cross-environment packaged install

Status: complete. The bounded matrix passed on Ubuntu, macOS, and Windows at Node 22 plus Ubuntu at
Node 24, including the newer-LTS workspace gate and the same packed install/export recovery smoke.

## Goal

Replace the Ubuntu-only package assumption with explicit proof that the built CLI installs,
initializes, manages, exports, and cleans up on Linux, macOS, and Windows at the minimum supported
Node major, while retaining newer-LTS compatibility without multiplying the full browser suite.

## Contract

1. Add one dedicated package-matrix workflow rather than expanding the ordinary full E2E job.
2. Run the same packed install/init/screen-list/exact-export/failure-recovery smoke on:
   - Ubuntu, macOS, and Windows with Node 22;
   - Ubuntu with Node 24.
3. Run workspace unit and typecheck gates only on the Ubuntu/Node 24 entry. Existing Ubuntu/Node 22
   CI remains the main full unit, lint, parity, export, and editor gate.
4. Install Chromium and Chromium Headless Shell explicitly on every matrix runner. Linux alone
   installs system dependencies.
5. Preserve arguments by launching pnpm through its Node entrypoint and only the installed Windows
   `.cmd` shim through `cmd.exe`; POSIX retains direct `execFile` execution.
6. Do not skip packaged export on Windows. Assemble `web.zip` directly from the Next standalone
   tree so pnpm directory links/junctions become portable regular archive files without creating
   privileged links in the package staging directory.
7. Trigger the matrix manually, on package-relevant `phase-8` pushes, or on package-relevant pull
   requests; docs-only phase work does not pay the matrix cost.

## Exact verification

- Local macOS package smoke: `pnpm test:e2e:package`.
- Workflow structure and repository checks: targeted ESLint, workspace typecheck, community check,
  and `git diff --check`.
- Remote matrix: all four `Package Matrix / packaged-cli` entries green on the same commit.

Remote evidence: [Package Matrix run 29130389081](https://github.com/VitaliiDeveloper/Screenshot-Studio/actions/runs/29130389081)
passed all four entries on the Slice 2 implementation. The docs-only closure amend also reruns the
matrix because its workflow path-filter consolidation changes the workflow file.

## Non-goals

Running the full browser gate on every OS/Node pair, supporting Node Current before LTS, changing
the renderer, publishing the package, pushing the branch, or adding product features.
