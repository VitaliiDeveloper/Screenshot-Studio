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

// Headed stays headed for parity; on macOS park its window off-screen so it does not cover the desktop.
export function launchHeadedChromium(options: LaunchOptions = {}): Promise<Browser> {
  const args = process.platform === "darwin"
    ? [...(options.args ?? []), "--window-position=-32000,-32000"]
    : options.args;
  return chromium.launch({ ...options, headless: false, args });
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
