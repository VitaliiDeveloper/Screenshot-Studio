# Phase 2 Slice 2 - Bundle Export Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CLI bundle export that renders all matching screens through one web host and one reused Playwright browser/context, writes store-ready PNGs grouped by `platform/device/locale`, and produces a zip bundle.

**Architecture:** Keep render/export parity by continuing to drive the existing `/render` route. Add framework-free bundle-selection helpers in `packages/core/src/export`, then make `packages/cli` own process, browser, filesystem, and zip side effects. Preserve the current single-screen `--screen --size` path while adding bundle mode behind validated export flags.

**Tech Stack:** TypeScript, Zod-validated project model, Playwright, Next render host, Vitest, JSZip.

---

## Global Constraints

- **One renderer only:** all PNG pixels still come from `apps/web/app/render` through Playwright and `Stage.toDataURL`.
- **Compatibility:** existing `screenshots export --screen <id> --size <id>` behavior stays valid.
- **Bundle scope:** lead sizes only: `apple/iphone -> 6.9`, `apple/ipad -> 13`, `android/phone -> phone-portrait`.
- **No UI work:** the editor export button and artboard validation are Slice 3.
- **No CLI management work:** `dev`, `import`, and `screen ...` are Slice 4.
- **No implicit Apple multi-size export:** non-lead store sizes remain explicit single-screen targets.
- **Stop resources in `finally`:** browser/context and server must close on success and failure.
- **Working branch:** `phase-2`.

## File Structure

- Create `packages/core/src/export/bundle.ts`: pure target selection, filtering, path generation.
- Create `packages/core/src/export/bundle.test.ts`: unit tests for helper behavior and errors.
- Modify `packages/core/src/export/index.ts`: export bundle helpers.
- Modify `packages/cli/src/server.ts`: optional free-port selection.
- Create `packages/cli/src/server.test.ts`: tests for explicit and free-port behavior using injectable spawn/wait hooks.
- Modify `packages/cli/src/render-driver.ts`: add reusable `RenderBrowserSession`; keep `renderScreenToPng` as compatibility wrapper.
- Create `packages/cli/src/render-driver.test.ts`: unit tests with injectable browser/page doubles.
- Modify `packages/cli/src/export.ts`: bundle orchestration and zip writing.
- Create `packages/cli/src/export.test.ts`: CLI-side bundle tests with mocked renderer and temp filesystem.
- Modify `packages/cli/src/index.ts`: parse/export mode validation and dispatch.
- Create `packages/cli/src/index.test.ts`: flag validation tests by extracting pure functions from `index.ts`.
- Modify `package.json`, `packages/cli/package.json`, `pnpm-lock.yaml`: add `jszip` where the CLI and root e2e tests can import it.
- Create `fixtures/phase-2-bundle/app-store-screenshots.json`: minimal Apple iPhone/iPad + Android phone fixture.
- Create `e2e/bundle-export.test.ts`: focused runtime proof for bundle export.
- Modify docs only if implementation changes a contract from the spec.

---

### Task 1: Core bundle selection helpers

**Files:**
- Create: `packages/core/src/export/bundle.ts`
- Create: `packages/core/src/export/bundle.test.ts`
- Modify: `packages/core/src/export/index.ts`

**Interfaces:**
- Produces `BundleFilters`, `BundleEntry`, `leadStoreSizeId`, `selectBundleScreens`, `bundleRelativePath`, `buildBundleEntries`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/export/bundle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Project } from "../model/index.js";
import { parseStoreSpecs } from "./specs.js";
import {
  buildBundleEntries,
  bundleRelativePath,
  leadStoreSizeId,
  selectBundleScreens,
} from "./bundle.js";

const specs = parseStoreSpecs({
  apple: {
    iphone: [{ id: "6.9", label: "6.9", width: 1320, height: 2868, orientation: "portrait" }],
    ipad: [{ id: "13", label: "13", width: 2064, height: 2752, orientation: "portrait" }],
  },
  android: {
    phone: [{ id: "phone-portrait", label: "Phone", width: 1080, height: 1920, orientation: "portrait" }],
  },
});

function project(): Project {
  return {
    meta: { name: "Bundle", schemaVersion: 1 },
    platforms: ["apple", "android"],
    locales: ["en", "uk"],
    fonts: [],
    screens: [
      screen("hero", "Hero Phone", "apple", "iphone", "en", 1320, 2868),
      screen("ipad", "Hero iPad", "apple", "ipad", "en", 2064, 2752),
      screen("android", "Android Hero", "android", "phone", "uk", 1080, 1920),
    ],
  };
}

function screen(
  id: string,
  name: string,
  platform: "apple" | "android",
  device: "iphone" | "ipad" | "phone",
  locale: string,
  width: number,
  height: number,
): Project["screens"][number] {
  return {
    id,
    name,
    platform,
    device,
    locale,
    artboard: { width, height },
    background: { type: "solid", color: "#000000" },
    elements: [],
  } as Project["screens"][number];
}

