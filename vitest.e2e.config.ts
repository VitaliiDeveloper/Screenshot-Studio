// SPDX-License-Identifier: Apache-2.0
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const coreSource = fileURLToPath(new URL("./packages/core/src", import.meta.url));
const cliSource = fileURLToPath(new URL("./packages/cli/src", import.meta.url));

/**
 * Browser tests run real Next.js servers + Chromium, so they stay separate from the fast unit
 * suite (`vitest.config.ts`). Targeted groups cover parity, export, and editor workflows; the
 * the full phase/PR/release gate composes those groups in separate processes so mutable env,
 * browser, and Next.js runtime state cannot leak across unrelated areas.
 */
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@screenshot-studio\/core\/([^/]+)$/,
        replacement: `${coreSource}/$1/index.ts`,
      },
      {
        find: /^@screenshot-studio\/cli\/([^/]+)$/,
        replacement: `${cliSource}/$1.ts`,
      },
    ],
  },
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
