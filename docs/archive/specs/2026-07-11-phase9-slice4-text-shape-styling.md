# Phase 9 Slice 4 — text and shape styling

## Goal

Add the highest-value deterministic styling missing from existing leaves without introducing a
generic effects graph or a second renderer.

## Contract

- Schema v9 adds optional strict text `shadow { color, blur, offsetX, offsetY, opacity }`.
- Shape `kind` becomes `rect | ellipse`; optional `stroke { color, width }` and optional two-stop
  `gradient { from, to, angle }` augment the existing literal solid `fill` fallback.
- One shared NodeConfig mapping supplies Konva shadow, stroke, and gradient props to UI and CLI.
- Inspector edits and clears each optional style atomically; theme application continues to update
  the literal solid fallback and does not invent or remove optional styling.

## Boundaries

No arbitrary paths, blobs, multiple gradient stops, radial gradients, inner shadows, filters,
blend modes, or reusable effect references.
