# Example projects

These projects are small, editable v2 documents and living export fixtures:

- `connected-launch` — a three-screen English iPhone launch deck in connected mode. Its shapes
  deliberately cross screen boundaries while every store export remains an exact crop.
- `rtl-delivery` — paired English/Arabic locale groups using an embedded Noto Sans Arabic font and
  explicit LTR/RTL text direction.

Open or export either project from the repository root:

```bash
pnpm screenshots dev --project examples/connected-launch/app-store-screenshots.json
pnpm screenshots export --project examples/connected-launch/app-store-screenshots.json

pnpm screenshots dev --project examples/rtl-delivery/app-store-screenshots.json
pnpm screenshots export --project examples/rtl-delivery/app-store-screenshots.json
```

The assets are local to each example so the documents render without network access. Font license
texts travel beside the font files. `pnpm test:e2e:examples` validates both documents and exports
one exact, alpha-free store PNG from each.
