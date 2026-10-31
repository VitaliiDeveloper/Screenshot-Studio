# Test strategy

Use the cheapest test that can fail for the behavior being changed. Browser E2E is reserved for
contracts that require a real Next.js host, browser rendering, user interaction, persistence, or a
packed consumer. A test does not belong in E2E merely because its data is used by the editor.

## Test pyramid

| Level | Use it for | Normal command |
|---|---|---|
| Unit | schema, model, transforms, helpers, fixture invariants, API/service branches | `pnpm test:core`, `test:cli`, or `test:web` |
| Browser leaf group | one user-visible workflow or renderer/export contract | one command from the matrix below |
| Full browser gate | GitHub CI for the integration PR from `dev` into `main` | `pnpm test:e2e` |
| Release surfaces | cross-browser, packed CLI, optional skill, and living examples | `pnpm test:e2e:release-surfaces` |
| Release policy | SPDX headers, required community surfaces, and public status text | `pnpm check:spdx` and `pnpm check:community` |
| Release candidate | exact packed archive, metadata, integrity, and public release contract | `pnpm check:release-candidate` |

## Project mutation lock ownership

`packages/core/src/storage/project-lock.test.ts` owns local-filesystem lease behavior, including real
child-process contention, `SIGKILL` recovery, stale cleanup, canonical path aliases, and bounded lock
metadata. `packages/cli/src/project-io.test.ts` owns the caller-level proof that concurrent complete
read-modify-write transactions preserve both changes.

Do not move these guarantees into browser E2E. A browser host does not add evidence about atomic
directory creation or operating-system process death. Run editor E2E only when a separate user-visible
persistence workflow changes and cannot be verified below the browser boundary. The complete contract
and iOS-oriented mental model live in [Project mutation locking](project-mutation-locking.md).

For one changed workflow, prefer its exact file:

```bash
pnpm exec vitest run --config vitest.e2e.config.ts e2e/inspector-toolbar.test.ts
```

## E2E ownership matrix

Each E2E file belongs to exactly one leaf group. Aggregate commands compose leaf groups rather than
maintaining a second file list.

| Leaf group | What it protects | Run when |
|---|---|---|
| `test:e2e:parity:foundation` | base renderer, fonts, screenshots, frames, RTL, connected crops | shared renderer, schema, fonts, core media |
| `test:e2e:parity:elements` | groups, images/crop, icons, badges, consolidated element rendering, styled template packs (long text, RTL, previews), project pack export/apply round trip | one of those element contracts, a built-in pack, or project packs change |
| `test:e2e:export` | CLI/UI bundles, dimensions, alpha, safe paths, `screenshots check --render` issues | export, check, or render-host orchestration |
| `test:e2e:editor:interaction` | canvas editing, panels, inspector, history, snapping | direct interaction behavior |
| `test:e2e:editor:workspace` | launcher/import/archive round trip, isolated/connected workspace, locale scope, responsive state, status bar and keyboard shortcuts, Agent panel run and Undo run with a fake CLI | launcher, workspace, locale, or Agent panel ownership |
| `test:e2e:editor:authoring` | fonts, themes, templates, assets, selection, groups, icons, badges, styling/frame controls | authoring entry points |
| `test:e2e:accessibility` | serious/critical Axe findings at desktop and compact widths | semantics, dialogs, menus, responsive UI |
| `test:e2e:browsers` | Chromium, Firefox, and WebKit author/persist/reload smoke | browser-sensitive code or release readiness |
| `test:e2e:package` | packed install, CLI management/export, recovery | packaging/runtime host or release readiness |
| `test:e2e:skill` | optional skill install and bootstrap failures | skill/package integration |
| `test:e2e:examples` | current-schema example validation and exact export | examples, schema, renderer, release readiness |

The full config keeps files sequential because each file owns mutable project state and usually its
own server/browser lifecycle. Reuse a session inside one file only when isolation and fresh-page
assertions remain explicit.

Launcher 3 browser ownership is intentionally one exact file. It proves compact Projects boundaries,
configured-local compatibility, Folder import into a managed copy, project-details archive download,
ZIP re-import, and direct Workspace landing:

```bash
pnpm exec vitest run --config vitest.e2e.config.ts e2e/project-launcher.test.ts
```

ZIP admission, path/credential policy, limits, cancellation cleanup, atomic catalog/session behavior,
one-shot artifacts, and byte-level archive round trip stay in `test:web`; do not duplicate them in
additional browser scenarios.

Launcher 4 browser ownership is also one exact file. It proves validated managed Project Info,
source-safe identity, Home ↔ Workspace layout/screen/selection/chrome preservation, failed-save
navigation blocking and recovery, source-neutral Close project, storage/catalog non-mutation, and
serious/critical accessibility coverage as one dependent journey:

