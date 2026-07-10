# Phase 8 Slice 3 — Export soak and performance budgets

Status: complete. Five controlled baseline samples ratified the material-regression budgets, and a
second five-sample verify run passed every correctness, cleanup, determinism, time, and RSS gate.

## Goal

Prove that the packed CLI can sustain a representative large bundle and repeated living-project
exports without nondeterministic output, leaked packaged hosts, failed process cleanup, or material
wall-time/RSS regression.

## Harnesses

1. `pnpm soak:export -- --baseline` builds the package once and runs both opt-in harnesses outside
   ordinary unit CI.
2. The large-bundle harness expands the living connected v5 example to four locale groups and 12
   screens while retaining current text, shape, screenshot, device-frame, image, icon, and group
   surfaces. Each sample exports all entries through one packed CLI process.
3. The repeat harness exports the ordinary three-screen living connected v5 example in five fresh
   packed CLI processes.
4. Every run must exit zero, produce the exact expected PNG count plus one bundle ZIP, preserve
   1320×2868 dimensions and opaque pixels, match the first run's SHA-256 manifest, remove staging
   directories, and restore the pre-run `screenshot-studio-web-*` temp-directory set.
5. On macOS/Linux, the harness samples the full CLI descendant process tree and records wall time
   plus peak aggregate RSS. Output is concise JSON plus a human summary.

## Baseline and ratified budgets

Baseline environment on 11 July 2026: Darwin 25.5.0 arm64, Node 24.16.0, Apple M3 Pro (12 logical
CPUs), 18,432 MiB memory. Each harness ran five fresh packed CLI processes after one package
build/install.

| Harness | Wall samples (ms) | Peak tree RSS samples (MiB) | Baseline median / max | Budget |
|---------|-------------------|-----------------------------|-----------------------|--------|
| Large, 12 screens | 9421, 8270, 8333, 8281, 8280 | 1052.7, 1053.6, 1111.1, 1100.8, 1043.1 | 8281 ms / 1111.1 MiB | median ≤ 10,500 ms; peak ≤ 1350 MiB |
| Repeat, 3 screens | 3275, 3274, 3202, 3172, 3168 | 985.8, 967.6, 933.5, 981.4, 947.0 | 3202 ms / 985.8 MiB | median ≤ 4200 ms; peak ≤ 1200 MiB |

The wall budgets provide roughly 25% headroom over the measured medians; RSS budgets provide
roughly 20% over the highest observed sample. These are material-regression limits for this
recorded environment, not cross-machine performance claims. Correctness, cleanup, hash stability,
or material monotonic RSS growth remains a blocker independent of numeric budgets.

Verify-mode results on the same recorded environment:

| Harness | Wall samples (ms) | Peak tree RSS samples (MiB) | Result |
|---------|-------------------|-----------------------------|--------|
| Large, 12 screens | 9441, 8319, 8293, 8419, 8318 | 1043.6, 1050.6, 1045.6, 1116.4, 1047.2 | median 8319 ms; peak 1116.4 MiB; pass |
| Repeat, 3 screens | 3177, 3310, 3172, 3172, 3209 | 969.4, 940.0, 982.1, 982.5, 909.1 | median 3177 ms; peak 982.5 MiB; pass |

Both runs produced the same per-harness output-manifest hashes, no alpha or dimension defects, no
staging/host temp leaks, and no material monotonic RSS growth. A fresh package build exposed one
pnpm realpath-resolution defect in the first harness attempt: flattening standalone directory links
could hide transitive packages such as `styled-jsx`. The final package stores trusted internal link
metadata, restores POSIX directory symlinks or Windows junctions at extraction, and copies file-link
targets as regular files. The packaged CLI E2E passed after this correction.

## Exact verification

- `pnpm exec vitest run packages/cli/src/export.test.ts scripts/export-soak.test.ts`
- targeted ESLint for the export and soak files;
- `pnpm typecheck`;
- `pnpm soak:export -- --baseline --report <path>` for five controlled samples per harness;
- `pnpm soak:export -- --report <path>` after ratifying the budgets;
- community assertions and `git diff --check`.

## Non-goals

Running soak in ordinary per-change CI, benchmarking editor interaction, adding a second renderer,
claiming cross-machine performance equivalence, publishing the package, or optimizing before a
measured material regression exists.
