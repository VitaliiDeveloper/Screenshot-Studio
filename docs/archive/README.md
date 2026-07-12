# Documentation archive

This archive retains implementation history without presenting it as the current product contract.
No document here was deleted: tracked files were moved with Git history intact, and references were
updated to their archived locations.

## Status and retention rules

- `plans/` contains completed task-by-task implementation plans from Phases 1–7, the corrective
  store-target work, finite Phase 9 slices, and completed post-closure editor refinements. Their
  status is **completed implementation history**.
- `specs/` contains designs superseded by the strict v10 as-built contract or by a retained
  phase-level decision document. Their status is **superseded implementation design**.
- Archived documents remain useful for rationale, review history, and reconstruction. They are not
  normative for current fields, commands, UI behavior, supported environments, or release status.
- Closure and release evidence stays outside the archive. A task plan stays outside when its dated
  results are part of the Phase 8 `GO`, a phase-closure ledger, or another active evidence chain.
- A design stays outside when production source cites it for a non-obvious invariant or current
  documentation still uses it as the authoritative phase-level contract.
- The ignored `docs/superpowers/` workspace contains local planning artifacts. The active moderate
  cleanup design and plan, and the other ignored local artifacts, are intentionally not moved or
  classified as tracked archive content.

## Archived groups

| Directory | Contents | Historical status |
|-----------|----------|-------------------|
| `plans/` | Phase 1–3 slices | Completed implementation history |
| `plans/` | Phase 4–7 non-closure slices | Completed implementation history |
| `plans/` | Corrective store-target implementation | Completed implementation history |
| `plans/` | Phase 9 implementation slices | Completed implementation history |
| `plans/` | Output-family switcher and Focus/Overview transition | Completed workflow-refinement history |
| `specs/` | Phase 1–3 slice designs | Superseded by v10 architecture/editor contracts |
| `specs/` | Phase 7 image, icon, and badge slice designs | Superseded by v10 architecture/editor contracts |
| `specs/` | Phase 9 slice designs | Superseded by finite Phase 9 closure and v10 contracts |
| `specs/` | Responsive toolbar, output switcher, and canvas transition designs | Completed presentation/workflow history |

## Current contract map

- [Architecture and strict v10 model](../architecture.md)
- [As-built editor behavior](../editor.md)
- [Roadmap status and durable boundaries](../roadmap.md)
- [Release candidate lifecycle](../releasing.md)
- [Testing policy](../testing.md)
- [Phase 8 evidence ledger](../release-readiness.md)
- [Phase 9 closure evidence](../phase9-closure.md)

Retained non-obvious phase contracts remain in `docs/specs/`; retained closure and release records
remain in `docs/plans/`. When an archived document conflicts with one of those surfaces or with the
enforced Zod schema, the current schema and current-contract document win.
