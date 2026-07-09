# Phase 3 Slice 1 — Font assets move from base64 to files

Design spec. Deliberately short (see RULES: no heavier than the task needs).
Contract wins: `docs/architecture.md` and the Zod schema.

## Goal & risk retired

Move font bytes out of the project JSON and behind the existing asset route, so every later
Phase 3 slice (`font add`, the font UI, themes) writes against one storage model instead of
two. Today `FontAsset` carries `data: <base64>` and `registerFont` decodes it inline.

This slice retires **"the font storage model changes under a feature that already shipped."**
It touches the parity contract (`registerProjectFonts` runs inside the `__stageReady` gate) and
delivers no user-visible feature — the same trade Phase 2 Slice 1 made.

Out of scope: `font add` / `font list` / `font rm` (Slice 2), Google Fonts (Slice 2), the font
management UI (Slice 3), themes (Slices 4–5), templates (Slice 6).

## Decisions (locked in brainstorming)

1. **Fonts are files, not blobs.** `FontAsset.data` → `FontAsset.path`, project-relative
   (`assets/fonts/pacifico-400.ttf`), served by the existing `apps/web/app/api/asset/route.ts`.
   This is the model `screenshot.assetUrl` already uses. `AGENTS.md` already documents
   `assets/fonts/` as the home for `.ttf/.otf/.woff2`; only the schema disagreed.
2. **`source` widens additively to `"uploaded" | "google"`** and means *provenance*, never a
   render branch. Both kinds resolve to a file on disk. Google support lands in Slice 2; the
   enum member is added here so Slice 2 touches no schema. Reserved now because the UI in
   Slice 3 must be designed against the final shape.
3. **System fonts are rejected.** A system font is by definition not embedded, so a project
   rendered on another machine (or in headless Chromium in CI) produces different pixels. This
   contradicts `architecture.md` §5, which lists `system` as a source and mandates base64.
   **Amending §5 is part of this slice** (see the change list below) — until it lands, the
   contract doc still describes the old model.
4. **`schemaVersion` stays `1`; no migration is written.** The only documents in existence with
   `data:` are this repo's fixtures, and exactly one carries a font. This is a deliberate
   pre-1.0 call, not an oversight.

## Schema change (`packages/core/src/model/schema.ts`)

```ts
export const FontAsset = z
  .object({
    family: z.string().min(1),
    source: z.enum(["uploaded", "google"]),
    /** Project-relative path to the font file, e.g. assets/fonts/inter-400.ttf */
    path: z.string().min(1),
    weight: z.number().int().min(100).max(900).default(400),
  })
  .strict();
```

`(family, weight)` is the identity of a font asset. Two entries sharing both are a
contradiction — the second `FontFace` would silently shadow the first. The schema cannot
express uniqueness across array members, so `Project` gets a `.superRefine` that rejects
duplicates. Registration order must never decide which glyphs paint.

`style` (italic) is **not** added. Nothing consumes it: `elementToNodeConfig` maps
`weight → fontStyle` and there is no italic control anywhere in the inspector. YAGNI.

## Core (`packages/core/src/fonts/index.ts`)

`core` stays network- and filesystem-agnostic, so the host injects the resolver — the same
inversion `loadProjectImages(project, resolve)` already uses in `packages/core/src/assets`:

```ts
export type ResolveFontUrl = (path: string) => string;

export async function registerFont(asset: FontAsset, resolve: ResolveFontUrl): Promise<void>;
export async function registerProjectFonts(fonts: FontAsset[], resolve: ResolveFontUrl): Promise<void>;
```

`registerFont` fetches the resolved URL, **checks `response.ok`**, `await`s an `ArrayBuffer`,
and builds the `FontFace` from it. `base64ToArrayBuffer` is deleted.

The `response.ok` check is load-bearing and easy to omit: `fetch` does **not** reject on 404 —
it resolves with `ok: false` and an HTML error body. Without the check, those bytes reach
`new FontFace(...)`, and the whole guarantee below degrades to "hopefully FontFace rejects on
garbage." Fail explicitly instead.

**A failed font must throw. This is the one place fonts and images deliberately disagree.**
`loadProjectImages` swallows a failed asset — the cache omits it, the map draws a placeholder,
the render completes with a visible hole. That is right for images: the failure is obvious in
the exported PNG. A failed *font* leaves no hole. The browser silently substitutes a fallback
family and the export is a plausible-looking PNG with the wrong glyphs, wrong metrics, and
wrong line breaks — the exact failure `__stageReady` exists to prevent. `registerProjectFonts`
therefore rejects, and the render host lets it propagate rather than gating on it.

