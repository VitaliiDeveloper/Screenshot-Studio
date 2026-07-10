# Phase 7 Slice 5 — Deterministic vector icon contract

Status: ratified for implementation.

## Decision

Schema v5 adds a strict editable `icon` leaf backed by a small built-in registry of trusted,
normalised SVG path data. Project JSON stores only an icon id and visual literals; it never stores
raw SVG/XML, URLs, scripts, styles, filters, external references, or browser-parsed markup.

```ts
IconElement = TransformBase & {
  type: "icon";
  icon: "check" | "heart" | "sparkles" | "star";
  color: HexColor;
  strokeWidth: number; // positive, default 2
}
```

This is the safe built-in/SVG contract: the implementation owns the SVG path registry, while
documents select a stable id. Arbitrary project-local SVG import remains out of scope until there
is a separately ratified sanitisation, canonicalisation, and asset-lifecycle contract.

## Rendering

- Registry paths use a `24×24` view box and deterministic path strings in core.
- `elementToNodeConfig` returns one logical non-clipping Group containing a transparent selection
  box and a Konva Path scaled to the persisted width/height.
- `strokeScaleEnabled: false` keeps `strokeWidth` in screen pixels; line cap/join are round. Group
  uniform resize scales the persisted stroke width so grouped icons keep their visual proportion.
- UI, static render, and CLI export instantiate the same NodeConfig Path. No DOM SVG, font glyph,
  external icon package, or second raster path participates in output.

## Model and migration

- `IconElement` joins `LeafElement`, so groups, templates, cloning, RTL placement, traversal, and
  id freshness work through the existing one-level leaf contract.
- Themes preserve icon literals unchanged; icon colour remains directly editable.
- v4→v5 changes only `meta.schemaVersion` for valid v4 documents. A v4 document containing an
  `icon` at any tree depth is rejected instead of being blessed as legacy data.

## Authoring

- Add → Icon inserts a deterministic star at the ordinary origin.
- Inspector exposes built-in Icon, Color, and Stroke width controls.
- Layers, selection, group lifecycle, history, and save need no icon-specific state.

## Proof

1. Strict schema/default/refusal and sequential migration tests.
2. Registry exhaustiveness, factory, node mapping, group resize, template/theme, and editor-store tests.
3. Add/Inspector/reload E2E plus UI/static/headed/headless exact parity, including grouped and
   connected-crop icons.