describe("leadStoreSizeId", () => {
  it("returns the Phase 2 lead target per platform/device", () => {
    expect(leadStoreSizeId("apple", "iphone")).toBe("6.9");
    expect(leadStoreSizeId("apple", "ipad")).toBe("13");
    expect(leadStoreSizeId("android", "phone")).toBe("phone-portrait");
  });

  it("throws for an unsupported pair", () => {
    expect(() => leadStoreSizeId("android", "tablet" as never)).toThrow(/No lead store size/);
  });
});

describe("selectBundleScreens", () => {
  it("keeps project screen order and filters by platform/device/locale", () => {
    expect(selectBundleScreens(project(), { platform: "apple" }).map((s) => s.id)).toEqual(["hero", "ipad"]);
    expect(selectBundleScreens(project(), { device: "phone" }).map((s) => s.id)).toEqual(["android"]);
    expect(selectBundleScreens(project(), { locale: "en" }).map((s) => s.id)).toEqual(["hero", "ipad"]);
  });

  it("throws when filters match no screens", () => {
    expect(() => selectBundleScreens(project(), { locale: "fr" })).toThrow(/No screens match/);
  });
});

describe("bundleRelativePath", () => {
  it("builds a stable platform/device/locale path with a one-based order prefix", () => {
    const path = bundleRelativePath(project().screens[0]!, { id: "6.9" } as never, 0);
    expect(path).toBe("apple/iphone/en/01-hero-phone-6.9.png");
  });

  it("sanitizes empty names by falling back to the screen id", () => {
    const s = { ...project().screens[0]!, id: "s_1", name: "!!!" };
    expect(bundleRelativePath(s, { id: "6.9" } as never, 1)).toBe("apple/iphone/en/02-s-1-6.9.png");
  });
});

