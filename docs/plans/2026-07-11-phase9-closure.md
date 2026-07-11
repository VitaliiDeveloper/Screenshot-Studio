# Phase 9 closure implementation plan

1. Checkpoint Slice 1 and ratify the finite Phase 9 contract.
2. Implement each remaining slice in order: schema/model first, shared renderer second, authoring UI
   third, targeted unit/parity/editor verification fourth, and docs/examples last.
3. Use additive schema versions with sequential lossless migration; never widen persisted literals
   without a validator and migration test.
4. Keep browser verification proportional during implementation. Run exact files or leaf groups;
   reserve the complete composed gate for Phase 9 closure/integration CI.
5. End each slice with a logical commit so later work can be reviewed, reverted, or bisected without
   carrying the whole phase as one patch.
6. Close Slice 6 only after measured source/packed export evidence, accessibility, living examples,
   community/SPDX checks, and roadmap/public truth are green.
