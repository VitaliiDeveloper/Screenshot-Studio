# Phase 2 Slice 3 — Artboard target validation + UI export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make store-target compatibility visible while editing the artboard, and add a UI Export button that produces the exact same lead-size, no-alpha PNG bundle the CLI already exports — from the same project JSON, through the same headless `/render` path.

**Architecture:** Pure artboard/target helpers land in `packages/core/src/export` (no React/Next/Playwright/fs). The Inspector renders their statuses and one-click target presets, sourcing sizes from a new `GET /api/store-specs`. A new `POST /api/export` route reuses the running Next host as its render host: it loads+validates the on-disk project, validates artboards before rendering, then delegates pixel work to the CLI's existing `exportBundle` + `createRenderBrowserSession` (exposed as a package export). No second renderer, no second server, no client-canvas export.

**Tech Stack:** TypeScript, Next.js 15 (App Router route handlers), React 19, Zustand vanilla store, Zod, Playwright (chromium), JSZip, pngjs, Vitest (+ a real-server e2e config).

## Global Constraints

- Render/export parity is rule #1: exactly one rendering path. The UI route MUST render through the existing `/render` route via `createRenderBrowserSession`; never rasterize in the route or add a second pixel path. (AGENTS.md; docs/architecture.md §2)
- Store sizes are data: read every target from `store-specs.json` via `parseStoreSpecs` / `findStoreSize`. Never hardcode dimensions. (RULES.md DRY)
- Strip alpha and assert exact dimensions on every exported PNG (already done inside `exportBundle`). (docs/architecture.md §4)
- `core/export` helpers stay framework-agnostic: no imports of React, Next.js, Playwright, or `node:fs`. Side effects stay in app/CLI code. (Spec decision 5)
- Save path stays strict: the UI persists only through `PUT /api/project`, which validates with the strict Zod loader. (Spec §Inspector)
- Supported targets this slice: `apple/iphone`, `apple/ipad`, `android/phone` only. No new store targets. (Spec Out of scope)
- Commits: `prefix: imperative subject`, no `Co-Authored-By` trailer. Work commits directly on branch `phase-2` (no `dev` branch, no PR to main). (RULES.md; memory: phase-branch-workflow)
- Lead target ids: `apple/iphone → 6.9`, `apple/ipad → 13`, `android/phone → phone-portrait` (from `leadStoreSizeId`, already implemented).

---

## File Structure

**Create:**
- `packages/core/src/export/artboard-status.ts` — pure `artboardTargetStatus` + `artboardTargetStatuses`.
- `packages/core/src/export/artboard-status.test.ts` — status unit tests.
- `apps/web/lib/store-specs-path.ts` — resolve `store-specs.json` on disk (server-only, mirrors `project-path.ts`).
- `apps/web/app/api/store-specs/route.ts` — `GET` parsed specs for the client.
- `apps/web/app/api/store-specs/route.test.ts` — GET returns specs.
- `apps/web/app/api/export/route.ts` — `POST` bundle export, returns the zip.
- `apps/web/app/api/export/route.test.ts` — pre-render validation → 422 (no browser).
- `apps/web/components/ExportDialog.tsx` — small filter dialog + save→export→download flow.
- `apps/web/components/ArtboardTargets.tsx` — Inspector target-status section + preset buttons.
- `e2e/ui-export.test.ts` — UI-triggered export through a real Next server.

**Modify:**
- `packages/core/src/export/bundle.ts` — add pure `validateBundleArtboards(entries)`.
- `packages/core/src/export/bundle.test.ts` — tests for `validateBundleArtboards`.
- `packages/core/src/export/index.ts` — re-export the new `artboard-status` module (bundle.ts already re-exported).
- `packages/cli/package.json` — add `"./export"` to `exports`.
- `apps/web/package.json` — add `@screenshot-studio/cli` workspace dep.
- `apps/web/next.config.mjs` — transpile cli, mark playwright server-external.
- `apps/web/tsconfig.json` — add `@screenshot-studio/cli/*` path alias.
- `apps/web/components/Inspector.tsx` — accept `specs` prop, render `<ArtboardTargets>` in the no-selection branch.
- `apps/web/app/editor/page.tsx` — fetch specs, pass to `<Inspector>`.
- `apps/web/components/Toolbar.tsx` — add Export button that opens `<ExportDialog>`.

---

## Task 1: Core artboard target status helpers

**Files:**
- Create: `packages/core/src/export/artboard-status.ts`
- Create: `packages/core/src/export/artboard-status.test.ts`
- Modify: `packages/core/src/export/index.ts`

