# Editor UI font

These files style the editor's own interface. They are not renderer fonts: nothing here is part of
the built-in font catalog, project documents, or render/export parity.

## Screenshot Studio UI

`screenshot-studio-ui-variable-v1.ttf` is Instrument Sans, the unmodified variable font
(`wdth` 75–100, `wght` 400–700) from the Google Fonts repository, exposed to the browser only as the
private family `Screenshot Studio UI`. The private name keeps a project font that is also called
Instrument Sans from restyling the interface. It covers Latin and Latin Extended; Cyrillic and other
scripts fall back to the system UI font.

- Upstream: <https://github.com/google/fonts/tree/main/ofl/instrumentsans>, file
  `InstrumentSans[wdth,wght].ttf` at commit `2fc9491da70cf3e1bafd3c3da49244c5a496e9d5`
- SHA-256: `b24f1812584816958afcf22e22d08e44318c5e51651e25d2438efdde389b33b1`
- License: SIL Open Font License 1.1; see [`OFL-Instrument-Sans.txt`](OFL-Instrument-Sans.txt)
