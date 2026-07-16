# Screenshot Studio CLI

Built command-line distribution for Screenshot Studio. It manages strict App Store, Google Play,
and Microsoft Store screenshot projects, opens the local editor, and exports exact store PNGs
through the packaged shared web renderer.

After installing the `0.1.0` dry-run package artifact and its matching Chromium builds:

```bash
pnpm add --global ./screenshot-studio-cli-0.1.0.tgz
pnpm dlx playwright@1.61.1 install chromium chromium-headless-shell
screenshots init --dir ./my-app-screenshots
cd ./my-app-screenshots
screenshots dev
screenshots export
```

`dev`, `screen`, and `export` accept `--store-specs <path>` to override the packaged
`store-specs.json`. Bundle export writes every locale root at its device lead target plus its
explicit persisted variants. A single-screen export resolves an explicit `--size` first, then the
screen’s persisted `storeTargetId`, then its device lead target.

`screen add --size` accepts only a device lead target. `screen rm <id>` protects the last locale
root and rejects roots that still own variants; add `--cascade` to remove a root together with its
variants.

Node.js 22.13 or newer is required. The package is local-first and does not include an AI provider.
The artifact carries its Apache-2.0 `LICENSE`, `NOTICE`, and generated third-party notices. Presence
of this package manifest does not mean a registry release has been published. See the repository's
`docs/releasing.md` for upgrade, uninstall, limitations, and the owner-only publication boundary.