**Interfaces:**
- Consumes: `exportPixelRatio` from `./pixel-ratio.js`; `StoreSize`, `StoreSpecs` from `./specs.js`; `Screen` from `../model/index.js`.
- Produces:
  - `type ArtboardTargetStatus = { kind: "exact"; pixelRatio: number } | { kind: "proportional"; pixelRatio: number } | { kind: "invalid"; message: string }`
  - `artboardTargetStatus(artboard: { width: number; height: number }, target: { width: number; height: number }): ArtboardTargetStatus`
  - `interface ArtboardTargetStatusEntry { target: StoreSize; status: ArtboardTargetStatus }`
  - `artboardTargetStatuses(screen: Screen, specs: StoreSpecs): ArtboardTargetStatusEntry[]`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/export/artboard-status.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Screen } from "../model/index.js";
import { parseStoreSpecs } from "./specs.js";
import { artboardTargetStatus, artboardTargetStatuses } from "./artboard-status.js";

const specs = parseStoreSpecs({
  apple: {
    iphone: [
      { id: "6.9", label: "6.9", width: 1320, height: 2868, orientation: "portrait" },
      { id: "6.1", label: "6.1", width: 1125, height: 2436, orientation: "portrait" },
    ],
  },
  android: { phone: [{ id: "phone-portrait", label: "P", width: 1080, height: 1920, orientation: "portrait" }] },
});

describe("artboardTargetStatus", () => {
  it("reports exact when dimensions equal the target", () => {
    expect(artboardTargetStatus({ width: 1320, height: 2868 }, { width: 1320, height: 2868 })).toEqual({
      kind: "exact",
      pixelRatio: 1,
    });
  });

  it("reports proportional when the aspect ratio matches but dimensions differ", () => {
    expect(artboardTargetStatus({ width: 660, height: 1434 }, { width: 1320, height: 2868 })).toEqual({
      kind: "proportional",
      pixelRatio: 2,
    });
  });

  it("reports invalid with a message when the aspect ratio does not match", () => {
    const status = artboardTargetStatus({ width: 1320, height: 2000 }, { width: 1320, height: 2868 });
    expect(status.kind).toBe("invalid");
    if (status.kind === "invalid") expect(status.message).toMatch(/aspect ratio/);
  });
});

