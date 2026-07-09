# Phase 3 Slice 3 — implementation plan

1. Extract the CLI font ingest/removal implementation into an exported Node service without
   changing command behavior or project/file formats.
2. Add `/api/fonts` with list, uploaded-file add, Google add, and remove handlers backed by the
   shared service; cover it with route tests.
3. Add editor-store support for replacing font assets and atomically applying a font identity.
4. Add a toolbar Fonts dialog with upload, Google add, preview/list, apply, and remove behavior.
5. Replace the text inspector's free-form family/weight controls with the registered identity
   picker, including an unresolved-current-state label.
6. Add focused unit/e2e coverage and run lint, typecheck, unit tests, and the relevant editor
   e2e/parity tests.
7. Mark Slice 3 implemented in the roadmap and agent-facing status only after verification.
