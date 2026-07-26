// SPDX-License-Identifier: Apache-2.0
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@web": fileURLToPath(new URL("./apps/web", import.meta.url)),
    },
  },
  test: {
    // Unit tests run in Node. The browser-dependent parity harness (Playwright) lives in its
    // own package/config so it does not pull a headless browser into every unit run.
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "lcov", "html"],
      // Vitest 4 reports only loaded files unless source coverage is scoped explicitly.
      include: ["packages/**/src/**/*.ts", "apps/**/*.ts", "apps/**/*.tsx", "scripts/**/*.ts"],
    },
  },
});
