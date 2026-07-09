# Phase 3 Slice 1 - Font Asset Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move project fonts from base64 JSON blobs to project-relative files served through the existing asset route, without changing rendered output.

**Architecture:** Keep `core/fonts` browser-only and filesystem/network-agnostic by injecting a `path -> URL` resolver, mirroring `core/assets`. Keep render/export parity strict: a missing font rejects before `__stageReady`, while images keep their existing placeholder-tolerant behavior.

**Tech Stack:** TypeScript, Zod, browser `FontFace`, existing Next `/api/asset` route, Vitest, Playwright e2e parity.

---

## File Structure

Modify:

- `packages/core/src/model/schema.ts` - replace `FontAsset.data` with `FontAsset.path`, widen `source`, and reject duplicate `(family, weight)` pairs.
- `packages/core/src/model/schema.test.ts` - cover path fonts, strict data rejection, google provenance, and duplicate font identity rejection.
- `packages/core/src/fonts/index.ts` - fetch font bytes through an injected resolver and reject non-OK responses.
- `packages/core/src/fonts/index.test.ts` - test resolver usage and explicit 404 rejection.
- `apps/web/app/api/asset/route.ts` - add font MIME types.
- `apps/web/app/api/asset/route.test.ts` - assert `.ttf`, `.otf`, `.woff`, and `.woff2` content types.
- `apps/web/app/render/RenderStage.tsx` - pass the existing project-aware asset resolver to `registerProjectFonts`.
- `apps/web/app/editor/page.tsx` - pass the editor asset resolver to `registerProjectFonts`.
- `fixtures/phase-0-sample/app-store-screenshots.json` - replace the Pacifico base64 entry with a path entry.
- `fixtures/phase-0-sample/assets/fonts/Pacifico-Regular.ttf` - ensure the decoded font file is tracked and referenced by JSON.
- `docs/architecture.md` - amend section 5 so it describes file-backed uploaded/google fonts and explicitly rejects system fonts.
- `docs/roadmap.md` - mark Slice 1 complete only after verification passes.

## Task 1: Schema Contract

**Files:**
- Modify: `packages/core/src/model/schema.ts`
- Modify: `packages/core/src/model/schema.test.ts`

- [ ] **Step 1: Write failing schema tests**

Add tests that assert:

```ts
it("accepts a file-backed uploaded font", () => {
  const p = validProject();
  p.fonts = [{ family: "Pacifico", source: "uploaded", path: "assets/fonts/Pacifico-Regular.ttf", weight: 400 }];
  expect(() => parseProject(p)).not.toThrow();
});

it("accepts google as file provenance", () => {
  const p = validProject();
  p.fonts = [{ family: "Inter", source: "google", path: "assets/fonts/inter-400.ttf", weight: 400 }];
  expect(() => parseProject(p)).not.toThrow();
});

it("rejects legacy base64 font data", () => {
  const p = validProject();
  p.fonts = [{ family: "Pacifico", source: "uploaded", data: "AAAA", weight: 400 }];
  expect(() => parseProject(p)).toThrow(ProjectValidationError);
});

it("rejects duplicate font family and weight", () => {
  const p = validProject();
  p.fonts = [
    { family: "Inter", source: "uploaded", path: "assets/fonts/inter-a.ttf", weight: 400 },
    { family: "Inter", source: "google", path: "assets/fonts/inter-b.ttf", weight: 400 },
  ];
  expect(() => parseProject(p)).toThrow(ProjectValidationError);
});
```

- [ ] **Step 2: Verify the focused test fails**

Run: `rtk pnpm exec vitest run packages/core/src/model/schema.test.ts`

Expected: FAIL because `FontAsset` still requires `data` and rejects `source: "google"`.

- [ ] **Step 3: Implement the schema change**

Change `FontAsset` to:

```ts
export const FontAsset = z
  .object({
    family: z.string().min(1),
    source: z.enum(["uploaded", "google"]),
    /** Project-relative path to the font file, e.g. assets/fonts/inter-400.ttf. */
    path: z.string().min(1),
    weight: z.number().int().min(100).max(900).default(400),
  })
  .strict();
```

Inside `Project.superRefine`, after the existing `platforms` checks, add a duplicate check keyed by `${family}\0${weight}` and report duplicate issues at `["fonts", i]`.

- [ ] **Step 4: Verify green**

Run: `rtk pnpm exec vitest run packages/core/src/model/schema.test.ts`

Expected: PASS.

## Task 2: Font Loader Resolver

**Files:**
- Modify: `packages/core/src/fonts/index.ts`
- Create: `packages/core/src/fonts/index.test.ts`

- [ ] **Step 1: Write failing font loader tests**

Stub `globalThis.fetch`, `globalThis.FontFace`, and `document.fonts` in the test. Cover:

```ts
await registerFont(
  { family: "Pacifico", source: "uploaded", path: "assets/fonts/Pacifico-Regular.ttf", weight: 400 },
  (path) => `/api/asset?path=${encodeURIComponent(path)}`,
);
expect(fetch).toHaveBeenCalledWith("/api/asset?path=assets%2Ffonts%2FPacifico-Regular.ttf");
```

Also assert `registerFont(...)` rejects when `fetch` resolves `{ ok: false, status: 404 }`, because this is the bug the spec calls out.

- [ ] **Step 2: Verify the focused test fails**

Run: `rtk pnpm exec vitest run packages/core/src/fonts/index.test.ts`

Expected: FAIL because `registerFont` does not accept a resolver and still decodes base64.

