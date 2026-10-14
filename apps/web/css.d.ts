// SPDX-License-Identifier: Apache-2.0
// Global stylesheets are side-effect imports. Next declares them in its generated, untracked
// next-env.d.ts, which is missing until the first `next dev`/`next build` (as in a clean CI typecheck).
declare module "*.css";
