# Test strategy

Use the cheapest test that can fail for the behavior being changed. Browser E2E is reserved for
contracts that require a real Next.js host, browser rendering, user interaction, persistence, or a
packed consumer. A test does not belong in E2E merely because its data is used by the editor.

## Test pyramid

| Level | Use it for | Normal command |
|---|---|---|
| Unit | schema, model, transforms, helpers, fixture invariants, API/service branches | `pnpm test:core`, `test:cli`, or `test:web` |
| Browser leaf group | one user-visible workflow or renderer/export contract | one command from the matrix below |
| CI subset | representative foundation, export, editor interaction, and Axe coverage | `pnpm test:e2e:ci` |
| Full browser gate | phase, pull-request, or release closure | `pnpm test:e2e` |
| Release surfaces | cross-browser, packed CLI, optional skill, and living examples | `pnpm test:e2e:release-surfaces` |

For one changed workflow, prefer its exact file:

```bash
pnpm exec vitest run --config vitest.e2e.config.ts e2e/inspector-toolbar.test.ts
```

## E2E ownership matrix

Each E2E file belongs to exactly one leaf group. Aggregate commands compose leaf groups rather than
maintaining a second file list.

| Leaf group | Files / cases | What it protects | Run when |
|---|---:|---|---|
| `test:e2e:parity:foundation` | 5 / 9 | base renderer, fonts, screenshots, frames, RTL, connected crops | shared renderer, schema, fonts, core media |
| `test:e2e:parity:elements` | 4 / 4 | groups, decorative images, icons, badges | one of those element contracts changes |
| `test:e2e:export` | 3 / 3 | CLI/UI bundles, dimensions, alpha, safe paths | export or render-host orchestration |
| `test:e2e:editor:interaction` | 5 / 13 | canvas editing, panels, inspector, history, snapping | direct interaction behavior |
| `test:e2e:editor:workspace` | 4 / 8 | isolated/connected workspace, locale scope, responsive state | workspace or locale ownership |
| `test:e2e:editor:authoring` | 8 / 8 | fonts, themes, templates, assets, selection, groups, icons, badges | authoring entry points |
| `test:e2e:accessibility` | 1 / 2 | serious/critical Axe findings at desktop and compact widths | semantics, dialogs, menus, responsive UI |
| `test:e2e:browsers` | 1 / 3 | Chromium, Firefox, and WebKit author/persist/reload smoke | browser-sensitive code or release readiness |
| `test:e2e:package` | 1 / 2 | packed install, CLI management/export, recovery | packaging/runtime host or release readiness |
| `test:e2e:skill` | 1 / 3 | optional skill install and bootstrap failures | skill/package integration |
| `test:e2e:examples` | 1 / 2 | living v5 example validation and exact export | examples, schema, renderer, release readiness |

Current maintained browser baseline: **34 files / 57 cases**. The full config keeps files sequential
because each file owns mutable project state and usually its own server/browser lifecycle. A larger
case count is therefore less important than the number and type of files selected.

Parity files reuse one headed and one headless render session per file. This reduces their browser
launches from 35 to 22 while preserving a fresh page for every render and a separate interactive
browser where the UI canvas is also asserted. Do not replace the session harness with repeated
one-shot `renderScreenToPng` calls.

## Cost rules

- Do not run browser E2E for pure fixture assertions, calculations, or schema/model branches with a
  deterministic unit seam.
- Do not run an unsuffixed aggregate (`test:e2e:parity` or `test:e2e:editor`) when one leaf group or
  exact file matches the change.
- Cross-browser, package, skill, and example tests are release-class. Run them during development
  only when their surface changes.
- Keep one scenario focused on one coherent user outcome. Combining steps is acceptable when they
  intentionally share expensive setup and later assertions depend on the earlier workflow.
- Record actual timing before deleting unique coverage for performance reasons. Slow and redundant
  are different problems.

## CI policy

Pushes to `dev` run the 14-file / 27-case `test:e2e:ci` subset. Pull requests, pushes to `main`, and
manual workflow dispatch run the complete browser gate. This avoids duplicating the full suite on
every development push while retaining a full closure signal before merge or release.