```bash
pnpm exec vitest run --config vitest.e2e.config.ts e2e/project-home-round-trip.test.ts
```

Session-registry isolation, cookie and project-id fences, transient-state validation, direct client
failure branches, and same-project store reconciliation stay in `test:web`; do not repeat those
deterministic branches in more browser files.

Launcher 5 browser ownership is one exact file. It proves the visible creation library and platform
compatibility, modal focus/keyboard/error/retry behavior, managed empty and starter creation, exact
new-project activation, and direct Workspace landing:

```bash
pnpm exec vitest run --config vitest.e2e.config.ts e2e/project-creation.test.ts
```

Scaffold strictness/parity, dependency validation, path containment, duplicate-name races, staging
cleanup, atomic publication/recovery, and session reservation stay in focused core/CLI/web tests.

Launcher 6 browser ownership is one exact file in `test:e2e:editor:workspace`. It proves no-write
capture preview, explicit new-project selection, confirmation, exact receiver activation, and the
verified direct Workspace handoff:

```bash
pnpm exec vitest run --config vitest.e2e.config.ts e2e/capture-import.test.ts
```

Capture discovery/path safety, deterministic plans and fresh ids, current-project identity/revision
fences, atomic rollback/recovery, managed staging/catalog cleanup, API failure branches, and CLI parity
stay in focused core/CLI/web tests.

Launcher 7 browser ownership is one exact file in `test:e2e:editor:workspace`. It proves the visible
archive-before-delete choice, exact irreversible confirmation, keyboard focus restoration, one
destructive request, Projects handoff, cleared session, managed-directory removal, and preservation
of the imported local source:

```bash
pnpm exec vitest run --config vitest.e2e.config.ts e2e/permanent-project-deletion.test.ts
```

Operation idempotency, lifecycle/version fences, save draining, containment and symlink rejection,
failure injection, tombstone recovery, and restart reconciliation stay in focused `test:web` tests.

Launcher 8 browser ownership is one exact file in `test:e2e:editor:workspace`. It proves the two-state
Projects surface, first-run action boundary, direct creation → Workspace handoff, bottom-rail return,
real gallery preview/metadata, Project details overflow, compact-width reachability, direct card
reopen, and serious/critical accessibility gate:

```bash
pnpm exec vitest run --config vitest.e2e.config.ts e2e/launcher-closure.test.ts
```

History corruption/recovery, ordering, deduplication, bounded eviction, privacy/path safety,
catalog lifecycle filtering, activation-route recording, and lock ordering stay in focused
`test:web` tests.

### Launcher umbrella verification ownership

| Acceptance cluster | Completed slice | Durable verification owner |
|---|---|---|
| Explicit source selection and request-scoped active sessions | Launcher 1 | project-session and request-fence `test:web` tests |
| Managed storage, catalog, recovery, and source-safe identity | Launcher 2 | managed repository/catalog/lifecycle `test:web` tests |
| Browser managed-copy import and portable project archive | Launcher 3 | focused route/service tests plus `e2e/project-launcher.test.ts` |
| Validated Project Info and Workspace round trip | Launcher 4 | focused model/client tests plus `e2e/project-home-round-trip.test.ts` |
| Strict shared empty/template project creation | Launcher 5 | core scaffold and creation-route tests plus `e2e/project-creation.test.ts` |
| Capture-folder preview and explicit-target apply | Launcher 6 | core/CLI/web capture tests plus `e2e/capture-import.test.ts` |
| Managed-only permanent deletion without Trash semantics | Launcher 7 | lifecycle/deletion tests plus `e2e/permanent-project-deletion.test.ts` |
| Two-state Projects, direct Workspace handoff, durable recents, and closure terminology | Launcher 8 | project-library/client/component tests plus `e2e/launcher-closure.test.ts` |

## Golden gallery

`e2e/golden-gallery.test.ts` renders the first screen of every built-in screen pack through the real
render host, at every store size listed for that pack's family in `store-specs.json` (non-lead sizes
are the same size variants the editor's Sizes bar creates), once in `en` LTR and once in `ar` RTL.
Every built-in design pack is covered through the screen packs baked from it. Each render runs at the
`pixelRatio` that makes the long side 288 px and is compared with a reference under
`e2e/golden/<platform>/<pack>/<size>-<direction>.png`, using the parity tests' pixelmatch threshold
(`0.1`) and mismatch limit (under 0.1% of pixels). It is the pixel net for regressions that only show
in rendered output, such as mirrored gradients, rotation, and shadow direction in RTL. The `ar` cases
render the packs' English copy under RTL direction: they test mirroring, not Arabic shaping or fonts,
which `e2e/template-pack-parity.test.ts` covers.

