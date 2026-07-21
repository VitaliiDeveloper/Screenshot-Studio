# Built-in renderer fonts

`screenshot-studio-sans-regular-v1.ttf` is Noto Sans Regular 2.007 exposed to the renderer as
`Screenshot Studio Sans` at weight 400. The initial checked-in bytes came from the compiled
`@vercel/og` distribution bundled with Next.js 15.5.20; the application no longer reads that private
dependency path at build or runtime.

- Upstream family: <https://github.com/notofonts/latin-greek-cyrillic>
- SHA-256: `d2a8188db7fdd567bbd94017cec0622373d47206d45281b7c501f0775cdee83a`
- License: SIL Open Font License 1.1; see [`OFL.txt`](OFL.txt)

The versioned filename and checksum are part of render/export parity. Replace them deliberately and
update the visual parity baseline when changing these bytes.
