import { defineConfig } from "vitest/config";

/**
 * The parity spike harness runs a real Next.js server + Chromium, so it is separated from the
 * fast unit suite (`vitest.config.ts`). This is the Phase 0 gate (docs/roadmap.md §4).
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
