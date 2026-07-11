# Phase 8 Slice 6 — Release artifact and candidate documentation

Status: complete. Candidate metadata, lifecycle surfaces, deterministic assertions, and the clean
packed-consumer proof passed on the final Slice 6 tree.

## Goal

Ratify `0.1.0` as the first dry-run release candidate, make the actual package metadata and runtime
dependency resolutions reproducible, and document the lifecycle without tagging or publishing.

## Contract

- Root/core/CLI/web workspace manifests agree on version `0.1.0` and remain private source packages.
- The generated `@screenshot-studio/cli` manifest omits `private`, carries repository/homepage/bugs/
  keywords/public-scope metadata, and pins its Playwright and Sharp runtime versions.
- `pnpm check:release-candidate` rebuilds and audits the actual tarball, then asserts version,
  metadata, runtime dependency, changelog, security, README, and release-guide agreement.
- `CHANGELOG.md`, `SECURITY.md`, and `docs/releasing.md` describe the candidate, installation,
  upgrade, uninstall, limitations, maintainer gate, and owner-only publication boundary.
- The exact package E2E installs the packed `0.1.0` tarball into a clean temporary consumer and
  exercises the shared standalone renderer.

## Non-goals

Registry authentication, npm publication, a Git tag/GitHub release, announcement, dependency
upgrades beyond pinning the already-tested lockfile resolutions, or a Phase 8 GO decision. The full
gate, retained tarball hash, current-SHA package matrix, and explicit decision belong to Slice 7.

## Closure evidence — 11 July 2026

- `pnpm check:release-candidate` built and audited candidate `0.1.0`, then verified all four private
  workspace versions, the non-private generated CLI manifest, repository/public-scope metadata,
  exact Playwright `1.61.1` and Sharp `0.34.5` dependencies, and all candidate documents.
- The dry-run package retained the exact ten-file allowlist. The final audit pack was 10,451,837 bytes
  and `runtime/web.zip` was 49,299,413 bytes; all 33 embedded package identities and the installed
  external runtime closure retained reviewed license identities/notices.
- `pnpm test:e2e:package` passed 2/2 tests after asserting the `0.1.0` filename/manifest. The clean
  temporary consumer installed the tarball, initialized and managed a project, started the packaged
  host, exported an exact PNG, preserved it through a missing-font failure, and retried cleanly.
- Workspace typecheck, targeted ESLint, 11-surface community assertions, SPDX checks for 196 source
  files, frozen-lockfile validation, and `git diff --check` passed.
- No tag, GitHub release, registry authentication, npm publication, or announcement occurred. npm
  scope ownership remains an explicit maintainer checklist item rather than an assumed fact.
