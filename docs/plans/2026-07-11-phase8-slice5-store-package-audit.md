# Phase 8 Slice 5 — Store and production-package audit

Status: complete. Official store sources and the actual portable package were audited on the final
Slice 5 tree; versioning and candidate documentation remain intentionally deferred to Slice 6.

## Goal

Record a dated official-source audit for every supported store preset and add a deterministic audit
of the actual packed CLI artifact: dependencies, licenses/notices, file allowlist, required runtime
files, portability, and size.

## Store audit contract — 11 July 2026

- Apple source: <https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications>
  - accepted portrait sizes include iPhone 6.9 `1320×2868`, 6.5 `1284×2778`, 6.3
    `1206×2622`, and 6.1 `1125×2436`;
  - accepted iPad 13 portrait sizes include `2064×2752`;
  - Apple accepts one to ten JPEG/JPG/PNG screenshots. The source lists additional accepted device
    sizes, but widening the supported preset/device surface is Phase 9 work.
- Google source: <https://support.google.com/googleplay/android-developer/answer/9866151?hl=en>
  - phone screenshots must be JPEG or 24-bit PNG without alpha, both dimensions must stay between
    320 and 3840 pixels, and the long side must be at most twice the short side;
  - the recommended app promotion portrait preset is at least `1080×1920` at 9:16, matching the
    supported Android phone preset;
  - Google permits up to eight screenshots per supported device type and requires at least two
    screenshots across device types. The CLI validates pixels, not listing-level screenshot count.

All current `store-specs.json` presets match those official rules. New Apple accepted sizes and new
Google device classes remain explicitly unsupported rather than silently widening Phase 8.

## Artifact audit contract

1. Build and pack the staged CLI, then inspect the produced tarball metadata and its embedded web
   archive rather than trusting source manifests alone.
2. Keep the exact package allowlist, required CLI/store-spec/web-host files, Node engine, and direct
   runtime dependency set under deterministic assertions.
3. Keep the compressed tarball below 64 MiB and record both tarball and embedded-host sizes.
4. Reject platform-labelled or native binary payloads from `runtime/web.zip`. Materialize the
   correct installed `sharp` optional packages into the extracted host at runtime instead.
5. Generate and ship `THIRD_PARTY_NOTICES.md` from the actual bundled CLI and embedded top-level
   runtime package manifests/license files; reject missing or non-approved license identities.
6. Treat Next's `dist/compiled` internals as part of the audited Next distribution identity while
   still recording Next's own license text.

## Exact verification

- `pnpm audit:release`
- `pnpm test:e2e:package`
- targeted release-audit/package/server unit files;
- CLI suite and workspace typecheck;
- targeted ESLint, community/SPDX assertions, and `git diff --check`.

## Closure evidence — 11 July 2026

- `pnpm audit:release` rebuilt and packed the staged CLI, then passed the exact ten-file allowlist.
  The final tarball was 10,451,405 bytes and its embedded web archive was 49,298,390 bytes, below the
  ratified 64 MiB and 96 MiB limits.
- The embedded archive contained no native binaries, `fsevents`, or platform-labelled Sharp
  packages. The packaged server materializes the installed platform's Sharp runtime into the
  extracted host before launch, keeping one tarball OS-neutral.
- The audit recorded 33 embedded production package identities and the installed external runtime
  closure. It generated `THIRD_PARTY_NOTICES.md` from the audited manifests and license texts,
  including the current platform's libvips LGPL identity, without claiming legal advice.
- `pnpm test:e2e:package` passed 2/2 tests from the packed artifact, including install, init,
  management, standalone-host startup, exact export, and failure/recovery.
- Targeted release/archive/server tests passed 3 files / 16 tests; `pnpm test:cli` passed 17 files /
  95 tests; workspace typecheck, targeted ESLint, community/SPDX checks, and `git diff --check`
  passed.

The first artifact inspection found that the prebuilt web archive inherited macOS-only Sharp,
libvips, and `fsevents` payloads from the build machine. That package was not treated as release
evidence. Slice 5 now excludes platform/native payloads at archive time and proves runtime
materialization through both unit and packed-install tests.

## Non-goals

Changing version `0.0.0`, publishing, registry authentication, adding store device classes, legal
advice, or replacing the shared Next renderer. Version and candidate documentation belong to Slice
6; one cross-OS candidate-tarball proof belongs to Slice 7.