`whenFontReady` is left alone (still unused by the render path; out of scope).

## Web (`apps/web`)

- `app/api/asset/route.ts`: extend `CONTENT_TYPES` with `.ttf → font/ttf`, `.otf → font/otf`,
  `.woff2 → font/woff2`, `.woff → font/woff`. The existing path-traversal guard already covers
  the new extensions — fonts introduce no new route.
- `app/render/RenderStage.tsx` and `app/editor/page.tsx`: pass the `resolveAsset` they already
  hold to `registerProjectFonts`. The `Promise.all([...])` before `window.__stageReady = true`
  keeps its current shape; only the font call gains an argument.

## Contract doc (`docs/architecture.md`)

Not optional, and not a follow-up: `AGENTS.md` names `architecture.md` the technical contract
that **wins** over every other summary. This slice makes §5 false, so this slice fixes §5, in
the same change:

- §5 drops `system` from the source list and states why (parity, not preference).
- §5 replaces "stored as base64 in the project so the deck is self-contained" with the file +
  asset-route model, noting that screenshots already work this way.
- §3's `themes: Theme[]` line is **left alone** — it is amended by Slice 4, which is what makes
  it false. Do not touch it here.

## Fixtures

`fixtures/phase-0-sample/` is the parity fixture and the only one with a font. Its JSON is
440 KB, of which 439 KB is the Pacifico base64 blob.

- Decode that blob to `fixtures/phase-0-sample/assets/fonts/pacifico-400.ttf`.
- Rewrite the `fonts` entry to `{ family, source: "uploaded", path, weight }`.
- The JSON drops to ~1 KB and becomes diffable — a real review surface, not a wall of base64.

The other three fixtures have `fonts: []` and are untouched.

## Verification

The point of this slice is that **nothing visible changes**, so the check is the parity suite,
not a new test:

1. `pnpm --filter @screenshot-studio/core test` — schema tests: `path` accepted, `data`
   rejected (strict), `source: "google"` accepted, duplicate `(family, weight)` rejected.
2. **`pnpm test:e2e` (`e2e/parity.test.ts`, on `fixtures/phase-0-sample`) must pass unchanged.**
   This slice needs no new parity test: that file already asserts *"proves the embedded font is
   live: render differs from a fallback render"* — it renders the fixture against a deliberate
   fallback and requires a **large** diff. If `path`-based loading silently fails, Chromium
   substitutes a fallback, that diff collapses toward zero, and the test fails. It is the exact
   regression guard for this change and it already exists.
3. A `registerProjectFonts` unit test asserting it **rejects on a 404** — not on some generic
   "fetch failure". 404 is the case the guarantee actually hinges on, because `fetch` resolves
   it happily; a test that only mocks a network throw would pass against an implementation
   missing the `response.ok` check, which is the bug worth catching.
4. `pnpm --filter @screenshot-studio/cli test` — CLI export still writes correct dimensions and
   no alpha for the rewritten fixture.

**Known gap, accepted for this slice:** `e2e/parity.test.ts` drives only `/render`. The matching
change in `app/editor/page.tsx` is therefore *not* covered — a broken font load there would be an
editor-only visual regression that item 2 would not catch. Check the editor by eye once (the
Pacifico headline in the fixture is unmistakable) rather than building an editor font e2e test.

Not run: the web app's own build is unaffected beyond two call sites; the full suite is not
warranted (RULES: scope verification to changed behavior). Export parity *is* the shared
contract here, so item 2 is mandatory, not optional.

## Risks

- **The fixture rewrite is the migration.** If any out-of-repo project carries `data:`, it
  fails loudly on load (strict schema, unknown key) rather than silently. That is the intended
  behavior, and the reason no `v1→v2` shim is written.
- **`assets/fonts/` must be tracked by git**, unlike `export/`. Checked with `git check-ignore`:
  no ignore rule matches, so the extracted `.ttf` commits normally.
- **Binary in git.** The Pacifico `.ttf` becomes a ~317 KB binary blob in history instead of a
  ~439 KB base64 line. Both are one-time, write-once costs; the file is strictly smaller and
  stops polluting every future diff of the project JSON.
