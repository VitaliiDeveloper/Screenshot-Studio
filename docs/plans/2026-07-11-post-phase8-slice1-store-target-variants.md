# Post-Phase 8 corrective Slice 1 — store target variants

## Goal

Replace destructive store-target resizing with independently editable explicit variants while
preserving the flat screen model and one shared renderer/export path.

## Work

1. Add schema v6 `variantOf` + `storeTargetId` and guarded v5→v6 migration.
2. Add pure create/remove/fit operations with fresh ids and root preservation.
3. Separate root and variant workspace/connected groups.
4. Replace `Set exact` with Master/Open/Add variant/Remove controls.
5. Export roots at lead size and explicit variants at their exact target with independent numbering.
6. Update CLI single-export target defaults for variant screens.
7. Migrate active fixtures/examples/guides to v6 and update roadmap ownership.
8. Run targeted core/web/CLI checks plus only the exact E2E files required by changed browser
   behavior. Do not run the full browser suite locally; the `dev` → `main` integration PR owns it.

## Out of scope

- implicit ongoing root/variant synchronization;
- responsive constraints;
- unrelated Phase 9 creative candidates;
- release or publication work.
