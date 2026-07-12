# Phase 9 closure evidence

Phase 9 is complete on 11 July 2026. This closes the finite product-expansion plan; it does not tag,
publish, or announce a release. The earlier Phase 8 release-readiness evidence remains a historical
candidate snapshot, and any later publication still requires an explicitly authorized fresh release gate.

## Delivered slices

1. Independent iPhone, iPad, macOS, tvOS, watchOS, Android phone, and Windows desktop output families.
2. Strict solid, linear-gradient, and project-image artboard backgrounds.
3. Cover-only normalized focal point and bounded media crop zoom.
4. Text shadow plus rect/ellipse shape gradient and stroke styling.
5. Trusted phone, tablet, desktop, TV, and watch frame presets.
6. Current-schema living examples, consolidated browser ownership, accessibility, performance, and docs.

## Verification evidence

- Targeted slice unit suites, workspace typecheck, full ESLint, and diff checks passed at every checkpoint.
- The final non-browser gate passed 58 files / 442 tests, workspace typecheck, ESLint, community,
  SPDX, and diff validation.
- Consolidated Phase 9 render parity and authoring suites passed 2 files / 2 cases. They retain the
  same browser-only contracts while reducing repeated server/browser harnesses from five files to two;
  locally observed harness test time fell from about 31.1 seconds to 13.8 seconds (about 56%).
- Living examples passed 1 file / 2 exact alpha-free exports and now assert v10 background, crop,
  styling, frame, connected, and RTL literals.
- Accessibility passed 1 file / 2 cases with no serious or critical desktop/compact Axe findings.
- Relevant browser leaf gates passed: element parity 5/5, authoring 9/9, export 3 files / 5 cases,
  living examples 1/2, accessibility 1/2, and optional skill/bootstrap 1/3.
- Three-sample packed export soak on Darwin 25.5 arm64, Node 24.16.0, Apple M3 Pro:
  - 12 screens: 9,737 ms median, 1,151.2 MiB peak RSS, within 10,500 ms / 1,350 MiB budgets;
  - repeated 3 screens: 3,451 ms median, 894.8 MiB peak RSS, within 4,200 ms / 1,200 MiB budgets;
  - neither workload showed material monotonic RSS growth.
- The complete unit, community, SPDX, lint, typecheck, and relevant browser leaf gates are the local
  closure gate. Repository policy leaves the complete `pnpm test:e2e` browser aggregate to the
  `dev` → `main` integration CI rather than duplicating it locally.

## Closure decision

**COMPLETE.** The finite Phase 9 scope and its explicit YAGNI exclusions are satisfied. Release
publication remains independent and unauthorized.