describe("buildBundleEntries", () => {
  it("attaches lead targets and relative paths", () => {
    const entries = buildBundleEntries(project(), specs, { platform: "apple" });
    expect(entries.map((e) => [e.screen.id, e.target.id, e.relativePath])).toEqual([
      ["hero", "6.9", "apple/iphone/en/01-hero-phone-6.9.png"],
      ["ipad", "13", "apple/ipad/en/02-hero-ipad-13.png"],
    ]);
  });

  it("throws if store-specs lacks the schema-supported lead target", () => {
    const broken = parseStoreSpecs({ apple: { iphone: [] }, android: { phone: [] } });
    expect(() => buildBundleEntries(project(), broken, { platform: "apple", device: "iphone" })).toThrow(
      /Unknown size/,
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
rtk pnpm --filter @screenshot-studio/core exec vitest run src/export/bundle.test.ts
```

Expected: FAIL with an import error for `./bundle.js`.

- [ ] **Step 3: Implement the pure helpers**

Create `packages/core/src/export/bundle.ts`:

```ts
import type { Project, Screen } from "../model/index.js";
import { findStoreSize, type StoreSize, type StoreSpecs } from "./specs.js";

export interface BundleFilters {
  platform?: Screen["platform"];
  device?: Screen["device"];
  locale?: string;
}

export interface BundleEntry {
  screen: Screen;
  target: StoreSize;
  relativePath: string;
}

const LEAD_SIZE_BY_PLATFORM_DEVICE = {
  apple: { iphone: "6.9", ipad: "13" },
  android: { phone: "phone-portrait" },
} as const;

export function leadStoreSizeId(platform: string, device: string): string {
  const byDevice = LEAD_SIZE_BY_PLATFORM_DEVICE[platform as keyof typeof LEAD_SIZE_BY_PLATFORM_DEVICE];
  const id = byDevice?.[device as keyof typeof byDevice];
  if (!id) throw new Error(`No lead store size configured for ${platform}/${device}`);
  return id;
}

export function selectBundleScreens(project: Project, filters: BundleFilters = {}): Screen[] {
  const screens = project.screens.filter((screen) => {
    if (filters.platform && screen.platform !== filters.platform) return false;
    if (filters.device && screen.device !== filters.device) return false;
    if (filters.locale && screen.locale !== filters.locale) return false;
    return true;
  });
  if (screens.length === 0) {
    const parts = [
      filters.platform ? `platform=${filters.platform}` : undefined,
      filters.device ? `device=${filters.device}` : undefined,
      filters.locale ? `locale=${filters.locale}` : undefined,
    ].filter(Boolean);
    throw new Error(`No screens match bundle filters${parts.length ? ` (${parts.join(", ")})` : ""}`);
  }
  return screens;
}

function sanitizeSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function bundleRelativePath(screen: Screen, target: Pick<StoreSize, "id">, index: number): string {
  const prefix = String(index + 1).padStart(2, "0");
  const safeName = sanitizeSegment(screen.name) || sanitizeSegment(screen.id) || "screen";
  return `${screen.platform}/${screen.device}/${screen.locale}/${prefix}-${safeName}-${target.id}.png`;
}

export function buildBundleEntries(
  project: Project,
  specs: StoreSpecs,
  filters: BundleFilters = {},
): BundleEntry[] {
  return selectBundleScreens(project, filters).map((screen, index) => {
    const sizeId = leadStoreSizeId(screen.platform, screen.device);
    const target = findStoreSize(specs, screen.platform, screen.device, sizeId);
    return { screen, target, relativePath: bundleRelativePath(screen, target, index) };
  });
}
```

- [ ] **Step 4: Re-export the helpers**

Modify `packages/core/src/export/index.ts`:

```ts
export * from "./specs.js";
export * from "./png.js";
export * from "./pixel-ratio.js";
export * from "./bundle.js";
```

- [ ] **Step 5: Run the focused tests**

Run:

```bash
rtk pnpm --filter @screenshot-studio/core exec vitest run src/export/bundle.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/core/src/export/bundle.ts packages/core/src/export/bundle.test.ts packages/core/src/export/index.ts
rtk git commit -m "feat: add bundle export target selection helpers"
```

---

### Task 2: Free-port render host

**Files:**
- Modify: `packages/cli/src/server.ts`
- Create: `packages/cli/src/server.test.ts`

**Interfaces:**
- Produces `resolveServerPort`, `createServerController`, and `startWebServer(port?: number, options?)`.
- Keeps the public return shape `{ url, stop }`.

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/src/server.test.ts`:

```ts
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createServerController, resolveServerPort } from "./server.js";

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  killed = false;
  kill = vi.fn(() => {
    this.killed = true;
    this.exitCode = 0;
    this.emit("exit");
    return true;
  });
}

describe("resolveServerPort", () => {
  it("uses an explicit port unchanged", async () => {
    await expect(resolveServerPort(3123)).resolves.toBe(3123);
  });

  it("allocates a free localhost port when omitted", async () => {
    const port = await resolveServerPort();
    expect(Number.isInteger(port)).toBe(true);
    expect(port).toBeGreaterThan(0);
  });
});

describe("createServerController", () => {
  it("spawns Next on the resolved port and returns a localhost URL", async () => {
    const child = new FakeChild();
    const spawn = vi.fn(() => child as never);
    const waitForHttp = vi.fn(async () => undefined);
    const server = await createServerController({
      port: 4567,
      spawn,
      waitForHttp,
      timeoutMs: 100,
    });

    expect(spawn.mock.calls[0]![1]).toContain("4567");
    expect(waitForHttp).toHaveBeenCalledWith("http://localhost:4567", 100);
    expect(server.url).toBe("http://localhost:4567");
    await server.stop();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("kills the child when readiness fails", async () => {
    const child = new FakeChild();
    await expect(
      createServerController({
        port: 4568,
        spawn: vi.fn(() => child as never),
        waitForHttp: vi.fn(async () => {
          throw new Error("not ready");
        }),
        timeoutMs: 100,
      }),
    ).rejects.toThrow(/not ready/);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
rtk pnpm --filter @screenshot-studio/cli exec vitest run src/server.test.ts
```

Expected: FAIL because `createServerController` and `resolveServerPort` do not exist.

- [ ] **Step 3: Implement injectable server startup**

Replace `packages/cli/src/server.ts` with:

```ts
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export interface RunningServer {
  url: string;
  stop: () => Promise<void>;
}

type SpawnFn = typeof nodeSpawn;
type WaitForHttpFn = (url: string, timeoutMs: number) => Promise<void>;

const webDir = resolve(fileURLToPath(new URL("../../../apps/web", import.meta.url)));

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`Web server did not become ready within ${timeoutMs}ms`);
}

export async function resolveServerPort(port?: number): Promise<number> {
  if (port) return port;
  return new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate a free render host port")));
        return;
      }
      const selected = address.port;
      server.close(() => resolvePort(selected));
    });
  });
}

export interface ServerControllerOptions {
  port?: number;
  timeoutMs?: number;
  spawn?: SpawnFn;
  waitForHttp?: WaitForHttpFn;
}

export async function createServerController({
  port,
  timeoutMs = 120_000,
  spawn = nodeSpawn,
  waitForHttp: wait = waitForHttp,
}: ServerControllerOptions = {}): Promise<RunningServer> {
  const selectedPort = await resolveServerPort(port);
  const child: ChildProcess = spawn("pnpm", ["exec", "next", "dev", "--port", String(selectedPort)], {
    cwd: webDir,
    stdio: "ignore",
    env: { ...process.env, NODE_ENV: "development" },
  });

  const url = `http://localhost:${selectedPort}`;
  try {
    await wait(url, timeoutMs);
  } catch (err) {
    child.kill("SIGTERM");
    throw err;
  }

  const stop = () =>
    new Promise<void>((resolveStop) => {
      if (child.exitCode !== null || child.killed) return resolveStop();
      child.once("exit", () => resolveStop());
      child.kill("SIGTERM");
    });

  return { url, stop };
}

export async function startWebServer(
  port?: number,
  options: { timeoutMs?: number } = {},
): Promise<RunningServer> {
  return createServerController({ port, timeoutMs: options.timeoutMs });
}
```

- [ ] **Step 4: Run the focused tests**

Run:

```bash
rtk pnpm --filter @screenshot-studio/cli exec vitest run src/server.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/cli/src/server.ts packages/cli/src/server.test.ts
rtk git commit -m "feat: pick a free render host port for exports"
```

---

### Task 3: Reusable browser render session

**Files:**
- Modify: `packages/cli/src/render-driver.ts`
- Create: `packages/cli/src/render-driver.test.ts`

**Interfaces:**
- Produces `RenderBrowserSession`, `createRenderBrowserSession`.
- Keeps `renderScreenToPng(opts)` as a compatibility wrapper.

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/src/render-driver.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createRenderBrowserSession } from "./render-driver.js";

describe("RenderBrowserSession", () => {
  it("reuses one browser context across multiple renders", async () => {
    const page = {
      goto: vi.fn(async () => undefined),
      waitForFunction: vi.fn(async () => undefined),
      evaluate: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce("data:image/png;base64,Zmlyc3Q=")
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce("data:image/png;base64,c2Vjb25k"),
      close: vi.fn(async () => undefined),
    };
    const context = {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    };
    const browser = {
      newContext: vi.fn(async () => context),
      close: vi.fn(async () => undefined),
    };
    const session = await createRenderBrowserSession({
      launch: vi.fn(async () => browser as never),
    });

    await expect(
      session.renderScreenToPng({
        baseUrl: "http://localhost:4000",
        projectPath: "fixtures/project.json",
        screenId: "s1",
        pixelRatio: 1,
      }),
    ).resolves.toEqual(Buffer.from("first"));
    await expect(
      session.renderScreenToPng({
        baseUrl: "http://localhost:4000",
        projectPath: "fixtures/project.json",
        screenId: "s2",
        pixelRatio: 2,
      }),
    ).resolves.toEqual(Buffer.from("second"));

    expect(browser.newContext).toHaveBeenCalledTimes(1);
    expect(context.newPage).toHaveBeenCalledTimes(2);
    expect(page.close).toHaveBeenCalledTimes(2);
    await session.close();
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it("surfaces browser render errors with the screen id", async () => {
    const page = {
      goto: vi.fn(async () => undefined),
      waitForFunction: vi.fn(async () => undefined),
      evaluate: vi.fn().mockResolvedValueOnce("bad project"),
      close: vi.fn(async () => undefined),
    };
    const context = {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    };
    const browser = { newContext: vi.fn(async () => context), close: vi.fn(async () => undefined) };
    const session = await createRenderBrowserSession({ launch: vi.fn(async () => browser as never) });
    await expect(
      session.renderScreenToPng({
        baseUrl: "http://localhost:4000",
        projectPath: "fixtures/project.json",
        screenId: "s1",
        pixelRatio: 1,
      }),
    ).rejects.toThrow(/s1.*bad project/);
    expect(page.close).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
rtk pnpm --filter @screenshot-studio/cli exec vitest run src/render-driver.test.ts
```

Expected: FAIL because `createRenderBrowserSession` does not exist.

- [ ] **Step 3: Implement the reusable session**

Modify `packages/cli/src/render-driver.ts`:

```ts
import { chromium, type Browser, type BrowserContext } from "playwright";
import { resolve } from "node:path";
import { base64PngToBuffer } from "@screenshot-studio/core/export";

declare global {
  interface Window {
    __stageReady?: boolean;
    __renderError?: string;
    __exportPng?: (pixelRatio: number) => string;
  }
}

export interface RenderOptions {
  baseUrl: string;
  projectPath: string;
  screenId: string;
  pixelRatio: number;
  headless?: boolean;
  timeoutMs?: number;
}

export interface RenderBrowserSession {
  renderScreenToPng: (opts: RenderOptions) => Promise<Buffer>;
  close: () => Promise<void>;
}

interface BrowserSessionOptions {
  headless?: boolean;
  launch?: typeof chromium.launch;
}

export async function createRenderBrowserSession({
  headless = true,
  launch = chromium.launch,
}: BrowserSessionOptions = {}): Promise<RenderBrowserSession> {
  const browser: Browser = await launch.call(chromium, { headless });
  const context: BrowserContext = await browser.newContext();

  return {
    async renderScreenToPng(opts) {
      const { baseUrl, projectPath, screenId, pixelRatio, timeoutMs = 30_000 } = opts;
      const abs = resolve(projectPath);
      const url = `${baseUrl}/render?project=${encodeURIComponent(abs)}&screen=${encodeURIComponent(screenId)}`;
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
        await page.waitForFunction(() => window.__stageReady === true || window.__renderError, null, {
          timeout: timeoutMs,
        });
        const renderError = await page.evaluate(() => window.__renderError);
        if (renderError) throw new Error(`Render failed for screen "${screenId}": ${renderError}`);
        const dataUrl = await page.evaluate((ratio) => window.__exportPng!(ratio), pixelRatio);
        return base64PngToBuffer(dataUrl);
      } finally {
        await page.close();
      }
    },
    async close() {
      await context.close();
      await browser.close();
    },
  };
}

export async function renderScreenToPng(opts: RenderOptions): Promise<Buffer> {
  const session = await createRenderBrowserSession({ headless: opts.headless ?? true });
  try {
    return await session.renderScreenToPng(opts);
  } finally {
    await session.close();
  }
}
```

- [ ] **Step 4: Run the focused tests**

Run:

```bash
rtk pnpm --filter @screenshot-studio/cli exec vitest run src/render-driver.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/cli/src/render-driver.ts packages/cli/src/render-driver.test.ts
rtk git commit -m "feat: reuse a browser context during export"
```

---

### Task 4: Bundle export writer and zip output

**Files:**
- Modify: `package.json`
- Modify: `packages/cli/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/cli/src/export.ts`
- Create: `packages/cli/src/export.test.ts`

**Interfaces:**
- Produces `exportBundle`, `writeBundleOutputs`, and keeps `exportScreenToPng`.
- Adds `jszip` dependency to `@screenshot-studio/cli`.

- [ ] **Step 1: Add JSZip**

Run:

```bash
rtk pnpm --filter @screenshot-studio/cli add jszip
rtk pnpm add -D jszip -w
```

Expected: `packages/cli/package.json` gains runtime `jszip`, root `package.json` gains dev
`jszip` for root-level e2e imports, and `pnpm-lock.yaml` updates.

- [ ] **Step 2: Write the failing tests**

Create `packages/cli/src/export.test.ts`:

```ts
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import type { BundleEntry } from "@screenshot-studio/core/export";
import { inspectPng } from "@screenshot-studio/core/export";
import { exportBundle, writeBundleOutputs } from "./export.js";

function pngBytes(label: string): Buffer {
  // 1x1 transparent PNG; writeBundleOutputs stores exactly what it is handed.
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lYk8XwAAAABJRU5ErkJggg==",
    "base64",
  );
}

const entries = [
  {
    screen: { id: "s1", artboard: { width: 1, height: 1 } },
    target: { id: "one", width: 1, height: 1 },
    relativePath: "apple/iphone/en/01-one-one.png",
  },
  {
    screen: { id: "s2", artboard: { width: 1, height: 1 } },
    target: { id: "two", width: 1, height: 1 },
    relativePath: "android/phone/uk/02-two-two.png",
  },
] as unknown as BundleEntry[];

describe("writeBundleOutputs", () => {
  it("writes PNG files and one zip with matching entries", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "bundle-output-"));
    const zipPath = await writeBundleOutputs({
      outDir,
      entries: [
        { entry: entries[0]!, png: pngBytes("one") },
        { entry: entries[1]!, png: pngBytes("two") },
      ],
    });

    await expect(stat(join(outDir, entries[0]!.relativePath))).resolves.toBeTruthy();
    await expect(stat(join(outDir, entries[1]!.relativePath))).resolves.toBeTruthy();

    const zip = await JSZip.loadAsync(await readFile(zipPath));
    expect(Object.keys(zip.files).sort()).toEqual([
      "android/phone/uk/02-two-two.png",
      "apple/iphone/en/01-one-one.png",
    ]);
  });
});

describe("exportBundle", () => {
  it("renders entries through one session and writes store-ready outputs", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "bundle-export-"));
    const renderScreenToPng = vi.fn(async () => pngBytes("rendered"));
    const zipPath = await exportBundle({
      baseUrl: "http://localhost:4000",
      projectPath: "fixtures/project.json",
      outDir,
      entries,
      renderSession: { renderScreenToPng },
    });

    expect(renderScreenToPng).toHaveBeenCalledTimes(2);
    expect(renderScreenToPng.mock.calls.map((c) => c[0].screenId)).toEqual(["s1", "s2"]);
    await expect(stat(zipPath)).resolves.toBeTruthy();
    const written = await readFile(join(outDir, entries[0]!.relativePath));
    expect(inspectPng(written).hasAlpha).toBe(false);
  });

  it("wraps render errors with screen and target context", async () => {
    await expect(
      exportBundle({
        baseUrl: "http://localhost:4000",
        projectPath: "fixtures/project.json",
        outDir: await mkdtemp(join(tmpdir(), "bundle-export-fail-")),
        entries: [entries[0]!],
        renderSession: {
          renderScreenToPng: vi.fn(async () => {
            throw new Error("boom");
          }),
        },
      }),
    ).rejects.toThrow(/s1.*one.*boom/);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run:

```bash
rtk pnpm --filter @screenshot-studio/cli exec vitest run src/export.test.ts
```

Expected: FAIL because `exportBundle` and `writeBundleOutputs` do not exist.

- [ ] **Step 4: Implement bundle writing and rendering**

Modify `packages/cli/src/export.ts`:

```ts
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import JSZip from "jszip";
import { parseProjectJson, getScreen, type Project } from "@screenshot-studio/core/model";
import {
  parseStoreSpecs,
  findStoreSize,
  exportPixelRatio,
  stripAlpha,
  assertDimensions,
  type StoreSize,
  type BundleEntry,
} from "@screenshot-studio/core/export";
import { renderScreenToPng, type RenderBrowserSession } from "./render-driver.js";

export interface ExportScreenOptions {
  baseUrl: string;
  projectPath: string;
  screenId: string;
  target: StoreSize;
  headless?: boolean;
}

export async function exportScreenToPng(opts: ExportScreenOptions): Promise<Buffer> {
  const { baseUrl, projectPath, screenId, target, headless } = opts;
  const project = await loadProject(projectPath);
  const screen = getScreen(project, screenId);
  const pixelRatio = exportPixelRatio(screen.artboard, { width: target.width, height: target.height });
  const raw = await renderScreenToPng({ baseUrl, projectPath, screenId, pixelRatio, headless });
  const flattened = stripAlpha(raw);
  assertDimensions(flattened, { width: target.width, height: target.height });
  return flattened;
}

async function loadProject(projectPath: string): Promise<Project> {
  return parseProjectJson(await readFile(projectPath, "utf8"));
}

export async function resolveTarget(
  storeSpecsPath: string,
  platform: string,
  device: string,
  sizeId: string,
): Promise<StoreSize> {
  const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
  return findStoreSize(specs, platform, device, sizeId);
}

export interface RenderedBundleEntry {
  entry: BundleEntry;
  png: Buffer;
}

export async function writeBundleOutputs({
  outDir,
  entries,
}: {
  outDir: string;
  entries: RenderedBundleEntry[];
}): Promise<string> {
  const zip = new JSZip();
  for (const { entry, png } of entries) {
    const outFile = join(outDir, entry.relativePath);
    await mkdir(dirname(outFile), { recursive: true });
    await writeFile(outFile, png);
    zip.file(entry.relativePath, png);
  }
  const zipPath = join(outDir, "app-store-screenshots-bundle.zip");
  await mkdir(outDir, { recursive: true });
  await writeFile(zipPath, await zip.generateAsync({ type: "nodebuffer" }));
  return zipPath;
}

export async function exportBundle({
  baseUrl,
  projectPath,
  outDir,
  entries,
  renderSession,
}: {
  baseUrl: string;
  projectPath: string;
  outDir: string;
  entries: BundleEntry[];
  renderSession: Pick<RenderBrowserSession, "renderScreenToPng">;
}): Promise<string> {
  const rendered: RenderedBundleEntry[] = [];
  for (const entry of entries) {
    try {
      const pixelRatio = exportPixelRatio(entry.screen.artboard, {
        width: entry.target.width,
        height: entry.target.height,
      });
      const raw = await renderSession.renderScreenToPng({
        baseUrl,
        projectPath,
        screenId: entry.screen.id,
        pixelRatio,
      });
      const flattened = stripAlpha(raw);
      assertDimensions(flattened, { width: entry.target.width, height: entry.target.height });
      rendered.push({ entry, png: flattened });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to export screen "${entry.screen.id}" target "${entry.target.id}": ${message}`);
    }
  }
  return writeBundleOutputs({ outDir, entries: rendered });
}
```

- [ ] **Step 5: Run the focused tests**

Run:

```bash
rtk pnpm --filter @screenshot-studio/cli exec vitest run src/export.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add package.json packages/cli/package.json pnpm-lock.yaml packages/cli/src/export.ts packages/cli/src/export.test.ts
rtk git commit -m "feat: write bundle export PNGs and zip"
```

---

### Task 5: CLI export mode validation and dispatch

**Files:**
- Modify: `packages/cli/src/index.ts`
- Create: `packages/cli/src/index.test.ts`

**Interfaces:**
- Produces pure `resolveExportMode(flags)` for tests.
- Bundle mode starts one server and one browser session, then calls `exportBundle`.

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveExportMode } from "./index.js";

describe("resolveExportMode", () => {
  it("keeps explicit single-screen export", () => {
    expect(resolveExportMode({ screen: "hero", size: "6.9" })).toEqual({
      kind: "single",
      screenId: "hero",
      sizeId: "6.9",
    });
  });

  it("defaults to bundle mode when no screen or size is supplied", () => {
    expect(resolveExportMode({})).toEqual({ kind: "bundle", filters: {} });
  });

  it("uses bundle filters when no screen is supplied", () => {
    expect(resolveExportMode({ platform: "apple", device: "ipad", locale: "en" })).toEqual({
      kind: "bundle",
      filters: { platform: "apple", device: "ipad", locale: "en" },
    });
  });

  it("rejects size without screen", () => {
    expect(() => resolveExportMode({ size: "6.9" })).toThrow(/--size requires --screen/);
  });

  it("rejects screen mixed with bundle filters", () => {
    expect(() => resolveExportMode({ screen: "hero", platform: "apple" })).toThrow(/cannot be combined/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
rtk pnpm --filter @screenshot-studio/cli exec vitest run src/index.test.ts
```

Expected: FAIL because `resolveExportMode` is not exported.

- [ ] **Step 3: Extract export mode parsing and dispatch bundle mode**

Modify `packages/cli/src/index.ts`:

```ts
#!/usr/bin/env node
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { runInit } from "./init.js";
import { startWebServer } from "./server.js";
import { exportBundle, exportScreenToPng, resolveTarget } from "./export.js";
import { createRenderBrowserSession } from "./render-driver.js";
import { buildBundleEntries, parseStoreSpecs, type BundleFilters } from "@screenshot-studio/core/export";
import { getScreen, parseProjectJson } from "@screenshot-studio/core/model";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const DEFAULT_STORE_SPECS = join(repoRoot, "store-specs.json");

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  return flags;
}

export type ExportMode =
  | { kind: "single"; screenId: string; sizeId: string }
  | { kind: "bundle"; filters: BundleFilters };

export function resolveExportMode(flags: Record<string, string>): ExportMode {
  const hasBundleFilter = Boolean(flags.platform || flags.device || flags.locale);
  if (flags.screen && hasBundleFilter) {
    throw new Error("--screen cannot be combined with --platform, --device, or --locale");
  }
  if (flags.size && !flags.screen) {
    throw new Error("--size requires --screen; bundle exports use each device's lead size");
  }
  if (flags.screen) {
    return { kind: "single", screenId: flags.screen, sizeId: flags.size ?? "6.9" };
  }
  return {
    kind: "bundle",
    filters: {
      platform: flags.platform as BundleFilters["platform"],
      device: flags.device as BundleFilters["device"],
      locale: flags.locale,
    },
  };
}

async function cmdInit(flags: Record<string, string>): Promise<void> {
  const cwd = flags.dir ? resolve(flags.dir) : process.cwd();
  await runInit(cwd, flags.name);
  console.log(`Initialized project in ${cwd}`);
}

async function cmdExport(flags: Record<string, string>): Promise<void> {
  const projectPath = resolve(flags.project ?? "app-store-screenshots.json");
  const storeSpecsPath = flags["store-specs"] ? resolve(flags["store-specs"]) : DEFAULT_STORE_SPECS;
  const outDir = flags.out ? resolve(flags.out) : join(dirname(projectPath), "export");
  const mode = resolveExportMode(flags);
  const project = parseProjectJson(await readFile(projectPath, "utf8"));

  if (mode.kind === "single") {
    const screen = getScreen(project, mode.screenId);
    const target = await resolveTarget(storeSpecsPath, screen.platform, screen.device, mode.sizeId);
    const server = await startWebServer();
    try {
      const png = await exportScreenToPng({ baseUrl: server.url, projectPath, screenId: mode.screenId, target });
      await mkdir(outDir, { recursive: true });
      const outFile = join(outDir, `${screen.platform}-${screen.device}-${target.id}-${screen.locale}.png`);
      await writeFile(outFile, png);
      console.log(`Exported ${outFile} (${target.width}x${target.height})`);
    } finally {
      await server.stop();
    }
    return;
  }

  const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
  const entries = buildBundleEntries(project, specs, mode.filters);
  const server = await startWebServer();
  const session = await createRenderBrowserSession();
  try {
    const zipPath = await exportBundle({
      baseUrl: server.url,
      projectPath,
      outDir,
      entries,
      renderSession: session,
    });
    console.log(`Exported ${entries.length} screenshots to ${outDir}`);
    console.log(`Wrote bundle ${zipPath}`);
  } finally {
    await session.close();
    await server.stop();
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  switch (command) {
    case "init":
      await cmdInit(flags);
      break;
    case "export":
      await cmdExport(flags);
      break;
    default:
      console.error(`Unknown command: ${command ?? "(none)"}\nUsage: screenshots <init|export> [flags]`);
      process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run the focused tests**

Run:

```bash
rtk pnpm --filter @screenshot-studio/cli exec vitest run src/index.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run CLI typecheck**

Run:

```bash
rtk pnpm --filter @screenshot-studio/cli run typecheck
```

Expected: PASS. The `pathToFileURL(process.argv[1])` guard is required so Vitest can import
`resolveExportMode` without executing the CLI.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/cli/src/index.ts packages/cli/src/index.test.ts
rtk git commit -m "feat: add bundle mode to screenshots export"
```

---

### Task 6: Runtime bundle fixture and e2e proof

**Files:**
- Create: `fixtures/phase-2-bundle/app-store-screenshots.json`
- Create: `e2e/bundle-export.test.ts`

**Interfaces:**
- Proves bundle export produces actual PNG files and a zip through the live web renderer.

- [ ] **Step 1: Create the fixture**

Create `fixtures/phase-2-bundle/app-store-screenshots.json`:

```json
{
  "meta": { "name": "Phase 2 Bundle", "schemaVersion": 1 },
  "platforms": ["apple", "android"],
  "locales": ["en", "uk"],
  "fonts": [],
  "screens": [
    {
      "id": "iphone-hero",
      "name": "iPhone Hero",
      "platform": "apple",
      "device": "iphone",
      "locale": "en",
      "artboard": { "width": 1320, "height": 2868 },
      "background": { "type": "solid", "color": "#111111" },
      "elements": [
        {
          "id": "headline",
          "type": "text",
          "x": 120,
          "y": 180,
          "width": 1080,
          "height": 180,
          "content": "iPhone",
          "fontFamily": "sans-serif",
          "size": 96,
          "color": "#FFFFFF"
        }
      ]
    },
    {
      "id": "ipad-hero",
      "name": "iPad Hero",
      "platform": "apple",
      "device": "ipad",
      "locale": "en",
      "artboard": { "width": 2064, "height": 2752 },
      "background": { "type": "solid", "color": "#102A43" },
      "elements": []
    },
    {
      "id": "android-hero",
      "name": "Android Hero",
      "platform": "android",
      "device": "phone",
      "locale": "uk",
      "artboard": { "width": 1080, "height": 1920 },
      "background": { "type": "solid", "color": "#1B4332" },
      "elements": []
    }
  ]
}
```

- [ ] **Step 2: Write the e2e test**

Create `e2e/bundle-export.test.ts`:

```ts
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseProjectJson } from "../packages/core/src/model/index.js";
import { buildBundleEntries, inspectPng, parseStoreSpecs } from "../packages/core/src/export/index.js";
import { startWebServer } from "../packages/cli/src/server.js";
import { createRenderBrowserSession } from "../packages/cli/src/render-driver.js";
import { exportBundle } from "../packages/cli/src/export.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixturePath = resolve(repoRoot, "fixtures/phase-2-bundle/app-store-screenshots.json");
const storeSpecsPath = resolve(repoRoot, "store-specs.json");

describe("Phase 2 bundle export", () => {
  it("exports lead-size PNGs and a zip using one server/browser session", async () => {
    const project = parseProjectJson(await readFile(fixturePath, "utf8"));
    const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
    const entries = buildBundleEntries(project, specs, {});
    const outDir = await mkdtemp(join(tmpdir(), "phase-2-bundle-"));
    const server = await startWebServer();
    const session = await createRenderBrowserSession();
    try {
      const zipPath = await exportBundle({
        baseUrl: server.url,
        projectPath: fixturePath,
        outDir,
        entries,
        renderSession: session,
      });

      for (const entry of entries) {
        const png = await readFile(join(outDir, entry.relativePath));
        const info = inspectPng(png);
        expect(info.width).toBe(entry.target.width);
        expect(info.height).toBe(entry.target.height);
        expect(info.hasAlpha).toBe(false);
      }

      await expect(stat(zipPath)).resolves.toBeTruthy();
      const zip = await JSZip.loadAsync(await readFile(zipPath));
      expect(Object.keys(zip.files).sort()).toEqual(entries.map((e) => e.relativePath).sort());
    } finally {
      await session.close();
      await server.stop();
    }
  }, 180_000);
});
```

- [ ] **Step 3: Run the e2e test**

Run:

```bash
rtk pnpm test:e2e -- bundle-export
```

Expected: PASS and observed output files in a temp directory.

- [ ] **Step 4: Commit**

```bash
rtk git add fixtures/phase-2-bundle/app-store-screenshots.json e2e/bundle-export.test.ts
rtk git commit -m "test: add bundle export e2e proof"
```

---

### Task 7: Full verification and docs sync

**Files:**
- Modify: `README.md` and `AGENTS.md` only if the implemented CLI behavior is ready to document as shipped.
- Modify: `docs/roadmap.md` only if marking Slice 2 complete after all checks pass.

- [ ] **Step 1: Run unit tests**

Run:

```bash
rtk pnpm test
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
rtk pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
rtk pnpm lint
```

Expected: PASS.

- [ ] **Step 4: Run e2e parity and bundle gates**

Run:

```bash
rtk pnpm test:e2e
```

Expected: PASS, including existing parity tests and the new bundle export test.

- [ ] **Step 5: Smoke test the CLI command**

Run:

```bash
rtk pnpm screenshots export --project fixtures/phase-2-bundle/app-store-screenshots.json --out /tmp/screenshot-studio-phase2-bundle
```

Expected:

```text
Exported 3 screenshots to /tmp/screenshot-studio-phase2-bundle
Wrote bundle /tmp/screenshot-studio-phase2-bundle/app-store-screenshots-bundle.zip
```

Then inspect:

```bash
rtk find /tmp/screenshot-studio-phase2-bundle -type f | sort
```

Expected files include:

```text
/tmp/screenshot-studio-phase2-bundle/android/phone/uk/03-android-hero-phone-portrait.png
/tmp/screenshot-studio-phase2-bundle/apple/ipad/en/02-ipad-hero-13.png
/tmp/screenshot-studio-phase2-bundle/apple/iphone/en/01-iphone-hero-6.9.png
/tmp/screenshot-studio-phase2-bundle/app-store-screenshots-bundle.zip
```

- [ ] **Step 6: Update shipped docs**

If all checks pass, update:

- `AGENTS.md`: mark `export [--platform --device --locale]` as shipped for lead-size bundles.
- `README.md`: add a short bundle export example and keep the one-screen `--screen --size` example.
- `docs/roadmap.md`: mark Phase 2 Slice 2 with `✅`.

- [ ] **Step 7: Run docs diff check**

Run:

```bash
rtk git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 8: Commit final docs**

```bash
rtk git add README.md AGENTS.md docs/roadmap.md
rtk git commit -m "docs: mark bundle export orchestration shipped"
```

---

## Self-Review

- Spec coverage: covered lead-size bundle selection, filters, output layout, zip, one server/browser reuse, free port, single-screen compatibility, and error context.
- Out of scope preserved: UI export, artboard validation, `dev/import/screen` commands, new store targets, and alternate renderers are not implemented here.
- Type consistency: `BundleEntry`, `BundleFilters`, `RenderBrowserSession`, and `StoreSize` are introduced before later tasks consume them.
- Main risk: the CLI entrypoint must keep the `pathToFileURL(process.argv[1])` main guard from Task 5; otherwise Vitest imports execute the command.
- Dependency risk: `jszip` is new and requires lockfile update before tests compile.
