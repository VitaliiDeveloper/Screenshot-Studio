# Screenshot Studio CLI

Built command-line distribution for Screenshot Studio. It manages strict Apple App Store, Google
Play, Microsoft Store, and Web screenshot projects, opens the local editor, and exports exact output
PNGs through the packaged shared web renderer.

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

`screenshots export --profile web-share` packages the same rendered PNGs into a portable local-only
static review/campaign directory and ZIP. Web Share is independent of the Web platform.

`screen add --size` accepts only a device lead target. `screen rm <id>` protects the last locale
primary. Under the default independent policy it preserves paired exact-size screens as standalone;
add `--cascade` to explicitly remove a primary together with its paired variants. Screen mutations
use the core persisted slot policy: independent exact-size rows remain
independent, while `Keep 1:1` mirrors logical add/delete/order across created sizes without sharing
screen content.

Node.js 22.13 or newer is required. The package is local-first and does not include an AI provider.
The artifact carries its Apache-2.0 `LICENSE`, `NOTICE`, and generated third-party notices. Presence
of this package manifest does not mean a registry release has been published. See the repository's
`docs/releasing.md` for upgrade, uninstall, limitations, and the owner-only publication boundary.
