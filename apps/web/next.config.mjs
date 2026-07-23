// SPDX-License-Identifier: Apache-2.0
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const monorepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  // Keep Next's development portal out of visual QA and product interaction checks.
  devIndicators: false,
  // core is shipped as TypeScript source across the workspace; let Next transpile it.
  transpilePackages: ["@screenshot-studio/core", "@screenshot-studio/cli"],
  // Playwright ships a native driver; keep it a runtime require rather than letting webpack
  // bundle it into the server route (Next 15 key). The export route runs it on the Node runtime.
  serverExternalPackages: ["playwright", "sharp"],
  reactStrictMode: false,
  webpack: (config) => {
    // Konva optionally requires the node-only `canvas` package for server rendering; we render
    // in the browser only, so stub it out to avoid a "Module not found: canvas" bundle error.
    config.resolve.alias = { ...config.resolve.alias, canvas: false };
    // core uses NodeNext-style ".js" import specifiers that point at ".ts" sources; teach
    // webpack to resolve them (Vitest does this out of the box, webpack needs to be told).
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
