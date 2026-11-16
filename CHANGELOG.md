# Changelog

All notable changes to `@screenshot-studio/cli` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-11-16

### Added

- `screenshots --version` and `screenshots --help`.
- `screenshots schema` prints the project JSON Schema, generated from the strict project schema.
- Sandboxed agent runs render through the running editor: `export` and `check --render` route
  to it from inside a run.

### Changed

- CLI flags are declared per command, so a subcommand now rejects a flag meant for a sibling
  subcommand instead of ignoring it.
- `screenshots check` exits `2` when it cannot run, so CI can tell that from blocking issues.
- `--port` accepts only a decimal number from 1 to 65535.

### Fixed

- Editor focus, dialog, undo, and `Apply to` scope fixes, and stricter handling of invalid
  project imports and exact-size screen sets.
- On Windows the Agent panel says the editor cannot start agents there yet, instead of reporting
  installed agents as not installed.

### Security

- `next` 16.4.1, `sharp` 0.35.5, and `zod` 4.6.6 clear the high and critical advisories in
  production dependencies.
- The editor API refuses foreign-host and cross-site requests, and project assets are served
  only as loopback image and font files.
- Store credentials stay out of the render host environment, and the store key folder is closed to
  agent sandboxes.

## [0.1.0] - 2026-11-01

First public release: the Screenshot Studio editor and CLI in one npm package.

### Added

- A visual editor and the `screenshots` CLI (also `ss-studio`) on one shared browser renderer, so
  the approved preview is the PNG exported at the exact App Store, Google Play, Microsoft Store,
  or Web size.
- `app-store-screenshots.json`, a strict, git-trackable project document covering platforms,
  layouts, exact-size variants, locales, and RTL.
- `screenshots setup` to download the pinned Chromium build used for exact exports, once.
- `screenshots upload` to send exports to App Store Connect and Google Play. It is human-only and
  refuses to run inside agent sessions.
- Local-first operation with no cloud service, telemetry, or bundled AI provider. The only
  automatic network calls are the Chromium download you approve and an optional daily update
  check that `SCREENSHOTS_NO_UPDATE_CHECK=1` turns off.

[Unreleased]: https://github.com/VitaliiDeveloper/Screenshot-Studio/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/VitaliiDeveloper/Screenshot-Studio/releases/tag/v0.1.1
[0.1.0]: https://github.com/VitaliiDeveloper/Screenshot-Studio/releases/tag/v0.1.0
