// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "vitest/config";

/**
 * Browser tests run real Next.js servers + Chromium, so they stay separate from the fast unit
 * suite (`vitest.config.ts`). Targeted groups cover parity, export, and editor workflows; the
 * the full phase/PR/release gate composes those groups in separate processes so mutable env,
 * browser, and Next.js runtime state cannot leak across unrelated areas.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["e2e/**/*.test.ts"],
    // Server startup + two browser launches; give it room.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // One server for the whole file; no parallel files fighting over the port.
    fileParallelism: false,
  },
});
