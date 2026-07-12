# Example projects

These projects are small, editable v6 documents and living authoring/export fixtures:

- `connected-launch` — a three-screen English iPhone launch deck in connected mode. Its shapes and
  decorative image deliberately cross screen boundaries, while trusted icons and an editable
  rating-badge group demonstrate the Phase 7 creative primitives.
- `rtl-delivery` — two-screen English and Arabic connected locale groups using an embedded Noto
  Sans Arabic font, explicit LTR/RTL text direction, and group/icon overflow across exact crops.

Open or export either project from the repository root:

```bash
pnpm screenshots dev --project examples/connected-launch/app-store-screenshots.json
pnpm screenshots export --project examples/connected-launch/app-store-screenshots.json

pnpm screenshots dev --project examples/rtl-delivery/app-store-screenshots.json
pnpm screenshots export --project examples/rtl-delivery/app-store-screenshots.json
```

The assets are local to each example so the documents render without network access. Font license
texts travel beside the font files. `pnpm test:e2e:examples` validates both documents, exports one
exact alpha-free store PNG from each, and edits a temporary RTL example copy through the accessible
locale, Layers, and keyboard group controls.
