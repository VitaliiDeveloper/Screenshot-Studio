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
  /** Exact persisted project revision that the render host must load. */
  projectRevision?: string;
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

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorsTogether(primary: unknown, cleanup: unknown, action: string): AggregateError {
  return new AggregateError(
    [primary, cleanup],
    `${message(primary)}; ${action}: ${message(cleanup)}`,
    { cause: primary },
  );
}

export async function createRenderBrowserSession({
  headless = true,
  launch = chromium.launch,
}: BrowserSessionOptions = {}): Promise<RenderBrowserSession> {
  const browser: Browser = await launch.call(chromium, { headless });
  let context: BrowserContext;
  try {
    context = await browser.newContext();
  } catch (error) {
    try {
      await browser.close();
    } catch (cleanupError) {
      throw errorsTogether(error, cleanupError, "browser cleanup failed");
    }
    throw error;
  }

  return {
    async renderScreenToPng(opts) {
      const {
        baseUrl,
        projectPath,
        projectRevision,
        screenId,
        pixelRatio,
        timeoutMs = 30_000,
      } = opts;
      const abs = resolve(projectPath);
      const search = new URLSearchParams({ project: abs, screen: screenId });
      if (projectRevision !== undefined) search.set("revision", projectRevision);
      const url = `${baseUrl}/render?${search}`;

      const page = await context.newPage();
      let result: Buffer | undefined;
      let primaryError: unknown;
      let hasPrimaryError = false;
      try {
        await page.goto(url, { waitUntil: "load", timeout: timeoutMs });

        const renderHostError = page.locator("[data-render-error]");
        if (await renderHostError.count() > 0) {
          const detail = await renderHostError.first().textContent();
          throw new Error(`Render failed for screen "${screenId}": ${detail ?? "render host failed"}`);
        }

        // Resolve as soon as the stage is ready OR a render error is surfaced, so a bad project
        // fails fast with its validator message instead of timing out opaquely.
        await page.waitForFunction(() => window.__stageReady === true || window.__renderError, null, {
          timeout: timeoutMs,
        });

        const renderError = await page.evaluate(() => window.__renderError);
        if (renderError) throw new Error(`Render failed for screen "${screenId}": ${renderError}`);

        const dataUrl = await page.evaluate((ratio) => window.__exportPng!(ratio), pixelRatio);
        result = base64PngToBuffer(dataUrl);
      } catch (error) {
        primaryError = error;
        hasPrimaryError = true;
      }
      try {
        await page.close();
      } catch (cleanupError) {
        if (hasPrimaryError) throw errorsTogether(primaryError, cleanupError, "page cleanup failed");
        throw cleanupError;
      }
      if (hasPrimaryError) throw primaryError;
      return result!;
    },
    async close() {
      let contextError: unknown;
      let contextFailed = false;
      try {
        await context.close();
      } catch (error) {
        contextError = error;
        contextFailed = true;
      }
      try {
        await browser.close();
      } catch (browserError) {
        if (contextFailed) throw errorsTogether(contextError, browserError, "browser cleanup failed");
        throw browserError;
      }
      if (contextFailed) throw contextError;
    },
  };
}

interface OneShotRenderDependencies {
  createSession?: typeof createRenderBrowserSession;
}

export async function renderScreenToPng(
  opts: RenderOptions,
  dependencies: OneShotRenderDependencies = {},
): Promise<Buffer> {
  const createSession = dependencies.createSession ?? createRenderBrowserSession;
  const session = await createSession({ headless: opts.headless ?? true });
  let result: Buffer | undefined;
  let primaryError: unknown;
  let hasPrimaryError = false;
  try {
    result = await session.renderScreenToPng(opts);
  } catch (error) {
    primaryError = error;
    hasPrimaryError = true;
  }
  try {
    await session.close();
  } catch (cleanupError) {
    if (hasPrimaryError) {
      throw errorsTogether(primaryError, cleanupError, "render session cleanup failed");
    }
    throw cleanupError;
  }
  if (hasPrimaryError) throw primaryError;
  return result!;
}
