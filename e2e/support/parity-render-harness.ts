// SPDX-License-Identifier: Apache-2.0
import {
  createRenderBrowserSession,
  type RenderBrowserSession,
} from "@screenshot-studio/cli/render-driver";
import type { RunningServer } from "@screenshot-studio/cli/server";
import { chromium, type Browser, type LaunchOptions } from "playwright";

export interface ParityRenderHarness {
  server: RunningServer;
  headed: RenderBrowserSession;
  headless: RenderBrowserSession;
  interactive?: Browser;
}

async function closeResources(resources: Array<(() => Promise<void>) | undefined>): Promise<void> {
  const results = await Promise.allSettled(resources.filter((resource) => resource !== undefined)
    .map((resource) => resource!()));
  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Parity harness cleanup failed");
}

// macOS clamps a headed window onto the screen and activates it, whatever its launch flags or CDP bounds say.
// Full Chrome in new headless mode is the same browser build without a window, so local runs leave the desktop alone.
export const headedRunsWindowless = process.platform === "darwin" && !process.env.SCREENSHOTS_E2E_HEADED;

export function launchHeadedChromium(options: LaunchOptions = {}): Promise<Browser> {
  return chromium.launch(headedRunsWindowless
    ? { channel: "chromium", ...options, headless: true }
    : { ...options, headless: false });
}

export async function startParityRenderHarness(
  startServer: () => Promise<RunningServer>,
  launchInteractiveBrowser?: () => Promise<Browser>,
): Promise<ParityRenderHarness> {
  const server = await startServer();
  let headed: RenderBrowserSession | undefined;
  let headless: RenderBrowserSession | undefined;
  let interactive: Browser | undefined;
  try {
    headed = await createRenderBrowserSession({ headless: false, launch: launchHeadedChromium });
    headless = await createRenderBrowserSession();
    interactive = await launchInteractiveBrowser?.();
    return { server, headed, headless, interactive };
  } catch (error) {
    try {
      await closeResources([
        headless && (() => headless!.close()),
        headed && (() => headed!.close()),
        interactive && (() => interactive!.close()),
        () => server.stop(),
      ]);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Parity harness setup and cleanup failed", {
        cause: cleanupError,
      });
    }
    throw error;
  }
}

export async function closeParityRenderHarness(harness?: ParityRenderHarness): Promise<void> {
  if (!harness) return;
  await closeResources([
    () => harness.headless.close(),
    () => harness.headed.close(),
    harness.interactive && (() => harness.interactive!.close()),
    () => harness.server.stop(),
  ]);
}
