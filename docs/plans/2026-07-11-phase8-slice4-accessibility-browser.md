# Phase 8 Slice 4 — Accessibility and browser coverage

Status: complete. The dedicated audit/smoke group passes all five tests across both audited
viewport families and all three representative browser engines.

## Goal

Add durable automated evidence for the editor's DOM accessibility and representative authoring in
Chromium, Firefox, and WebKit without treating non-Chromium engines as export renderers.

## Contract

1. Use `@axe-core/playwright` against WCAG 2 A/AA and WCAG 2.1 A/AA tags, failing on every serious
   or critical violation in the tested state.
2. Audit the loaded shell, structure/add panels, canvas menu, locale dialog, inspector form state,
   and save-failure alert at a desktop viewport.
3. Audit the loaded shell plus representative panel/dialog states at a compact viewport.
4. Run one bounded editor smoke in Chromium, Firefox, and WebKit: load the real editor, navigate to
   another screen, insert a shape, observe disk persistence, reload, and find the persisted layer.
5. Keep export/parity Chromium-only. This slice multiplies only representative editor behavior.
6. Copy the fixture to a temporary project and restore/clean it so tests never mutate living data.

## Exact verification

- `pnpm test:e2e:accessibility`
- targeted ESLint for the two new E2E files;
- workspace typecheck;
- community assertions and `git diff --check`.

Firefox and WebKit browser binaries are local Playwright-cache prerequisites, not repository
artifacts. The final release-candidate gate reruns this dedicated group.

## Closure evidence

- `pnpm test:e2e:accessibility` — 2 files / 5 tests passed: two Axe state audits plus Chromium,
  Firefox, and WebKit authoring/persistence smoke.
- The desktop audit covers shell, Structure/Add panels, canvas menu, locale dialog, inspector form,
  and injected save-failure alert. The compact audit covers shell, Add panel, and locale dialog.
- The audit found and retired serious contrast failures in the screen/layer/inspector headings,
  screen metadata, Add catalog hints/categories/shortcut, and locale heading/direction badge.
- A real in-app browser pass confirmed the editor title and meaningful workspace DOM, no framework
  overlay or console warning/error, and a working open/close Locale manager interaction.
- Targeted ESLint, workspace typecheck, community assertions, and `git diff --check` passed on the
  final Slice 4 tree.

## Non-goals

Claiming full WCAG conformance from an automated subset, duplicating export pixel parity in Firefox
or WebKit, expanding browser coverage to mobile engines, changing product scope, or publishing.