describe("artboardTargetStatuses", () => {
  it("returns one status per store size under the screen's platform/device", () => {
    const screen = { platform: "apple", device: "iphone", artboard: { width: 1320, height: 2868 } } as Screen;
    const results = artboardTargetStatuses(screen, specs);
    expect(results.map((r) => [r.target.id, r.status.kind])).toEqual([
      ["6.9", "exact"],
      ["6.1", "proportional"],
    ]);
  });

  it("returns an empty list for an unsupported platform/device", () => {
    const screen = { platform: "apple", device: "ipad", artboard: { width: 100, height: 100 } } as Screen;
    expect(artboardTargetStatuses(screen, specs)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/export/artboard-status.test.ts`
Expected: FAIL — cannot resolve `./artboard-status.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/export/artboard-status.ts`:

```ts
import { exportPixelRatio } from "./pixel-ratio.js";
import type { StoreSize, StoreSpecs } from "./specs.js";
import type { Screen } from "../model/index.js";

/**
 * Framework-free artboard/target compatibility (spec Slice 3). Classifies an artboard against a
 * store target the same way `exportPixelRatio` would treat it at export time, so the editor can
 * warn before export instead of failing at render. No React/Next/Playwright/fs imports.
 */
export type ArtboardTargetStatus =
  | { kind: "exact"; pixelRatio: number }
  | { kind: "proportional"; pixelRatio: number }
  | { kind: "invalid"; message: string };

export function artboardTargetStatus(
  artboard: { width: number; height: number },
  target: { width: number; height: number },
): ArtboardTargetStatus {
  let pixelRatio: number;
  try {
    pixelRatio = exportPixelRatio(artboard, target);
  } catch (err) {
    return { kind: "invalid", message: err instanceof Error ? err.message : String(err) };
  }
  const exact = artboard.width === target.width && artboard.height === target.height;
  return { kind: exact ? "exact" : "proportional", pixelRatio };
}

export interface ArtboardTargetStatusEntry {
  target: StoreSize;
  status: ArtboardTargetStatus;
}

/** Status for every store size configured under the screen's platform/device (empty if none). */
export function artboardTargetStatuses(screen: Screen, specs: StoreSpecs): ArtboardTargetStatusEntry[] {
  const sizes = specs[screen.platform]?.[screen.device] ?? [];
  return sizes.map((target) => ({ target, status: artboardTargetStatus(screen.artboard, target) }));
}
```

- [ ] **Step 4: Re-export from the export barrel**

Edit `packages/core/src/export/index.ts` — add one line after the existing exports:

```ts
export * from "./artboard-status.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/export/artboard-status.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/export/artboard-status.ts packages/core/src/export/artboard-status.test.ts packages/core/src/export/index.ts
git commit -m "feat: add artboard target status helpers to core/export"
```

---

## Task 2: Core bundle artboard validation

**Files:**
- Modify: `packages/core/src/export/bundle.ts`
- Modify: `packages/core/src/export/bundle.test.ts`

**Interfaces:**
- Consumes: `exportPixelRatio` from `./pixel-ratio.js`; `BundleEntry` (already defined in `bundle.ts`).
- Produces: `validateBundleArtboards(entries: BundleEntry[]): void` — throws on the first entry whose artboard cannot scale to its lead target; the message names screen name, screen id, and target id.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/export/bundle.test.ts` (add `validateBundleArtboards` to the existing import from `./bundle.js`):

```ts
describe("validateBundleArtboards", () => {
  it("passes when every entry's artboard scales to its lead target", () => {
    const entries = buildBundleEntries(project(), specs, { platform: "apple" });
    expect(() => validateBundleArtboards(entries)).not.toThrow();
  });

  it("throws naming the screen and target when an artboard cannot scale", () => {
    const bad = project();
    bad.screens[0]!.artboard = { width: 1320, height: 2000 }; // wrong aspect for 6.9
    const entries = buildBundleEntries(bad, specs, { platform: "apple", device: "iphone" });
    expect(() => validateBundleArtboards(entries)).toThrow(/Hero Phone.*hero.*6\.9/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/export/bundle.test.ts`
Expected: FAIL — `validateBundleArtboards` is not exported.

- [ ] **Step 3: Write the implementation**

In `packages/core/src/export/bundle.ts`, add the `exportPixelRatio` import to the top and append the function at the end:

```ts
import { exportPixelRatio } from "./pixel-ratio.js";
```

```ts
/**
 * Fail before rendering if any bundle entry's artboard cannot scale to its lead target
 * (spec Slice 3). Mirrors the `exportPixelRatio` gate the render loop applies per entry, but
 * up front, so the UI/CLI reject an invalid bundle with a screen-identifying message instead of
 * failing mid-render.
 */
export function validateBundleArtboards(entries: BundleEntry[]): void {
  for (const entry of entries) {
    try {
      exportPixelRatio(entry.screen.artboard, { width: entry.target.width, height: entry.target.height });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Screen "${entry.screen.name}" (${entry.screen.id}) cannot scale to target "${entry.target.id}": ${message}`,
      );
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/export/bundle.test.ts`
Expected: PASS (all existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/export/bundle.ts packages/core/src/export/bundle.test.ts
git commit -m "feat: add pre-render bundle artboard validation to core/export"
```

---

## Task 3: Expose cli/export and wire the web app to import it

This is infra only — no behavior yet. The deliverable is: `apps/web` typechecks while importing `@screenshot-studio/cli/export` and `@screenshot-studio/cli/render-driver`, and Playwright stays a runtime require (not webpack-bundled).

**Files:**
- Modify: `packages/cli/package.json`
- Modify: `apps/web/package.json`
- Modify: `apps/web/next.config.mjs`
- Modify: `apps/web/tsconfig.json`

**Interfaces:**
- Produces: web-resolvable `@screenshot-studio/cli/export` (→ `exportBundle`) and `@screenshot-studio/cli/render-driver` (→ `createRenderBrowserSession`, already exported).

- [ ] **Step 1: Add the `./export` export to cli**

In `packages/cli/package.json`, extend `exports`:

```json
  "exports": {
    "./export": "./src/export.ts",
    "./render-driver": "./src/render-driver.ts",
    "./server": "./src/server.ts"
  },
```

- [ ] **Step 2: Add cli as a web dependency**

In `apps/web/package.json`, add to `dependencies` (keep alphabetical with the existing `@screenshot-studio/core`):

```json
    "@screenshot-studio/cli": "workspace:*",
```

- [ ] **Step 3: Install so the workspace symlink is created**

Run: `pnpm install`
Expected: adds the `@screenshot-studio/cli` symlink under `apps/web/node_modules/@screenshot-studio`. No lockfile errors.

- [ ] **Step 4: Teach Next to transpile cli and externalize Playwright**

In `apps/web/next.config.mjs`, update `transpilePackages` and add `serverExternalPackages` at the top level of `nextConfig`:

```js
  transpilePackages: ["@screenshot-studio/core", "@screenshot-studio/cli"],
  // Playwright ships a native driver; keep it a runtime require rather than letting webpack
  // bundle it into the server route (Next 15 key). The export route runs it on the Node runtime.
  serverExternalPackages: ["playwright"],
```

- [ ] **Step 5: Add the tsconfig path alias for cli**

In `apps/web/tsconfig.json`, add to `compilerOptions.paths` (note the flat `*.ts` shape, matching cli's export map — unlike core's `*/index.ts`):

```json
      "@screenshot-studio/cli/*": [
        "../../packages/cli/src/*.ts"
      ]
```

- [ ] **Step 6: Verify the web app still typechecks**

Run: `pnpm --filter @screenshot-studio/web run typecheck`
Expected: PASS (no new imports use cli yet; this proves the alias/dep resolve is not broken).

- [ ] **Step 7: Commit**

```bash
git add packages/cli/package.json apps/web/package.json apps/web/next.config.mjs apps/web/tsconfig.json pnpm-lock.yaml
git commit -m "chore: expose cli/export and wire web to import cli export primitives"
```

---

## Task 4: store-specs path helper + GET route

**Files:**
- Create: `apps/web/lib/store-specs-path.ts`
- Create: `apps/web/app/api/store-specs/route.ts`
- Create: `apps/web/app/api/store-specs/route.test.ts`

**Interfaces:**
- Consumes: `parseStoreSpecs` from `@screenshot-studio/core/export`.
- Produces: `resolveStoreSpecsPath(): string`; `GET /api/store-specs` → JSON `StoreSpecs`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/api/store-specs/route.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GET } from "./route.js";

describe("GET /api/store-specs", () => {
  it("returns parsed store specs including the iphone lead size", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.apple.iphone.some((s: { id: string }) => s.id === "6.9")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/web/app/api/store-specs/route.test.ts`
Expected: FAIL — cannot resolve `./route.js`.

- [ ] **Step 3: Write the path helper**

Create `apps/web/lib/store-specs-path.ts` (mirrors `project-path.ts`'s INIT_CWD handling so `next dev` — cwd `apps/web` — still finds the repo-root file):

```ts
import { resolve } from "node:path";

/**
 * Resolves the on-disk store-specs.json — the one runtime source of export dimensions
 * (docs/architecture.md §4). Like project-path.ts, it resolves against INIT_CWD (repo root)
 * because `next dev` runs with cwd = apps/web. Server-only (uses node:path).
 */
export function resolveStoreSpecsPath(): string {
  const base = process.env.INIT_CWD ?? process.cwd();
  return resolve(base, process.env.STORE_SPECS_PATH ?? "store-specs.json");
}
```

- [ ] **Step 4: Write the route**

Create `apps/web/app/api/store-specs/route.ts`:

```ts
import { readFile } from "node:fs/promises";
import { parseStoreSpecs } from "@screenshot-studio/core/export";
import { resolveStoreSpecsPath } from "../../../lib/store-specs-path.js";

/**
 * Serves parsed store-specs.json to the editor client so the Inspector can list target presets
 * without duplicating the sizes into the client bundle. Same data the CLI/export path reads.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const specs = parseStoreSpecs(JSON.parse(await readFile(resolveStoreSpecsPath(), "utf8")));
    return Response.json(specs);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run apps/web/app/api/store-specs/route.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/store-specs-path.ts apps/web/app/api/store-specs/route.ts apps/web/app/api/store-specs/route.test.ts
git commit -m "feat: serve store-specs to the editor via GET /api/store-specs"
```

---

## Task 5: POST /api/export route

Loads + validates the project, validates artboards **before** launching a browser, then delegates to `exportBundle` using the request origin as the render host. Returns the zip bytes.

**Files:**
- Create: `apps/web/app/api/export/route.ts`
- Create: `apps/web/app/api/export/route.test.ts`

**Interfaces:**
- Consumes: `parseProjectJson` from `@screenshot-studio/core/model`; `buildBundleEntries`, `parseStoreSpecs`, `validateBundleArtboards`, `type BundleFilters` from `@screenshot-studio/core/export`; `exportBundle` from `@screenshot-studio/cli/export`; `createRenderBrowserSession` from `@screenshot-studio/cli/render-driver`; `resolveProjectPath` from `../../../lib/project-path.js`; `resolveStoreSpecsPath` from `../../../lib/store-specs-path.js`.
- Produces: `POST /api/export`. Body: `{ platform?: "apple" | "android"; device?: "iphone" | "ipad" | "phone"; locale?: string }`. 422 on pre-render validation failure (no browser launched); 200 with `application/zip` on success (`content-disposition: attachment; filename="app-store-screenshots-bundle.zip"`, `x-export-dir` header naming the written directory); 500 on render failure.

- [ ] **Step 1: Write the failing test (pre-render validation, no browser)**

Create `apps/web/app/api/export/route.test.ts`. It points `PROJECT_PATH` at the existing bundle fixture and uses a no-match filter so validation fails before any browser launch:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { POST } from "./route.js";

const repoRoot = resolve(fileURLToPath(new URL("../../../../../", import.meta.url)));
const fixture = resolve(repoRoot, "fixtures/phase-2-bundle/app-store-screenshots.json");

function req(body: unknown): Request {
  return new Request("http://localhost/api/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  delete process.env.PROJECT_PATH;
});

describe("POST /api/export", () => {
  it("returns 422 without rendering when filters match no screens", async () => {
    process.env.PROJECT_PATH = fixture;
    const res = await POST(req({ locale: "does-not-exist" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/No screens match/);
  });
});
```

Note: confirm `../../../../../` resolves to the repo root from `apps/web/app/api/export/`; adjust the number of `../` if the fixture path fails to load.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/web/app/api/export/route.test.ts`
Expected: FAIL — cannot resolve `./route.js`.

- [ ] **Step 3: Write the route**

Create `apps/web/app/api/export/route.ts`:

```ts
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseProjectJson } from "@screenshot-studio/core/model";
import {
  buildBundleEntries,
  parseStoreSpecs,
  validateBundleArtboards,
  type BundleFilters,
} from "@screenshot-studio/core/export";
import { exportBundle } from "@screenshot-studio/cli/export";
import { createRenderBrowserSession } from "@screenshot-studio/cli/render-driver";
import { resolveProjectPath } from "../../../lib/project-path.js";
import { resolveStoreSpecsPath } from "../../../lib/store-specs-path.js";

/**
 * UI export (spec Slice 3). Writes the same lead-size bundle + zip the CLI writes, from the same
 * on-disk project JSON, through the same headless /render path — but reuses THIS Next host as the
 * render host (decision 4): one browser session, `baseUrl` = request origin, no spawned server.
 * All pre-render validation runs before the browser launches, so bad input fails fast as 422.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ExportRequest {
  platform?: BundleFilters["platform"];
  device?: BundleFilters["device"];
  locale?: string;
}

export async function POST(req: Request): Promise<Response> {
  const projectPath = resolveProjectPath();
  let filters: BundleFilters;
  try {
    const body = (await req.json().catch(() => ({}))) as ExportRequest;
    filters = { platform: body.platform, device: body.device, locale: body.locale };
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }

  // Load + validate + build + artboard-check BEFORE launching a browser (fail fast → 422).
  let entries;
  try {
    const project = parseProjectJson(await readFile(projectPath, "utf8"));
    const specs = parseStoreSpecs(JSON.parse(await readFile(resolveStoreSpecsPath(), "utf8")));
    entries = buildBundleEntries(project, specs, filters);
    validateBundleArtboards(entries);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 422 });
  }

  const outDir = join(dirname(projectPath), "export");
  const baseUrl = new URL(req.url).origin;
  const session = await createRenderBrowserSession();
  try {
    const zipPath = await exportBundle({ baseUrl, projectPath, outDir, entries, renderSession: session });
    const zip = await readFile(zipPath);
    return new Response(new Uint8Array(zip), {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": 'attachment; filename="app-store-screenshots-bundle.zip"',
        "x-export-dir": outDir,
      },
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    await session.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/web/app/api/export/route.test.ts`
Expected: PASS — 422, no browser launched.

- [ ] **Step 5: Typecheck the web app (proves cli imports resolve)**

Run: `pnpm --filter @screenshot-studio/web run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/export/route.ts apps/web/app/api/export/route.test.ts
git commit -m "feat: add POST /api/export bundle export route"
```

---

## Task 6: Inspector artboard target section

Renders the active screen's target statuses and one-click "Set exact" presets when no element is selected. Uses `artboardTargetStatuses` + `leadStoreSizeId`, and patches via the existing `patchArtboard` + `scheduleSave` path.

**Files:**
- Create: `apps/web/components/ArtboardTargets.tsx`
- Modify: `apps/web/components/Inspector.tsx`
- Modify: `apps/web/app/editor/page.tsx`

**Interfaces:**
- Consumes: `artboardTargetStatuses`, `leadStoreSizeId`, `type StoreSpecs` from `@screenshot-studio/core/export`; `type Screen` from `@screenshot-studio/core/model`; the module-local `editArtboard` in Inspector.
- Produces: `<ArtboardTargets screen={Screen} specs={StoreSpecs} onSetExact={(w, h) => void} />`; `<Inspector specs={StoreSpecs} />`.

- [ ] **Step 1: Write the ArtboardTargets component**

Create `apps/web/components/ArtboardTargets.tsx`:

```tsx
"use client";

import type { Screen } from "@screenshot-studio/core/model";
import { artboardTargetStatuses, leadStoreSizeId, type StoreSpecs } from "@screenshot-studio/core/export";

/**
 * Inspector target-compatibility section (spec Slice 3). Shows how the active screen's artboard
 * maps to each store size for its platform/device — exact / proportional / invalid — and offers a
 * one-click "Set exact" per target. The lead (bundle) target is badged. Pure display over core's
 * framework-free status helpers; the actual mutation goes through the parent's save path.
 */
const STATUS_TEXT: Record<"exact" | "proportional" | "invalid", string> = {
  exact: "text-emerald-600",
  proportional: "text-amber-600",
  invalid: "text-red-600",
};

const STATUS_LABEL: Record<"exact" | "proportional" | "invalid", string> = {
  exact: "exact",
  proportional: "proportional",
  invalid: "invalid aspect",
};

export function ArtboardTargets({
  screen,
  specs,
  onSetExact,
}: {
  screen: Screen;
  specs: StoreSpecs;
  onSetExact: (width: number, height: number) => void;
}) {
  const statuses = artboardTargetStatuses(screen, specs);
  let leadId: string | undefined;
  try {
    leadId = leadStoreSizeId(screen.platform, screen.device);
  } catch {
    leadId = undefined;
  }

  if (statuses.length === 0) {
    return <p className="text-xs text-neutral-400">No store targets for {screen.platform}/{screen.device}.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-neutral-500">{screen.platform} / {screen.device}</p>
      {statuses.map(({ target, status }) => (
        <div key={target.id} className="flex items-center justify-between gap-2 text-xs">
          <span className="flex flex-col">
            <span className="text-neutral-600">
              {target.label}
              {target.id === leadId && (
                <span className="ml-1 rounded bg-neutral-800 px-1 text-[10px] text-white">lead</span>
              )}
            </span>
            <span className={STATUS_TEXT[status.kind]}>{STATUS_LABEL[status.kind]}</span>
          </span>
          <button
            className="rounded border border-neutral-300 bg-white px-2 py-0.5 hover:bg-neutral-100"
            onClick={() => onSetExact(target.width, target.height)}
          >
            Set exact
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the Inspector**

In `apps/web/components/Inspector.tsx`:

Add the import near the top:

```tsx
import { ArtboardTargets } from "./ArtboardTargets";
import type { StoreSpecs } from "@screenshot-studio/core/export";
```

Change the component signature to accept `specs`:

```tsx
export function Inspector({ specs }: { specs: StoreSpecs | null }) {
```

In the no-selection branch, add a target `Section` after the existing `Artboard` section (reusing the module-local `editArtboard`):

```tsx
          {specs && (
            <Section title="Store targets">
              <ArtboardTargets
                screen={screen}
                specs={specs}
                onSetExact={(width, height) => editArtboard({ width, height })}
              />
            </Section>
          )}
```

- [ ] **Step 3: Fetch specs in the editor page and pass them down**

In `apps/web/app/editor/page.tsx`:

Add a `specs` state and import:

```tsx
import type { StoreSpecs } from "@screenshot-studio/core/export";
```

```tsx
  const [specs, setSpecs] = useState<StoreSpecs | null>(null);
```

Inside the existing `useEffect` async block, fetch specs alongside project (it is fine to fetch after the project load; keep it simple):

```tsx
        const specsRes = await fetch("/api/store-specs");
        if (specsRes.ok) setSpecs(await specsRes.json());
```

Pass the prop:

```tsx
      <Inspector specs={specs} />
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @screenshot-studio/web run typecheck`
Expected: PASS.

- [ ] **Step 5: Lint the edited files**

Run: `pnpm exec eslint apps/web/components/ArtboardTargets.tsx apps/web/components/Inspector.tsx apps/web/app/editor/page.tsx`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/ArtboardTargets.tsx apps/web/components/Inspector.tsx apps/web/app/editor/page.tsx
git commit -m "feat: show artboard store-target status and presets in the inspector"
```

---

## Task 7: Toolbar Export button + ExportDialog

Adds the Export button and a small filter dialog that saves the project, POSTs to `/api/export`, downloads the returned zip, and surfaces validation/render errors inline.

**Files:**
- Create: `apps/web/components/ExportDialog.tsx`
- Modify: `apps/web/components/Toolbar.tsx`

**Interfaces:**
- Consumes: `editorStore` and `saveProject` from `../lib/...`; `POST /api/export`.
- Produces: `<ExportDialog open={boolean} onClose={() => void} />`; Toolbar renders an Export button toggling it.

- [ ] **Step 1: Write the ExportDialog component**

Create `apps/web/components/ExportDialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useStore } from "zustand";
import { editorStore } from "../lib/editor-store";
import { saveProject } from "../lib/save-project";

/**
 * UI export dialog (spec Slice 3). Small on purpose: platform/device/locale filters (all default
 * to "all"), one pending state, inline errors. It saves the current project first so /render and
 * the export route read exactly what the user sees, then downloads the zip the route returns.
 */
type Platform = "all" | "apple" | "android";
type Device = "all" | "iphone" | "ipad" | "phone";

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useStore(editorStore, (s) => s.project);
  const [platform, setPlatform] = useState<Platform>("all");
  const [device, setDevice] = useState<Device>("all");
  const [locale, setLocale] = useState<string>("all");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneDir, setDoneDir] = useState<string | null>(null);

  if (!open || !project) return null;

  const runExport = async () => {
    setPending(true);
    setError(null);
    setDoneDir(null);
    try {
      await saveProject(project); // await, not the debounced saver, so disk == what the user sees
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          platform: platform === "all" ? undefined : platform,
          device: device === "all" ? undefined : device,
          locale: locale === "all" ? undefined : locale,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "app-store-screenshots-bundle.zip";
      a.click();
      URL.revokeObjectURL(url);
      setDoneDir(res.headers.get("x-export-dir"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  const sel = "rounded border border-neutral-300 px-1 py-0.5 text-xs";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="flex w-80 flex-col gap-3 rounded-lg bg-white p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-semibold">Export bundle</h2>

        <label className="flex items-center justify-between text-xs">
          <span className="text-neutral-500">Platform</span>
          <select className={sel} value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
            <option value="all">all</option><option value="apple">apple</option><option value="android">android</option>
          </select>
        </label>

        <label className="flex items-center justify-between text-xs">
          <span className="text-neutral-500">Device</span>
          <select className={sel} value={device} onChange={(e) => setDevice(e.target.value as Device)}>
            <option value="all">all</option><option value="iphone">iphone</option><option value="ipad">ipad</option><option value="phone">phone</option>
          </select>
        </label>

        <label className="flex items-center justify-between text-xs">
          <span className="text-neutral-500">Locale</span>
          <select className={sel} value={locale} onChange={(e) => setLocale(e.target.value)}>
            <option value="all">all</option>
            {project.locales.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>

        {error && <p className="whitespace-pre-wrap text-xs text-red-600">{error}</p>}
        {doneDir && <p className="text-xs text-emerald-600">Wrote bundle to {doneDir}</p>}

        <div className="flex justify-end gap-2">
          <button className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100" onClick={onClose} disabled={pending}>
            Close
          </button>
          <button
            className="rounded bg-neutral-900 px-3 py-1 text-xs text-white hover:bg-neutral-700 disabled:opacity-50"
            onClick={runExport}
            disabled={pending}
          >
            {pending ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the Export button to the Toolbar**

In `apps/web/components/Toolbar.tsx`, add the import + a dialog open state, and render the button + dialog:

```tsx
import { useState } from "react";
import { ExportDialog } from "./ExportDialog";
```

Inside `Toolbar`, add state and render an Export button before the zoom controls' `ml-auto` block by placing it at the start of the right-hand group. Minimal change — add near the text/shape buttons:

```tsx
  const [exportOpen, setExportOpen] = useState(false);
```

```tsx
      <button className={btn} onClick={() => setExportOpen(true)}>Export</button>
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
```

(Place the `<button>` right after the `+ Shape` button and the `<ExportDialog>` anywhere inside the returned root `<div>`.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @screenshot-studio/web run typecheck`
Expected: PASS.

- [ ] **Step 4: Lint the edited files**

Run: `pnpm exec eslint apps/web/components/ExportDialog.tsx apps/web/components/Toolbar.tsx`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ExportDialog.tsx apps/web/components/Toolbar.tsx
git commit -m "feat: add UI export dialog and toolbar export button"
```

---

## Task 8: UI export e2e proof

Drives the real Next server (which serves both `/render` and `/api/export`) and asserts the returned zip has exact-size, no-alpha PNGs — proving the UI path reuses the shared renderer and does not fork the CLI path.

**Files:**
- Create: `e2e/ui-export.test.ts`

**Interfaces:**
- Consumes: `startWebServer` from `../packages/cli/src/server.js`; `parseProjectJson` from `../packages/core/src/model/index.js`; `buildBundleEntries`, `parseStoreSpecs`, `inspectPng` from `../packages/core/src/export/index.js`; the live `POST /api/export`.

- [ ] **Step 1: Write the e2e test**

Create `e2e/ui-export.test.ts`:

```ts
import { cp, mkdtemp, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { parseProjectJson } from "../packages/core/src/model/index.js";
import { buildBundleEntries, inspectPng, parseStoreSpecs } from "../packages/core/src/export/index.js";
import { startWebServer } from "../packages/cli/src/server.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureDir = resolve(repoRoot, "fixtures/phase-2-bundle");
const storeSpecsPath = resolve(repoRoot, "store-specs.json");

afterEach(() => {
  delete process.env.PROJECT_PATH;
});

describe("Phase 2 Slice 3 UI export", () => {
  it("exports the bundle zip through POST /api/export with exact dims and no alpha", async () => {
    // Copy the whole fixture (assets resolve relative to the project dir) into a temp workspace,
    // and point the server's resolveProjectPath at it, so export writes to <temp>/export.
    const workspace = await mkdtemp(join(tmpdir(), "ui-export-"));
    await cp(fixtureDir, workspace, { recursive: true });
    const projectPath = join(workspace, "app-store-screenshots.json");
    process.env.PROJECT_PATH = projectPath;

    const project = parseProjectJson(await readFile(projectPath, "utf8"));
    const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
    const expected = buildBundleEntries(project, specs, {});

    const server = await startWebServer();
    try {
      const res = await fetch(`${server.url}/api/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/zip");

      const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
      const names = Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name).sort();
      expect(names).toEqual(expected.map((e) => e.relativePath).sort());

      for (const entry of expected) {
        const png = await zip.file(entry.relativePath)!.async("nodebuffer");
        const info = inspectPng(png);
        expect(info.width).toBe(entry.target.width);
        expect(info.height).toBe(entry.target.height);
        expect(info.hasAlpha).toBe(false);
      }
    } finally {
      await server.stop();
    }
  }, 180_000);
});
```

- [ ] **Step 2: Run the UI export e2e**

Run: `pnpm test:e2e -- e2e/ui-export.test.ts`
Expected: PASS. (First request compiles the route + launches chromium; the 180s timeout covers it.) This is the gate that the web route actually loads cli/export and launches chromium from inside Next.

- [ ] **Step 3: Run the existing bundle e2e to prove no regression**

Run: `pnpm test:e2e -- e2e/bundle-export.test.ts`
Expected: PASS — the CLI path is unchanged.

- [ ] **Step 4: Commit**

```bash
git add e2e/ui-export.test.ts
git commit -m "test: add UI-triggered export e2e proof"
```

---

## Final verification

- [ ] **Unit suite:** `pnpm test` — all packages green (new core + route unit tests included).
- [ ] **Typecheck:** `pnpm typecheck` — core, cli, web all pass.
- [ ] **Lint:** `pnpm lint` — no errors.
- [ ] **E2e:** `pnpm test:e2e` — both `ui-export` and `bundle-export` green.
- [ ] **Manual smoke (optional but recommended):** `pnpm dev`, open `/editor`, deselect all → Inspector shows target statuses; click "Set exact" → artboard snaps; click Export → zip downloads and `export/` is written.

---

## Self-Review notes (spec coverage)

- Core helpers `artboardTargetStatus` / `artboardTargetStatuses` → Task 1; `validateBundleArtboards` → Task 2. Framework-free (no React/Next/Playwright/fs) — verified by import lists.
- Inspector target section (status + lead badge + per-target "Set exact", manual editing preserved) → Task 6. Save path stays `scheduleSave`/`saveProject` → strict Zod via `/api/project`.
- Toolbar Export button + small dialog (platform/device/locale filters, pending state, inline errors, save-before-export, zip download, written-location display) → Task 7.
- `POST /api/export` doing resolve→load→validate→buildEntries→validateArtboards→one browser→request-origin baseUrl→exportBundle→return zip → Task 5. Pre-render failures are 422; render failures preserve the Slice 2 screen/target error shape (from `exportBundle`).
- Reuse of cli primitives without a second renderer / without moving browser code into core → Task 3 (package export + transpile + externalize Playwright).
- Out-of-scope items (dev/import/screen commands, asset picker, new targets, client-canvas export, auto-snap, progress streaming) → none introduced.
- Verification matrix (unit statuses, preset listing, bundle validation, unchanged bundle path, typecheck, lint, UI export e2e, CLI e2e still green) → Tasks 1–8 + Final verification.
