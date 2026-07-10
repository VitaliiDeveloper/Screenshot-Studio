# Phase 7 Slice 4 — Decorative image contract

Status: ratified for implementation.

## Decision

Schema v4 adds one leaf `image` element for arbitrary project-local decorative raster assets. It is
semantically distinct from `screenshot`: screenshots represent captured product UI, while images
represent logos, illustrations, textures, and decorative cutouts. Both reuse the same deterministic
decoded-image renderer and asset-security boundary.

```ts
ImageElement = TransformBase & {
  type: "image";
  assetUrl: string;                 // non-empty project-relative asset path
  fit: "cover" | "contain";        // default "contain"
  cornerRadius: number;             // default 0, non-negative
}
```

## Rendering

- `contain` is the authoring default so decorative assets are not silently cropped. It centres the
  decoded pixels inside the element box and preserves source aspect ratio.
- `cover` fills the element box and applies the existing deterministic centred source crop used by
  screenshots. No browser CSS object-fit path is introduced.
- Alpha is preserved inside ordinary render composition. The final store export remains the existing
  opaque exact screen crop.
- Missing/failed assets render the same visible deterministic placeholder as screenshots.
- UI, static renderer, and CLI export all consume the same `elementToNodeConfig` branch and preloaded
  image cache. No second render or loader exists.

## Model and migration

- `ImageElement` joins `LeafElement`, so it can be a one-level group child and automatically
  participates in cloning, RTL placement, template validation, and generic leaf traversal.
- `collectImageUrls` includes `image.assetUrl`. Themes preserve image literals unchanged because
  image has no theme-applied visual token.
- v3→v4 changes only `meta.schemaVersion`; every valid v3 document is already structurally valid v4.
  A v3 document containing `type: "image"` is rejected rather than blessed as legacy input.
- Group uniform resize scales image `cornerRadius` with its geometry.

## Authoring

- The existing secure project asset picker gains an Image mode and inserts `createImageElement` at
  the deterministic origin.
- Add → Media enables Image. Inspector exposes Asset URL, Fit, and Corner radius. Layers uses the
  image icon and all ordinary lifecycle/group actions.

## Proof

1. Strict schema/default/refusal and sequential v1→v2→v3→v4 migration tests.
2. Factory, asset collection, group resize, template, theme-preservation, and node-config tests.
3. Editor picker/insertion/inspector persistence coverage.
4. Headed/headless exact image parity for contain, cover crop, transparency composition, group
   traversal, and connected crop behavior.
