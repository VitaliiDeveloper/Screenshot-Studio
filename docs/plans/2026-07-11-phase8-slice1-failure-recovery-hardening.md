# Phase 8 Slice 1 — Failure and recovery hardening

Status: complete. Transactional generated-output publication, runtime lifecycle failure handling,
the injected fault matrix, packed failure/retry proof, and targeted slice verification have passed.

## Goal

Make the shipped export/package path recover predictably from render, filesystem, host-startup,
host-exit, and cleanup failures without mutating project inputs, corrupting prior generated output,
or leaking browser/server/temp resources.

## Scope

1. Add narrow injectable seams around bundle publication and render-host lifecycle where the current
   implementation cannot deterministically force a failure.
2. Write the complete bundle and ZIP into a private same-filesystem staging location before
   publishing generated destinations.
3. Track pre-existing generated destinations and roll them back if publication fails; preserve
   unrelated files in the requested output directory.
4. Detect unexpected render-host exit while waiting for readiness and while the controller is live,
   surfacing exit code/signal context promptly.
5. Make page/context/browser/child/temp cleanup idempotent, preserve the primary error, and expose a
   cleanup error as secondary context.
6. Start `docs/release-readiness.md` with the Phase 7 baseline and the Slice 1 fault-matrix evidence.

## Exact tests

- `packages/cli/src/export.test.ts`
  - render N fails before publication and leaves prior output byte-for-byte unchanged;
  - ZIP/staging failure publishes nothing and removes staging;
  - publish N fails, restores replaced generated files, removes new generated files, and keeps an
    unrelated sentinel;
  - successful publication replaces only generated destinations and leaves no staging directory.
- `packages/cli/src/render-driver.test.ts`
  - page close runs after navigation/readiness/export failure;
  - context and browser close both run when either close rejects, with primary error retained.
- `packages/cli/src/server.test.ts`
  - startup failure, unexpected exit, explicit stop, repeated stop, and cleanup failure have exact
    prompt/error/cleanup behavior.
- `e2e/packaged-cli.test.ts`
  - extend the existing one-build package smoke with a real packaged-host failure/retry proving
    prior-output preservation, successful recovery, and extracted temp-host cleanup. Keeping the
    scenario in the existing file avoids rebuilding the 41 MiB artifact in a second E2E file.

## Slice verification

During implementation, run the three exact Vitest files above. At completion run:

```text
pnpm test:cli
pnpm typecheck
pnpm test:e2e:package
git diff --check
```

The full editor/parity/browser gate is not required: this slice changes Node-side publication and
runtime lifecycle behavior without changing project schema, rendered pixels, or editor interaction.

Completion evidence:

1. `pnpm test:cli` — 17 files / 90 tests passed.
2. Targeted ESLint over the changed CLI source/test files passed.
3. `pnpm typecheck` passed for core, CLI, and web.
4. `pnpm test:e2e:package` — 2 tests passed, including real packed failure, cleanup, and retry.
5. `git diff --check` passed.

## Non-goals

Retrying nondeterministic renders automatically, changing output naming, deleting unrelated output
files, adding telemetry, changing the shared Chromium renderer, or adding Phase 9 features.