- [ ] **Step 3: Implement resolver-backed registration**

Replace base64 decoding with:

```ts
export type ResolveFontUrl = (path: string) => string;

export async function registerFont(asset: FontAsset, resolve: ResolveFontUrl): Promise<void> {
  const response = await fetch(resolve(asset.path));
  if (!response.ok) {
    throw new Error(`Failed to load font "${asset.family}" from ${asset.path}: HTTP ${response.status}`);
  }
  const face = new FontFace(asset.family, await response.arrayBuffer(), {
    weight: String(asset.weight),
  });
  await face.load();
  document.fonts.add(face);
}

export async function registerProjectFonts(fonts: FontAsset[], resolve: ResolveFontUrl): Promise<void> {
  await Promise.all(fonts.map((font) => registerFont(font, resolve)));
  await document.fonts.ready;
}
```

Keep `whenFontReady` unchanged.

- [ ] **Step 4: Verify green**

Run: `rtk pnpm exec vitest run packages/core/src/fonts/index.test.ts packages/core/src/model/schema.test.ts`

Expected: PASS.

## Task 3: Web Asset Route and Call Sites

**Files:**
- Modify: `apps/web/app/api/asset/route.ts`
- Modify: `apps/web/app/api/asset/route.test.ts`
- Modify: `apps/web/app/render/RenderStage.tsx`
- Modify: `apps/web/app/editor/page.tsx`

- [ ] **Step 1: Write failing asset route test**

In `route.test.ts`, create small files under `assets/fonts/` and assert content types:

```ts
expect((await GET(req("path=assets/fonts/demo.ttf"))).headers.get("content-type")).toContain("font/ttf");
expect((await GET(req("path=assets/fonts/demo.otf"))).headers.get("content-type")).toContain("font/otf");
expect((await GET(req("path=assets/fonts/demo.woff"))).headers.get("content-type")).toContain("font/woff");
expect((await GET(req("path=assets/fonts/demo.woff2"))).headers.get("content-type")).toContain("font/woff2");
```

- [ ] **Step 2: Verify the focused test fails**

Run: `rtk pnpm exec vitest run apps/web/app/api/asset/route.test.ts`

Expected: FAIL because font extensions fall back to `application/octet-stream`.

- [ ] **Step 3: Add font MIME types**

Extend `CONTENT_TYPES`:

```ts
".ttf": "font/ttf",
".otf": "font/otf",
".woff": "font/woff",
".woff2": "font/woff2",
```

- [ ] **Step 4: Update registration call sites**

In `RenderStage.tsx`, change:

```ts
registerProjectFonts(project.fonts)
```

to:

```ts
registerProjectFonts(project.fonts, resolveAsset)
```

In `editor/page.tsx`, do the same with the existing editor `resolveAsset`.

- [ ] **Step 5: Verify green**

Run: `rtk pnpm exec vitest run apps/web/app/api/asset/route.test.ts`

Expected: PASS.

## Task 4: Fixture Rewrite

**Files:**
- Modify: `fixtures/phase-0-sample/app-store-screenshots.json`
- Modify/add: `fixtures/phase-0-sample/assets/fonts/Pacifico-Regular.ttf`

- [ ] **Step 1: Decode the existing font blob if needed**

If `fixtures/phase-0-sample/assets/fonts/Pacifico-Regular.ttf` is not already a valid font file, decode the current JSON `fonts[0].data` base64 to that path before replacing the JSON entry.

- [ ] **Step 2: Rewrite the fixture font entry**

Replace the current base64 font entry with:

```json
{
  "family": "Pacifico",
  "source": "uploaded",
  "path": "assets/fonts/Pacifico-Regular.ttf",
  "weight": 400
}
```

- [ ] **Step 3: Verify fixture parses**

Run: `rtk pnpm exec vitest run packages/core/src/model/schema.test.ts`

Expected: PASS; if the fixture is imported by e2e only, run the e2e check in Task 6.

## Task 5: Contract Docs

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/roadmap.md`

- [ ] **Step 1: Amend architecture section 5**

Update `docs/architecture.md` so it says Phase 3 supports uploaded and Google fonts as files under `assets/fonts/`, served through the same local asset route as screenshots. State that system fonts are intentionally rejected because they are not embedded and break parity across machines.

- [ ] **Step 2: Mark roadmap Slice 1 complete after verification**

Only after Task 6 passes, change the Phase 3 Slice 1 marker in `docs/roadmap.md` from `◻` to `✅`.

## Task 6: Verification

**Files:**
- All modified files above.

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
rtk pnpm exec vitest run \
  packages/core/src/model/schema.test.ts \
  packages/core/src/fonts/index.test.ts \
  apps/web/app/api/asset/route.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run core tests**

Run: `rtk pnpm --filter @screenshot-studio/core test`

Expected: If the package has no `test` script, use `rtk pnpm exec vitest run packages/core/src` and note the package-script gap in the completion summary.

- [ ] **Step 3: Run CLI tests**

Run: `rtk pnpm --filter @screenshot-studio/cli test`

Expected: PASS.

- [ ] **Step 4: Run parity e2e**

Run: `rtk pnpm test:e2e`

Expected: PASS, especially `e2e/parity.test.ts` proving the Pacifico render still differs from fallback.

- [ ] **Step 5: Run typecheck and diff checks**

Run:

```bash
rtk pnpm typecheck
rtk git diff --check
```

Expected: PASS / no output from `git diff --check`.