| Command | Effect |
|---|---|
| `pnpm golden:check` | Compares every case and never writes references. Every render goes to `test-results/golden-gallery/actual/` in the reference layout; failures add expected and diff PNGs under `test-results/golden-gallery/diff/`. Differences, missing references, and stale reference files all fail. With no reference folder for the platform, it fails once, telling you to run `pnpm golden:update`. |
| `pnpm golden:update` | Rewrites only references that are missing or differ beyond the threshold, removes stale ones, and prints each changed pack, size, and direction. |

References are per platform (`process.platform`) because macOS and Linux rasterize text edges
differently. Only `e2e/golden/linux/` is tracked: Ubuntu CI is the authority, and that set is valid
for the x64 `ubuntu-latest` runner only. On macOS or Windows, run
`pnpm golden:update` once to seed local references, which `.gitignore` keeps untracked, then use
`pnpm golden:check` against them. Re-seed them after pulling a change that updates the Linux set.

The `Golden gallery` workflow uploads `test-results/golden-gallery/` as the
`golden-gallery-renders-<sha>` artifact whenever the check fails. Its `actual/` folder holds every
render of that run, so it can replace the Linux set as is:

```bash
rm -rf e2e/golden/linux && cp -R <artifact>/actual e2e/golden/linux
```

Seed the Linux set this way from the first run on the integration pull request into `dev`, which
fails because no Linux references exist yet.

To accept an intended visual change, open the artifact's `diff/*.diff.png` and `*.expected.png` for
every failing case. If every difference is intended, replace `e2e/golden/linux/` from `actual/` as
above. Commit the references in the same pull request as the change that caused them. Never update
references to make an unexplained difference go away. A Playwright or Chromium upgrade shifts pixels,
so it needs a new Linux set.

The gallery is not part of any `test:e2e*` aggregate. Run it when a built-in pack, design pack, the
shared renderer, or size-variant reflow changes.

## Cost rules

- Do not run browser E2E for pure fixture assertions, calculations, or schema/model branches with a
  deterministic unit seam.
- Do not run E2E for generic regression confidence during development. A browser run needs a direct
  changed behavior that unit or integration tests cannot cover.
- Do not run an unsuffixed aggregate (`test:e2e:parity` or `test:e2e:editor`) when one leaf group or
  exact file matches the change.
- Do not run the full `pnpm test:e2e` suite locally. If integration CI fails, reproduce the failure
  with its exact E2E file, push the fix, and let CI rerun the full gate.
- Cross-browser, package, skill, and example tests are release-class. Run them during development
  only when their surface changes.
- Keep one scenario focused on one coherent user outcome. Combining steps is acceptable when they
  intentionally share expensive setup and later assertions depend on the earlier workflow.
- The golden gallery runs on pull requests into `dev` only when its test, references, workflows, or
  `package.json` change. A built-in pack or renderer change elsewhere reaches it only at `dev` to
  `main`, so run `pnpm golden:check` locally (about 4 minutes) for such a change.
- Record actual timing before deleting unique coverage for performance reasons. Slow and redundant
  are different problems.

## CI policy

Feature pull requests into `dev` run only lint, typecheck, and unit tests (about two job-minutes per
push), plus the golden gallery when they change its own files. Browser E2E, coverage, and the release gates stay off them; use the cheapest exact local check
for the changed behavior. The full integration gate runs for a pull request whose head is `dev` and
base is `main`: lint, typecheck, unit tests, coverage, the path-scoped package matrix and
release-candidate checks, plus the complete `pnpm test:e2e` browser suite. The separate
`Golden gallery` workflow runs `pnpm golden:check` on the same `dev` to `main` pull requests, on pull
requests into `dev` that change the gallery test, its references, its workflows, or `package.json`
(through `golden-gallery-dev.yml`), and on dispatch. It uploads `test-results/golden-gallery/` as an
artifact when it fails. The workflows remain
available through `workflow_dispatch` for an explicitly requested candidate head.

The full browser command composes the leaf groups as separate Vitest processes, preserving complete
coverage without leaking mutable `PROJECT_PATH`, browser, or Next.js runtime state across unrelated
areas.

The dedicated `Release candidate` workflow runs `pnpm check:community`, `pnpm check:spdx`, and
`pnpm check:release-candidate` when its workflow, release guide, release audit scripts, package
builder, lockfile, or package manifests change. It can also be dispatched manually for an exact
candidate head. These checks build and inspect the packed CLI archive but do not publish it:
publication remains a separate, owner-authorized action under [`docs/releasing.md`](releasing.md).

The `Action smoke` workflow runs the root GitHub Action as a consumer would: one job exports
`examples/connected-launch` and checks every PNG size with `scripts/check-export-sizes.mjs`, and one
job removes an asset and expects `screenshots check` to fail with no export. It runs on dispatch, on
every pull request from `dev` into `main`, and on pull requests into `dev` that change `action.yml`,
the workflow, or that script.
