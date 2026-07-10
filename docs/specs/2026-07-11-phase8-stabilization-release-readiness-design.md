# Phase 8 — Stabilization and release readiness

Status: in progress. The Phase 7 baseline is complete, this dedicated stabilization contract is
recorded, Slice 1 failure/recovery hardening is complete, and Slice 2 cross-environment packaged
installation is next.

## Goal

Turn the completed Phase 6/7 baseline into a release candidate whose failure behavior,
cross-environment installation, sustained export reliability, resource use, accessibility, browser
behavior, store rules, and public documentation are supported by repeatable evidence. Phase 8 may
fix defects exposed by that evidence; it does not add product scope.

The phase ends at a release-ready artifact and an explicit go/no-go record. Publishing to a registry,
creating credentials, announcing the project, or promoting a release still requires an owner action
after the gate.

## Baseline evidence and gaps

Phase 7 closure recorded 53 unit files / 370 tests and 33 E2E files / 54 tests, including exact
alpha-free exports, living v5 examples, connected LTR/RTL group authoring, packaged installation,
and optional-skill bootstrap. That proves baseline behavior, but not release readiness:

- CI runs only on Ubuntu, Node 22, and Chromium. The package smoke contains a Windows bin branch,
  but no Windows or macOS CI evidence exercises it.
- The supported engine range is `>=22.13`; Node 22 is the minimum supported LTS and Node 24 is also
  LTS at Phase 8 start, but only Node 22 is tested.
- Export and server units prove ordinary `finally` cleanup, but there is no end-to-end fault matrix
  for mid-render failure, write failure, startup failure, unexpected host exit, or interruption.
- One packaged export is verified. There is no repeated/large-bundle soak, wall-time baseline, peak
  memory evidence, or leaked browser/server/temp-directory check across sustained work.
- Keyboard scenarios and accessible names exist, but there is no automated accessibility audit or
  representative Firefox/WebKit editor smoke. Those engines are editor compatibility targets, not
  alternate export renderers.
- Store dimensions are data and have source links, but release readiness needs a dated audit against
  the official Apple and Google rules rather than treating old constants as current forever.
- The artifact remains version `0.0.0` and private. There is no changelog, security policy,
  release checklist, or dry-run release manifest.

## Stabilization rules

1. **Evidence before fixes.** Every defect begins with a deterministic reproduction or a narrowly
   documented manual case. Fixes use the existing architecture and receive regression coverage.
2. **No expansion by stealth.** No schema version, element/background type, platform/device target,
   renderer, hosted service, or authoring feature is added in this phase. Findings that require new
   capability are recorded for Phase 9 unless they block safe use of the shipped baseline.
3. **Chromium remains the export engine.** Firefox and WebKit exercise editor load, navigation,
   persistence, and representative authoring only. They do not create a second pixel-parity promise.
4. **Release evidence is durable.** `docs/release-readiness.md` records the tested commit,
   environment, commands, thresholds, results, known limitations, and unresolved blockers. Ephemeral
   measurements do not become code comments.
5. **CI cost stays bounded.** The ordinary Ubuntu/Node 22 unit and Chromium gates remain the main
   per-change path. OS/Node package matrices, cross-browser smoke, soak, and release audit run in
   targeted jobs or the release-candidate workflow rather than multiplying the full suite.
6. **No false atomicity claim.** Recovery tests must state exactly which inputs and prior outputs are
   preserved. If a multi-file publish cannot be made transactional on every supported filesystem,
   the CLI must use staging/rollback or document and surface the narrower guarantee explicitly.

## Failure and recovery contract

Slice 1 builds the fault matrix around the shipped CLI and shared render host:

- project JSON and source assets are never mutated by export, including every forced failure;
- a render failure occurs before bundle publication and leaves pre-existing successful output
  untouched;
- output generation uses a private staging location, validates the complete PNG/ZIP set there, and
  removes staging data on success or failure before publishing generated destinations;
- publish failure restores any generated destination that existed before the run and removes newly
  introduced generated destinations, without deleting unrelated files in the chosen output folder;
- page, context, browser, server child, and extracted packaged-host directory close on success,
  render/write failure, startup failure, and supported termination paths;
- unexpected render-host exit fails promptly with actionable process context rather than waiting for
  the generic HTTP timeout;
- cleanup is idempotent and does not hide the primary error. A cleanup failure is reported as
  secondary context.

Tests inject failures through narrow filesystem/process/render dependencies. They do not add a
production debug API or rely on timing-only process inspection.

## Supported environment contract

The release candidate supports Node 22.13+ on Linux, macOS, and Windows. The bounded matrix is:

| Purpose | OS | Node | Proof |
|---------|----|------|-------|
| Minimum-engine package contract | Ubuntu, macOS, Windows | 22 | pack, clean install, `init`, management command, packaged-host exact export, cleanup |
| Newer-LTS compatibility | Ubuntu | 24 | the same package smoke plus unit/typecheck gate |
| Shared render/export parity | Ubuntu | 22 | existing headed/headless Chromium parity and full Chromium E2E |
| Local release-candidate dogfood | macOS | 22 or 24, recorded exactly | source and packed workflows over living projects |

Node Current releases are informational until they become LTS. Supporting `>=22.13` does not mean
the full browser suite must run on every Node/OS pair. OS-specific exclusions, such as privileged
symlink creation on Windows, must be explicit and may not skip the package install/export proof.

## Reliability and performance contract

Slice 3 adds two opt-in, deterministic harnesses:

- a **large-bundle soak** renders a generated project composed only of current v5 types, multiple
  exact groups/locales, and enough entries to exercise browser-context reuse and ZIP publication;
- a **repeat soak** runs the packed CLI export repeatedly and checks exact dimensions/no alpha,
  stable output hashes for identical inputs, process exit, and packaged-host temp cleanup.

The first implementation records at least five controlled baseline samples before freezing budgets
in the slice plan. The release gate then reports median wall time and peak RSS, and fails on a
ratified material regression rather than an arbitrary absolute number. Correctness, cleanup, or
monotonic memory-growth failures are blockers even when elapsed time stays inside budget. Benchmark
output is concise machine-readable JSON plus a human summary; it is not part of project JSON.

## Accessibility and browser contract

The editor release surface receives:

- an automated audit of the shell, panels, menus, dialogs, alerts, and form controls at desktop and
  compact viewports, with zero serious or critical violations in the tested states;
- keyboard-only paths for open/close, focus containment/restoration, canvas-mode feedback,
  selection/group actions, locale switching, and export initiation;
- visible focus and readable status/error announcements in the same states;
- a representative editor smoke in Playwright Chromium, Firefox, and WebKit covering load, a basic
  edit, persistence, reload, and export-dialog reachability.

Canvas pixels are not exposed as an accessible document model in Phase 8. Layers and Inspector
remain the operable semantic surfaces for canvas content; changing that model would be expansion.

## Store and release-candidate contract

Before the artifact is called release-ready:

- every supported `store-specs.json` preset is checked against the current official Apple or Google
  rule and the audit date/source is recorded; unsupported new device classes stay in Phase 9;
- production dependencies, licenses/NOTICE, packed file allowlist, artifact size, and required
  runtime files are audited from the actual tarball;
- the CLI version is changed from `0.0.0` only in the release-artifact slice, with root/package/docs
  values kept consistent and a dry-run tarball used for all final checks;
- `CHANGELOG.md`, `SECURITY.md`, install/upgrade/uninstall notes, known limitations, and a maintainer
  release checklist exist and agree with the live artifact;
- package publication metadata may be prepared, but registry authentication and `npm publish` are
  not executed without explicit owner authorization.

## Execution slices

1. **Failure/recovery hardening.** Add the injected fault matrix, staged/rollback-safe generated
   output publication, prompt unexpected-host failure, and real cleanup evidence.
2. **Cross-environment packaged install.** Prove the built package on Linux/macOS/Windows at Node 22
   and on Ubuntu at Node 24 without duplicating the full browser gate across the matrix.
3. **Export soak + performance budgets.** Add large/repeated packed-export harnesses, record a
   controlled baseline, ratify time/RSS budgets, and block leaks or nondeterministic output.
4. **Accessibility + browser coverage.** Add automated accessibility states, keyboard/focus
   regressions, and representative Chromium/Firefox/WebKit editor smoke while keeping export on
   Chromium.
5. **Store/dependency release audit.** Re-verify current supported store presets and audit the actual
   production dependency, license, package-content, and artifact-size surfaces.
6. **Release artifact + candidate docs.** Ratify the candidate version/package metadata and add the
   changelog, security policy, install/upgrade/uninstall guidance, limitations, and release checklist.
7. **Sustained dogfood + phase closure.** Exercise source and packed workflows over living projects,
   close the evidence ledger, run the release-candidate matrix and one full repository gate, and
   record an explicit go/no-go decision. This declares readiness only; it does not publish.

## Verification policy

- Slice 1 runs exact CLI export/render/server unit files plus focused packaged failure E2E. The CLI
  suite and package E2E group close the slice; unrelated editor E2E does not.
- Slice 2 adds one package-matrix workflow. Minimum Node runs on all three OSes; Node 24 runs on
  Ubuntu. Existing Ubuntu Chromium parity remains a separate job.
- Slice 3 keeps soak/performance opt-in during iteration and mandatory for release-candidate closure.
  Normal unit CI does not inherit the long-run cost.
- Slice 4 runs the dedicated accessibility/browser group. Only representative editor behavior is
  multiplied across engines; parity/export files remain Chromium-only.
- Slice 5 uses deterministic local checks where possible and records dated official-source review
  where the rules cannot be safely fetched in an offline test.
- Slice 6 validates the packed candidate from a clean temporary consumer and checks documentation
  assertions. It does not publish.
- Slice 7 runs the complete `test + lint + typecheck + test:e2e` gate once, plus the package matrix,
  cross-browser/accessibility group, soak budgets, community/SPDX checks, and `git diff --check`.

## Phase gate

Phase 8 is complete only when all seven slices are complete and `docs/release-readiness.md` contains:

1. a green failure/recovery matrix with no project mutation or leaked runtime resources;
2. green packed install/init/export proof for the supported OS/Node matrix;
3. deterministic soak output inside the ratified time/RSS budgets;
4. zero serious/critical audited accessibility violations and green representative browser smoke;
5. a dated official store-spec audit and green production package/license checks;
6. a clean candidate tarball whose version, contents, docs, and limitations agree;
7. sustained source/packed dogfood evidence and one green full closure gate;
8. an explicit `GO` decision with no unresolved release blocker, or `NO-GO` with Phase 8 left open.

## Out of scope

New schema fields or versions, additional element/background types, richer visual properties,
additional device/platform presets, a second renderer, responsive layout, collaboration/cloud
storage, hosted AI, semantic image segmentation, telemetry collection from users, registry
credentials, publication, release announcements, and Phase 9 product work.
