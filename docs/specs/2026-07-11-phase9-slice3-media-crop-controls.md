# Phase 9 Slice 3 — media crop controls

## Goal

Let authors frame screenshot and decorative-image content without changing the element box. Persist
one renderer-independent crop literal and preserve UI/CLI pixels.

## Contract

- Schema v8 adds optional `crop: { x, y, zoom }` to `screenshot` and `image` leaves.
- `x` and `y` are normalized focal coordinates in `0…1`; `zoom` is bounded to `1…4`.
- Missing crop means `{ x: 0.5, y: 0.5, zoom: 1 }`.
- Crop applies only to `cover`. `contain` ignores the literal without deleting it, so switching fit
  is lossless and repeatable.
- The shared node mapper computes the crop window for editor and static/CLI rendering.
- Inspector exposes human-readable focal percentages, zoom, and reset only for cover media.

## Boundaries

No freeform crop rectangle, rotation inside the media box, masks, filters, object detection, or
per-device responsive crop. Background-image focal controls remain separate from element media.
