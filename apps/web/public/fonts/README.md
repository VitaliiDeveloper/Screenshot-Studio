# Built-in renderer fonts

The versioned filenames and checksums are part of render/export parity. Replace them deliberately and
update the visual parity baseline when changing these bytes.

## Screenshot Studio Sans

`screenshot-studio-sans-regular-v1.ttf` is Noto Sans Regular 2.007 exposed to the renderer as
`Screenshot Studio Sans` at weight 400. The initial checked-in bytes came from the compiled
`@vercel/og` distribution bundled with Next.js 15.5.20; the application no longer reads that private
dependency path at build or runtime.

- Upstream family: <https://github.com/notofonts/latin-greek-cyrillic>
- SHA-256: `d2a8188db7fdd567bbd94017cec0622373d47206d45281b7c501f0775cdee83a`
- License: SIL Open Font License 1.1; see [`OFL.txt`](OFL.txt)

## Screenshot Studio Display

Inter Display 4.1, the static `opsz` 32 cut of Inter, exposed to the renderer as
`Screenshot Studio Display` at weights 400, 600, and 800. It gives headlines real weights and covers
Latin, Latin Extended-A, Cyrillic (including Ukrainian), and Greek; Hebrew, Arabic, and CJK are not
covered. The files are the unmodified `web/InterDisplay-*.woff2` files from the upstream release.

- Upstream release: <https://github.com/rsms/inter/releases/tag/v4.1>, `Inter-4.1.zip`
  (SHA-256 `9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e`)
- License: SIL Open Font License 1.1 with no Reserved Font Name; see [`OFL-Inter.txt`](OFL-Inter.txt)

| File | Upstream file | SHA-256 |
| --- | --- | --- |
| `screenshot-studio-display-regular-v1.woff2` | `web/InterDisplay-Regular.woff2` | `3a9463a58c3e7ba1e3cd65b5dbff91a35c508ff78a104cd1121feff83efeb787` |
| `screenshot-studio-display-semibold-v1.woff2` | `web/InterDisplay-SemiBold.woff2` | `d9f63a82b826fb0117c92715c3a52a2d2247bc321bc39341420bf52d91e8277a` |
| `screenshot-studio-display-extrabold-v1.woff2` | `web/InterDisplay-ExtraBold.woff2` | `97eeee5a6f4f22fef1f607cf8836104d65968f03e59bc068a7586bf18364a8a7` |
