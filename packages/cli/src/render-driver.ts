// SPDX-License-Identifier: Apache-2.0
import { chromium, type Browser, type BrowserContext } from "playwright";
import { resolve } from "node:path";
import { base64PngToBuffer } from "@screenshot-studio/core/export";

/**
 * The render host's browser-side contract (mirrors apps/web `RenderStage`). These globals are
 * set inside the page; declaring them here types the `page.evaluate` callbacks, which TypeScript
 * checks in the Node context even though they execute in the browser.
 */
declare global {
  interface Window {
    __stageReady?: boolean;
    __renderError?: string;
    __exportPng?: (pixelRatio: number) => string;
  }
}

/**
 * The one bridge from Node to the browser renderer (docs/architecture.md §2, decision A).
 * Drives a headless (or headed) Chromium to the served `/render` route — the exact same page
 * the future UI export button renders — waits for the readiness gate, then reads the stage via
 * `Stage.toDataURL`. This is why UI and CLI share one rendering path: the CLI never rasterizes
 * anything itself, it screenshots the web renderer.
 *
 * `toDataURL` (not `page.screenshot`) is used deliberately (spec §6): it captures the canvas
 * bitmap at an exact `pixelRatio`, so the only variable between the headed and headless parity
 * renders is the browser environment — which is precisely what the spike measures.
 */
export interface RenderOptions {
  baseUrl: string;
  /** Path to the project JSON. Made absolute before handing to the server. */
  projectPath: string;
  screenId: string;
  pixelRatio: number;
  headless?: boolean;
  /** Fail if the stage is not ready within this window (font load, etc.). */
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

        // Resolve as soon as the stage is ready OR a render error is surfaced, so a bad project
        // fails fast with its validator message instead of timing out opaquely.
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
