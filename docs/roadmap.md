# Roadmap & Execution Status

Current phase status, durable sequencing decisions, and evidence boundaries.
Version 2.0, 12 July 2026.

## Current status

Implementation and verification are complete through the finite Phase 9 scope. The enforced
project contract is strict schema v1. Phase 8's retained candidate evidence is green and records a
`GO — release ready` decision; Phase 9's release-independent expansion closure is also green.

This is baseline and candidate completion, not publication. No Git tag, npm registry publication,
GitHub release, or announcement is implied or authorized by this document.

| Phase | Outcome | Status |
|-------|---------|--------|
| 0 | Strict schema and one-browser-renderer UI/CLI parity proof | Complete |
| 1 | Interactive web editor and shared element mapper | Complete |
| 2 | Store-ready bundle export and CLI management | Complete |
| 3 | File-backed fonts, baked themes, and templates | Complete |
| 4 | Complete locale sets, explicit RTL, and safe multi-locale export | Complete |
| 5 | Project-local agent guidance and deterministic local asset processing | Complete |
| 6 | Connected canvas, history, guides, media insertion, packaged CLI, and community surfaces | Complete |
| 7 | Owner-aware multi-selection, one-level groups, images, icons, and badge compositions | Complete |
| 8 | Stabilization, cross-environment package proof, audits, retained candidate, and release readiness | Complete; `GO` |
| Corrective Slice 1 | Independent exact store-target variants without root mutation | Complete |
| 9 | Output families, backgrounds, media crop, styling, frame presets, and workflow/performance closure | Complete |

## Durable sequencing and decision boundaries

- **One render path.** UI and CLI render the same Konva stage in Chromium. A lighter second renderer
  is not an optimization option because it would reopen parity.
- **Strict schema first.** New persisted or render-affecting behavior starts with an explicit schema,
  shared-renderer, and parity contract. Future ideas are not valid v1 fields. Compatibility
  migrations begin only after a published project format creates a supported upgrade boundary.
- **Store targets are independent.** Root/master screens are never resized in place by output or
  exact-target creation. Explicit non-lead sizes use paired `variantOf`/`storeTargetId` screens.
- **Connected ownership stays local.** Elements remain owned by one screen in owner-local
  coordinates; connected rendering projects exact groups and returns exact screen crops.
- **Groups stay one level.** Groups contain leaves, do not nest, and do not clip.
- **Themes, templates, and agent help are inputs.** They produce ordinary literal project JSON and
  never become a second render or persistence model.
- **Publication is separate.** Candidate checks and `GO` evidence do not authorize a tag, registry
  authentication, publication, GitHub release, or announcement.
- **Future expansion is evidence-driven.** Work beyond finite Phase 9 requires a new scoped design,
  parity impact assessment, verification plan, and explicit authorization; it does not silently
  reopen a completed phase.

## Current contracts

- [Architecture and strict v1 technical contract](architecture.md)
- [As-built editor contract](editor.md)
- [CLI and project workflow](../AGENTS.md)
- [Testing policy](testing.md)
- [Release candidate lifecycle and publication boundary](releasing.md)
- [Phase 4 locale and RTL contract](specs/2026-07-10-phase4-locales-rtl-design.md)
- [Phase 5 agent-workflow boundary](specs/2026-07-10-phase5-agent-workflows-design.md)
- [Connected-canvas contract](specs/2026-07-10-phase6-connected-canvas-completion-design.md)
- [One-level group model](specs/2026-07-10-phase7-group-model-design.md)
- [Store-target variant contract](specs/2026-07-11-store-target-variants-design.md)
- [Phase 8 stabilization and release-readiness contract](specs/2026-07-11-phase8-stabilization-release-readiness-design.md)
- [Finite Phase 9 closure boundary](specs/2026-07-11-phase9-closure-design.md)

The source-cited [device-frame geometry decision](specs/2026-07-04-phase1-slice3-device-frame-design.md)
also remains outside the archive because production renderer comments point to its non-obvious slot
and geometry contract.

## Closure and release evidence

- [Phase 4 export hardening and closure](plans/2026-07-10-phase4-slice5-export-hardening-closure.md)
- [Phase 5 dogfood and closure](plans/2026-07-10-phase5-slice4-dogfood-closure.md)
- [Phase 6 community polish and closure](plans/2026-07-10-phase6-slice10-community-polish-closure.md)
- [Phase 7 baseline closure](plans/2026-07-11-phase7-slice7-baseline-closure.md)
- [Phase 8 cumulative evidence ledger](release-readiness.md)
- [Phase 8 final closure decision](plans/2026-07-11-phase8-slice7-phase-closure.md)
- [Phase 9 release-independent closure evidence](phase9-closure.md)
- [Phase 9 finite closure plan](plans/2026-07-11-phase9-closure.md)

The individual Phase 8 slice records remain in `docs/plans/` because they contain dated package,
performance, accessibility, store, license, and candidate evidence supporting the retained `GO`.
