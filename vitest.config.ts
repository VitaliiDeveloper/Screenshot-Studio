import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests run in Node. The browser-dependent parity harness (Playwright) lives in its
    // own package/config so it does not pull a headless browser into every unit run.
    environment: "node",
    include: ["packages/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
  },
});
