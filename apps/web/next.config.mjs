/** @type {import('next').NextConfig} */
const nextConfig = {
  // core is shipped as TypeScript source across the workspace; let Next transpile it.
  transpilePackages: ["@screenshot-studio/core"],
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
