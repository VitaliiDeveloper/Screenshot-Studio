# Changelog

All notable user-facing changes are recorded here. The project follows Semantic Versioning once a
candidate is published.

## [Unreleased]

### Added

- Complete project-surface expansion: independent output families, gradient/project-image backgrounds,
  media focal crop/zoom, text shadow, ellipse/gradient/stroke shapes, and trusted frame presets.
- Phase 9 living-example, renderer parity, authoring, accessibility, and packed performance evidence.

### Changed

- Reset the unpublished project format to one complete strict schema v1 baseline, removed internal
  development migrations, and renamed active fixtures by behavior.
- Consolidated five new browser harnesses into two ownership suites to retain coverage with less
  repeated Next.js/Playwright startup work.

## [0.1.0] - 2026-07-11 (release candidate)

This version is a dry-run candidate. It has not been tagged, published to npm, or announced as a
public release.

### Added

- Strict v5 screenshot projects with connected/isolated canvases, deterministic fonts, themes,
  templates, locales/RTL, groups, decorative images, trusted icons, and editable badge groups.
- A visual Next.js editor and one shared Chromium render/export path used by both UI and CLI.
- Installable `screenshots` CLI workflows for project setup, screen/locale/font/theme management,
  import, exact single/bundle export, and local non-destructive image processing.
- Living connected/RTL examples, project-local agent guidance, and an optional thin Codex skill.
- Failure/recovery, cross-OS package, soak/performance, accessibility/browser, and production
  package/license audit coverage for the Phase 8 candidate.

### Changed

- Candidate package metadata is versioned consistently at `0.1.0`, and Playwright/Sharp runtime
  dependencies are pinned to the versions exercised by release-candidate checks.
- The standalone render-host archive is OS-neutral; the installed platform's Sharp runtime is
  materialized from the consumer installation before host startup.

### Fixed

- Failed exports preserve prior generated output through staging/rollback and clean up acquired
  browser, process, and temporary resources without hiding the primary failure.
- Package archive links work on POSIX and unprivileged Windows installations without embedding
  build-machine-native Sharp, libvips, or `fsevents` payloads.

[0.1.0]: https://github.com/VitaliiDeveloper/Screenshot-Studio/releases/tag/v0.1.0
