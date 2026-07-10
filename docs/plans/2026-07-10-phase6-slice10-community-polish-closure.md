# Phase 6 Slice 10 — Community polish and phase closure

Status: complete. The production editor capture, community/license surfaces, living examples,
packaged NOTICE, scoped SPDX policy, public-doc alignment, and Phase 6 closure gate have passed.

## Goal

Close Phase 6 as a truthful open-source foundation: show the real editor, document the current
source/artifact install paths, make contribution and license expectations explicit, ship living
examples, and catch source/license/example drift automatically. This is baseline work, not a public
release claim.

## Deliverables

- [x] Capture a compact README GIF from the real local editor and link it from README.
- [x] Document source checkout, locally built package, and optional skill installation without
  claiming a registry publication.
- [x] Add `CONTRIBUTING.md`; verify the existing Apache-2.0 `LICENSE` and `NOTICE` surfaces.
- [x] Add two self-contained v2 example projects: a connected English launch deck and an Arabic
  RTL deck with local font licensing.
- [x] Apply and enforce SPDX headers over authored `.ts`, `.tsx`, and `.mjs` sources while excluding
  generated/vendor/media/JSON/lockfile surfaces.
- [x] Align `AGENTS.md`, README, architecture, editor docs, roadmap, and the Phase 6 design status.

## Verification

- `pnpm test:e2e:examples` validates current v2 JSON and exports one exact alpha-free store PNG per
  example through the shared renderer.
- `pnpm check:spdx` enforces the scoped source-header policy.
- A focused browser pass verifies the README GIF scenario at its captured viewport.
- Phase closure runs exactly one full `pnpm test`, `pnpm lint`, `pnpm typecheck`, and
  `pnpm test:e2e` gate, plus `pnpm test:e2e:package`, `pnpm test:e2e:skill`, example, SPDX, and docs
  consistency checks where the unfiltered gate does not prove packaged/discovery artifacts.

## Closure evidence

- Production browser capture: 6 real editor states at 1280×720, encoded to a 960×540 / 754 KiB
  README GIF; no browser console errors.
- Unit gate: 48 files / 303 tests passed.
- Full E2E gate: 24 files / 45 tests passed, including packaged CLI, optional skill, connected/RTL
  examples, editor, parity, export, and locale workflows.
- Packaged artifact test passed with the explicit 9-file surface including `LICENSE` and `NOTICE`.
- `pnpm lint`, `pnpm typecheck`, `pnpm check:community`, `pnpm check:spdx`, and
  `git diff --check` passed.

Phase 6 completion does not claim a public release. Phase 7 completes the baseline; Phase 8 owns
stabilization and release-readiness evidence.
