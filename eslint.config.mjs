// SPDX-License-Identifier: Apache-2.0
// Flat ESLint config for the monorepo. One config at the root; framework-specific rules
// are scoped by `files` so `packages/core` stays framework-agnostic (no React/Next rules).
// Type-aware linting is intentionally deferred (no parserOptions.project) to keep lint fast
// and avoid wiring the type-checker across every package — TS `strict` already covers types.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import next from "@next/eslint-plugin-next";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/coverage/**",
      "export/**",
      "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    rules: {
      // TypeScript checks identifier resolution itself; core `no-undef` only produces false
      // positives on browser/node globals here.
      "no-undef": "off",
      // Honor the `_`-prefix convention for intentionally-unused bindings (e.g. destructuring
      // to drop a key: `const { $comment: _drop, ...rest } = obj`).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // React hooks correctness — the editor leans on hooks heavily. Register the plugin
    // explicitly; the shipped preset still uses the legacy array `plugins` shape.
    files: ["apps/web/**/*.{ts,tsx}", "packages/ui/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs["recommended-latest"].rules },
  },
  {
    // Next-specific rules only apply to the web host.
    ...next.configs["core-web-vitals"],
    files: ["apps/web/**/*.{ts,tsx}"],
    // App-router project: there is no `pages/` directory for this rule to scan.
    rules: {
      ...next.configs["core-web-vitals"].rules,
      "@next/next/no-html-link-for-pages": "off",
    },
  },
);
