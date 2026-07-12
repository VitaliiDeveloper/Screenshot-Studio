# Release candidate lifecycle

Current candidate: `0.1.0`. It is a dry-run artifact only: no npm publication, Git tag, GitHub
release, or announcement exists yet.

## Build and inspect the candidate

From a clean checkout with Node.js 22.13+ and pnpm 11.10.0:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check:release-candidate
mkdir -p artifacts
pnpm --dir packages/cli/package pack --pack-destination ../../artifacts
```

`check:release-candidate` builds the shared standalone host, generates third-party notices, packs a
temporary tarball, audits its exact files/dependencies/licenses/size/portability, and checks version
and documentation consistency. The retained dry-run file is
`artifacts/screenshot-studio-cli-0.1.0.tgz`.

## Install the dry-run tarball

```bash
pnpm add --global ./artifacts/screenshot-studio-cli-0.1.0.tgz
pnpm dlx playwright@1.61.1 install chromium chromium-headless-shell
screenshots init --dir ./my-app-screenshots
screenshots dev --project ./my-app-screenshots/app-store-screenshots.json
screenshots export --project ./my-app-screenshots/app-store-screenshots.json
```

Linux machines may require Playwright's documented system packages before Chromium can launch. The
browser download is per machine/user cache; it is not embedded in the npm tarball.

## Upgrade or uninstall

Install a newer reviewed tarball with the same global-add command; pnpm replaces the existing global
package. Project JSON is not migrated by package installation: back it up in Git and run the new CLI
against a copy first whenever a future changelog announces a schema change.

```bash
pnpm add --global ./artifacts/screenshot-studio-cli-0.1.0.tgz
pnpm remove --global @screenshot-studio/cli
```

Uninstalling the CLI does not remove projects, exported files, or Playwright's shared browser cache.

## Known limitations

- Export is intentionally Chromium-only. Firefox and WebKit are representative editor smoke
  targets, not alternate pixel-parity renderers.
- The candidate supports Node.js 22.13+ on Linux, macOS, and Windows; the final current-SHA package
  matrix is a Phase 8 Slice 7 gate.
- Only the presets present in `store-specs.json` are supported. Additional Apple accepted sizes and
  Google device classes remain future work.
- Groups are one level, do not clip children, and cannot nest. Backgrounds remain solid, and project
  JSON accepts only the strict v10 element/property surface.
- Fonts must be registered as project assets. Export rejects machine-dependent fallback fonts.
- Background removal handles edge-connected flat or near-uniform colours; it is not semantic
  segmentation for complex photographs.
- The editor and CLI are local-first. There is no hosted collaboration, cloud storage, telemetry,
  or bundled AI provider.
- `@screenshot-studio/cli` is the intended public package name, but npm scope ownership and registry
  credentials are owner-controlled publication prerequisites, not candidate-build evidence.

## Maintainer checklist

1. Start from a clean release branch and confirm all workspace versions, `CHANGELOG.md`, this guide,
   and the intended tag agree.
2. Install with `pnpm install --frozen-lockfile`; do not regenerate dependency resolutions during
   candidate closure.
3. Run `pnpm check:release-candidate`, `pnpm test:e2e:package`, and the non-browser release checks
   recorded in `docs/release-readiness.md`. Do not duplicate the full browser suite locally.
4. Generate the retained tarball, record its SHA-256 and size, and install that exact file into a
   clean temporary consumer for source/packed living-project dogfood.
5. Push the candidate commit only with owner approval. Require the `dev` → `main` integration PR's
   full browser CI gate and the package matrix on that exact SHA to pass Ubuntu/macOS/Windows Node 22
   and Ubuntu Node 24.
6. Review `THIRD_PARTY_NOTICES.md`, direct/runtime dependency licenses, the dated Apple/Google audit,
   `SECURITY.md`, and every known limitation above.
7. Confirm control of the `@screenshot-studio` npm scope, registry authentication, public access,
   release notes, and rollback/deprecation procedure. Candidate checks do not prove those accounts.
8. Record an explicit Slice 7 `GO` with no blocker before creating `v0.1.0`, a GitHub release, or an
   npm publication.
9. Tagging, release creation, registry authentication, `npm publish`, and announcements each require
   explicit owner authorization. A green candidate does not grant it.

## Publication boundary

The prepared manifest uses public scoped-package metadata, but `npm publish` requires explicit owner authorization.
If publication is approved after a recorded GO, publish the already-hashed tarball rather than
rebuilding, then verify the registry digest and run a clean registry install smoke. If any digest,
manifest, or smoke result differs, stop and record `NO-GO`; do not silently rebuild or overwrite a
published version.
