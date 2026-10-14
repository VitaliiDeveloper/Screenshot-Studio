# Release and publication

Version `0.1.0` is an unpublished dry-run candidate. No npm publication, Git tag, GitHub release,
or announcement is implied by a successful local build or CI run.

## Build and inspect the candidate

Start from a clean checkout with Node.js 22.13+ and pnpm 12.10.1:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check:release-candidate
mkdir -p artifacts
pnpm --dir packages/cli/package pack --pack-destination ../../../artifacts
npm publish ./artifacts/screenshot-studio-cli-0.1.0.tgz --access public --dry-run --json
```

`check:release-candidate` builds the shared standalone host, generates third-party notices, packs a
temporary tarball, and audits its files, runtime dependencies, licenses, size, portability, version,
and public documentation. The retained artifact is
`artifacts/screenshot-studio-cli-0.1.0.tgz`. The final command is inspection-only: its JSON reports
the exact retained tarball’s npm SHA-512 SRI and packed size without publishing it.

## Verify a clean local installation

```bash
pnpm add --global ./artifacts/screenshot-studio-cli-0.1.0.tgz
screenshots setup
screenshots init --dir ./my-app-screenshots
screenshots dev --project ./my-app-screenshots/app-store-screenshots.json
screenshots export --project ./my-app-screenshots/app-store-screenshots.json
```

`screenshots setup` installs Chromium and the headless shell with the exact Playwright version in the
package manifest; it is idempotent. The package has no `postinstall` script. In a clean consumer also
confirm the first-run behaviour with an empty browser cache (`PLAYWRIGHT_BROWSERS_PATH=$(mktemp -d)`):
`screenshots export` without a TTY must exit non-zero printing the install command and download
nothing, and in a terminal it must ask before downloading.

Linux machines may require Playwright's documented system packages before Chromium can launch. The
browser download uses the machine or user cache and is not embedded in the package.

Interactive runs make one optional request per 24 hours to
`https://registry.npmjs.org/@screenshot-studio/cli/latest` and print a one-line notice when a newer
version exists (the result is cached in the user cache directory). Any failure, including a 404 for
an unpublished package, is ignored. Verify the opt-outs `SCREENSHOTS_NO_UPDATE_CHECK=1` and
`NO_UPDATE_NOTIFIER=1`; the check is also skipped when `CI` is set or output is not a terminal.

## Release gate

For the exact commit and artifact proposed for publication:

1. Confirm the workspace/package versions, release notes, `SECURITY.md`, and intended Git tag agree.
2. Install with `pnpm install --frozen-lockfile`; do not change dependency resolutions during the
   release gate.
3. Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm check:community`, `pnpm check:spdx`, and
   `pnpm check:release-candidate`.
4. Run `pnpm test:e2e:package`. Let the `dev` to `main` integration CI own the complete browser gate,
   and require the package matrix on the exact candidate SHA to pass the supported OS/Node matrix.
5. Record the tarball’s SHA-512 SRI (`sha512-…`) and size from the pack result, then install that
   exact file into a clean temporary consumer and repeat the init, project-management, and
   exact-export smoke. After publication, compare it with `npm view … dist.integrity`; do not treat
   a separate SHA-256 checksum as equivalent.
6. Review `THIRD_PARTY_NOTICES.md`, runtime dependency licenses, current Apple, Google, and
   Microsoft Store rules, `SECURITY.md`, and the limitations below.
7. Confirm control of the `@screenshot-studio` npm scope, registry authentication, public access,
   release notes, rollback ownership, and announcement timing.

Any changed code, dependency resolution, generated host, package manifest, or tarball invalidates
the earlier artifact hash and requires a fresh gate.

## Publication boundary

Tagging, creating a GitHub release, authenticating to npm, running a non-dry-run `npm publish`, and
announcing a release each requires explicit owner authorization. The local `npm publish --dry-run
--json` inspection command above is the only publish-command exception and cannot publish a package.
A green build or CI result grants no publication authority.

After authorization, publish the already-hashed tarball rather than rebuilding it:

```bash
npm publish ./artifacts/screenshot-studio-cli-0.1.0.tgz --access public
npm view @screenshot-studio/cli@0.1.0 dist.integrity dist.tarball
pnpm add --global @screenshot-studio/cli@0.1.0
screenshots init --dir ./registry-install-smoke
```

Compare the registry metadata with the reviewed artifact and complete a clean registry-install
smoke. If the digest, manifest, or smoke differs, stop promotion and record the failure. Never
overwrite or silently rebuild a published version; use the registry's deprecation mechanism and a
new reviewed patch version when remediation is required.

## Upgrade or uninstall

Install a newer reviewed tarball or registry version with the same global-add command. This
pre-release candidate accepts only the complete strict schema v1 document; historical internal
development formats are unsupported. Back up project JSON in Git and test future schema-changing
versions against a copy before upgrading.

```bash
pnpm add --global ./artifacts/screenshot-studio-cli-0.1.0.tgz
pnpm remove --global @screenshot-studio/cli
```

Uninstalling the CLI does not remove projects, exports, or Playwright's shared browser cache.

## Current limitations

- Export is intentionally Chromium-only; Firefox and WebKit are editor smoke targets, not alternate
  pixel-parity renderers.
- Node.js 22.13+ is required on Linux, macOS, and Windows.
- Only presets in `store-specs.json` are supported.
- Groups are one level, do not clip children, and cannot nest.
- Rendered fonts must be bundled built-ins or registered project assets; export rejects
  machine-dependent fallback fonts.
- Background removal handles edge-connected flat or near-uniform colours, not complex photographic
  segmentation.
- The editor and CLI are local-first. There is no hosted collaboration, cloud storage, telemetry,
  or bundled AI provider. The only automatic network calls are the one-time Chromium download
  you approve and the optional daily update check described above.
