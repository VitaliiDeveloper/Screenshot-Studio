# Test strategy

Use the cheapest test that can fail for the behavior being changed. Browser E2E is reserved for
contracts that require a real Next.js host, browser rendering, user interaction, persistence, or a
packed consumer. A test does not belong in E2E merely because its data is used by the editor.

## Test pyramid

| Level | Use it for | Normal command |
|---|---|---|
| Unit | schema, model, transforms, helpers, fixture invariants, API/service branches | `pnpm test:core`, `test:cli`, or `test:web` |
| Browser leaf group | one user-visible workflow or renderer/export contract | one command from the matrix below |
| CI subset | automated representative coverage on pushes to `dev` | `pnpm test:e2e:ci` |
| Full browser gate | GitHub CI for the integration PR from `dev` into `main` | `pnpm test:e2e` |
| Release surfaces | cross-browser, packed CLI, optional skill, and living examples | `pnpm test:e2e:release-surfaces` |

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
| `test:e2e:parity:elements` | groups, images/crop, icons, badges, consolidated element rendering | one of those element contracts changes |
| `test:e2e:export` | CLI/UI bundles, dimensions, alpha, safe paths | export or render-host orchestration |
| `test:e2e:editor:interaction` | canvas editing, panels, inspector, history, snapping | direct interaction behavior |
| `test:e2e:editor:workspace` | isolated/connected workspace, locale scope, responsive state | workspace or locale ownership |
| `test:e2e:editor:authoring` | fonts, themes, templates, assets, selection, groups, icons, badges, styling/frame controls | authoring entry points |
| `test:e2e:accessibility` | serious/critical Axe findings at desktop and compact widths | semantics, dialogs, menus, responsive UI |
| `test:e2e:browsers` | Chromium, Firefox, and WebKit author/persist/reload smoke | browser-sensitive code or release readiness |
| `test:e2e:package` | packed install, CLI management/export, recovery | packaging/runtime host or release readiness |
| `test:e2e:skill` | optional skill install and bootstrap failures | skill/package integration |
| `test:e2e:examples` | current-schema example validation and exact export | examples, schema, renderer, release readiness |

The full config keeps files sequential because each file owns mutable project state and usually its
own server/browser lifecycle. Reuse a session inside one file only when isolation and fresh-page
assertions remain explicit.

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
- Record actual timing before deleting unique coverage for performance reasons. Slow and redundant
  are different problems.

## CI policy

Pushes to `dev` run lint, typecheck, unit/package tests, and the targeted `test:e2e:ci` browser
subset asynchronously. Ordinary pull requests do not add a full browser regression suite. The
complete `pnpm test:e2e` gate runs only for a pull request whose head is `dev` and base is `main`.
That full command composes the leaf groups as separate Vitest processes, preserving complete
coverage without leaking mutable `PROJECT_PATH`, browser, or Next.js runtime state across unrelated
areas. Local development still uses only exact E2E files when the changed behavior requires a browser.
