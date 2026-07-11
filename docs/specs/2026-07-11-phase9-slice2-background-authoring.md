# Phase 9 Slice 2 — background authoring

## Goal

Ship strict solid, linear-gradient, and project-image artboard backgrounds through one persisted
model and one shared UI/CLI renderer.

## Persisted v7 contract

- `solid`: `{ type, color }`.
- `linear-gradient`: `{ type, from, to, angle }`, where angle is finite and normalized to `0…360`.
  `0` runs left-to-right and `90` top-to-bottom.
- `image`: `{ type, assetUrl, fit, color }`; `fit` is `cover | contain` and `color` is the opaque
  fallback/letterbox colour.
- v6 migrates losslessly to v7 by version bump because every v6 background is already valid solid
  v7 data. A mislabeled v6 document containing future background types is rejected, not blessed.

## Rendering and authoring

- A pure `backgroundToNodeConfig` maps every background to native Konva nodes and is consumed by
  both static export and the interactive EditorStage.
- Image backgrounds are preloaded through the existing project-image cache and asset route. Missing
  images render the persisted opaque fallback colour without blocking the stage-ready gate.
- The no-selection Inspector switches type, edits literal fields, and opens the existing secure
  project asset picker for image selection.
- Connected mode keeps the existing rule: all backgrounds paint first in screen order, then all
  elements. Background images do not create a second render path.

## Verification

- Schema/migration tests cover strict variants, defaults, legacy migration, and mislabeled input.
- Node-config and asset-collection units cover gradient geometry, image fit/fallback, and traversal.
- Editor-store/Inspector tests cover persisted type and field changes.
- Parity E2E covers solid/gradient/image backgrounds in connected exact crops and alpha-free export.

## Out of scope

- Radial or multi-stop gradients, background opacity, filters, blend modes, video, remote URLs, and
  focal-point crop controls (owned by Slice 3).
