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
      "**/.worktrees/**",
      "export/**",
      // Local design prototypes are reference material, not product source.
      "design/**",
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
    // A core domain may use relative imports internally, but cross-domain dependencies must go
    // through the same public subpath contract consumed by web and CLI.
    files: ["packages/core/src/*/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../*"],
              message: "Import other core domains through @screenshot-studio/core/<domain>.",
            },
          ],
        },
      ],
    },
  },
  {
    // Parent-directory imports in the web host are fragile when files move between app,
    // components, and lib. Keep same-directory imports local and use the stable web alias
    // for every dependency outside the current directory.
    files: ["apps/web/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../**"],
              message: "Import parent-directory dependencies through @web/*.",
            },
          ],
        },
      ],
    },
  },
  {
    // Root-owned E2E tests consume workspace packages through their public subpaths rather
    // than reaching into package source trees by filesystem location.
    files: ["e2e/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?:\\.\\./)+packages/",
              message: "Import workspace packages through @screenshot-studio/*.",
            },
          ],
        },
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
