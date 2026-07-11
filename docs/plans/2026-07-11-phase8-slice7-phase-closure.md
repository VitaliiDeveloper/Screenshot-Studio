# Phase 8 Slice 7 — Sustained dogfood and phase closure

Status: complete. Every local source, packed-candidate, soak, accessibility/browser, full
repository, and remote package-matrix gate is green. The explicit release-readiness decision is
`GO`; publishing and release promotion remain separate owner actions.

## Goal

Exercise the living v5 projects through both source and retained packed-candidate workflows, rerun
every Phase 8 closure gate, retain one identified `0.1.0` tarball, and make the release-readiness
decision from complete local and remote evidence. This slice declares readiness only; it does not
tag, publish, promote, or announce a release.

## Local environment — 11 July 2026

- branch/head: `phase-8` at `ab911c2`;
- Darwin 25.5.0 arm64, Apple M3 Pro, 12 logical CPUs, 18,432 MiB memory;
- Node.js 24.16.0 and pnpm 11.10.0;
- Playwright-managed Chromium, Firefox 151.0, and WebKit 26.5.

## Full closure evidence

1. `pnpm test` passed 56 files / 389 tests.
2. Full `pnpm lint` and workspace `pnpm typecheck` passed.
3. One isolated structured `pnpm test:e2e` run passed 70 suites / 59 tests with zero failures.
   An earlier report produced while two full runners accidentally overlapped was discarded as
   invalid environment evidence; no overlapping Vitest process existed for the recorded run.
4. The dedicated accessibility/browser group passed 2 files / 5 tests: zero serious/critical Axe
   findings plus green Chromium, Firefox, and WebKit edit/persist/reload smoke.
5. Source living-project dogfood passed 2 files / 3 tests: connected and RTL exact exports plus
   persisted keyboard group workflows across LTR/RTL locales.
6. The five-sample packed soak stayed inside ratified budgets:
   - 12-screen/four-locale large bundle: 7,917 ms median, 1,112.5 MiB peak RSS, manifest SHA-256
     `0164384f74cc0c1ef6e69c1ffc36b83c20055c3cf68ab0e86923a63d2edec744`;
   - three-screen repeat bundle: 2,922 ms median, 965.4 MiB peak RSS, manifest SHA-256
     `42deca9141fa187c7c3f20074eceb9acba2fcea9f470c2e676c1e7d651bd55c0`;
   - both reported stable output hashes, no material monotonic RSS growth, exact opaque PNG/ZIP
     output, and no leaked packaged-host temporary directories.
7. `pnpm check:release-candidate` passed the exact ten-file package surface, candidate metadata,
   pinned runtime dependencies, licenses/notices, OS-neutral archive, size budgets, and public-doc
   assertions.

## Retained candidate and packed living-project dogfood

The retained local artifact is `screenshot-studio-cli-0.1.0.tgz`, 10,451,880 bytes, with SHA-256:

```text
37239a1e6693c47233635bb4b6ba33bc23005c5bd91278f11859f3cd7fd09705
```

That exact file was installed into a new temporary consumer using the workspace's offline pnpm
store. Its installed `screenshots` bin listed the expected screens/locales and exported both living
projects: three connected-launch PNGs plus ZIP and four RTL-delivery PNGs plus ZIP. All seven PNGs
were independently inspected as exact 1320×2868 opaque images. The installed package left source
projects unchanged and its packaged render host exited cleanly after each export.

## Remote package evidence

[Package Matrix run 29151150458](https://github.com/VitaliiDeveloper/Screenshot-Studio/actions/runs/29151150458)
passed on the last package-changing candidate SHA `ab911c2400e669ee9b8974cd3ad3f3d85241a4a5`:

- macOS / Node 22 — success;
- Windows / Node 22 — success;
- Ubuntu / Node 22 — success;
- Ubuntu / Node 24 — success, including workspace unit/typecheck compatibility.

Every entry built the `0.1.0` artifact and passed clean packed install/init/manage/exact-export and
failure/recovery through the OS-neutral standalone host. This closes the remaining environment
evidence gap. The Slice 7 commit contains closure documentation only and does not change the tested
candidate package.

## Final decision

**GO — release ready.** All eight Phase 8 gate items are supported by current local and remote
evidence, no release-readiness blocker remains, and candidate `0.1.0` may proceed to an explicitly
authorized publication workflow. This decision does not itself create a tag, GitHub release, npm
publication, announcement, or other promotion.
