# Contributing to Screenshot Studio

Thanks for helping improve Screenshot Studio. Small, focused changes are easiest to review and the
render/export parity contract takes priority over convenience in any one shell.

## Set up the repository

Requirements are Node.js 22.13+ and pnpm 12.10.1 (`npm install -g pnpm@12.10.1`).

```bash
git clone https://github.com/VitaliiDeveloper/Screenshot-Studio.git
cd Screenshot-Studio
./run.sh
```

`./run.sh` installs the pinned dependencies and the Playwright Chromium builds used by export tests,
then starts the editor. Use `./install.sh` to prepare without starting.

Before changing the project, read `AGENTS.md`, `RULES.md`, and only the architecture or tracked
contract section relevant to your change. Keep project JSON inside the enforced schema and keep UI
and CLI pixels on the shared browser renderer.

## Make a change

1. Open an issue for behavior that changes the schema, renderer, export, or documented product contract.
2. Keep the patch to one concern and add the smallest practical regression test.
3. Add `SPDX-License-Identifier: Apache-2.0` to new authored `.ts`, `.tsx`, and `.mjs` source files.
   Do not add text headers to JSON, media, vendored/generated files, lockfiles, or third-party fonts.
4. Start with the narrow package test that covers the changed behavior. Add or run an exact E2E
   file only when that behavior requires a real browser, render host, or packed consumer. Do not run
   the full browser suite locally; CI owns `pnpm test:e2e` for the integration PR from `dev` into
   `main`. The leaf-group ownership and cost matrix lives in `docs/testing.md`.
5. Update public documentation when the user-visible behavior or install path changes.

Commit subjects use `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `build:`, `chore:`, `style:`, or
`perf:` followed by a concise imperative description. Do not add agent attribution trailers.

## License

The project is licensed under Apache-2.0. Unless you explicitly state otherwise, a contribution
intentionally submitted for inclusion is provided under that same license, as described in
`LICENSE`. Preserve applicable notices and keep third-party license texts with their assets.
