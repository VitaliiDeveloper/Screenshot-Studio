# Screenshot Studio CLI

Built command-line distribution for Screenshot Studio. It manages strict screenshot projects,
opens the local editor, and exports exact store PNGs through the packaged shared web renderer.

After installing the package artifact:

```bash
screenshots init --dir ./my-app-screenshots
cd ./my-app-screenshots
screenshots dev
screenshots export
```

Node.js 22.13 or newer is required. The package is local-first and does not include an AI provider.
Presence of this package manifest does not mean a registry release has been published.
