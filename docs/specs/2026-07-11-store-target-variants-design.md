# Store target variants design

## Status

Accepted as post-Phase 8 corrective Slice 1. This work is independent of any release decision and
removes a destructive editor interaction found during ordinary dogfood.

## Problem

The Store Targets inspector exposed `Set exact`, which replaced the active screen artboard while
leaving element geometry unchanged. The action therefore damaged the composition and autosaved the
result. The UI also implied that accepted store sizes were selectable variants even though schema
v5 represented only one artboard and element set per screen.

## Decision

Schema v6 keeps the flat `Screen[]` render contract and adds optional paired fields:

- `variantOf` — the root/master screen id;
- `storeTargetId` — the exact id from `store-specs.json`.

A root has neither field. A variant has both, points directly to a root, matches its
platform/device/locale, and is unique per root/target pair. Variants never chain.

Creating a variant deep-clones the root with fresh screen/element ids, fits the composition
uniformly into the exact target artboard, and persists the copy. Root and variant then edit
independently. Connected and isolated workspaces project root and target layers separately.

Bundle export keeps lead-size roots and additionally exports only explicitly created variants
against their own targets. Target numbering is independent, so a lead and a `6.5` variant can both
own slot `01` without a path collision.

## Alternatives rejected

- Mutating/rescaling the root: destructive and contradicts independent target authoring.
- A responsive constraint engine: unnecessary scope and a second layout model.
- Nested variant documents: duplicates the existing screen/render contract.
- Inferring target identity only from dimensions: brittle when store data changes or accepts aliases.

## Invariants

1. `Set exact` no longer exists.
2. Store-target actions never mutate the root artboard or elements.
3. v5 projects migrate losslessly by changing only `meta.schemaVersion`.
4. UI, CLI, connected projection, and export use the existing shared renderer.
5. Removing a root also removes its variants; removing a variant preserves the root.
6. Release planning is outside this slice.

## Verification

- schema/migration relationship tests;
- core create/remove/fit tests;
- bundle target/path/dimension tests;
- editor store/workspace tests;
- targeted editor E2E covering create, persisted exact dimensions, root preservation, and remove;
- full shared-contract closure gate after implementation.
