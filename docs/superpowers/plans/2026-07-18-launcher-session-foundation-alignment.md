# Launcher Session Foundation Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the current draft PR with canonical Launcher 1/7 by retaining the source-neutral active-session foundation while removing the raw browser filesystem-path activation surface and its public POST API.

**Architecture:** Explicit `PROJECT_PATH` and `screenshots dev --project` startup continue opening the `local-file` adapter. Browser App Home becomes an honest no-active-project foundation state; Launcher 2/7 and 3/7 later add managed storage and Folder/ZIP/JSON import. Project-bound APIs continue resolving the same active session, and the local source still exposes its exact display path on minimal Project Home.

**Tech Stack:** TypeScript, Next.js App Router, React 19, Vitest, Playwright, pnpm 11, shared `@screenshot-studio/core` storage/model services.

## Global Constraints

- `app-store-screenshots.json` remains the single persisted Project document.
- Do not add managed storage, Folder/ZIP/JSON import, project archive export, project creation, full Project Home, capture import, or recents in Launcher 1/7.
- Do not expose a raw absolute-path input or arbitrary local-path activation endpoint in the normal web launcher.
- Preserve `PROJECT_PATH` and `screenshots dev --project` startup compatibility through `LocalFileProjectSourceAdapter`.
- Every project-bound route continues resolving one active session and revision.
- Preserve the existing shared core model, browser renderer, store-image export, mutation locking, and safe-file-publication contracts.
- Use only focused local browser coverage; do not run the full local E2E suite.
- Shell commands in this repository run through `rtk`.

---

## File map

- `apps/web/app/api/project-session/route.ts` — GET-only public session descriptor route.
- `apps/web/app/api/project-session/handler.ts` — active-session GET resolution and cookie response; no browser path parsing.
- `apps/web/app/api/project-session/route.test.ts` — GET/configured-source contract and absence of POST activation.
- `apps/web/lib/project-session.ts` — source-neutral descriptor client and GET helper only.
- `apps/web/lib/project-session.test.ts` — client GET/204/error behavior.
- `apps/web/components/project-launcher/ProjectLauncher.tsx` — honest foundation App Home without a path field.
- `apps/web/components/project-launcher/ProjectHome.tsx` — minimal source-capability-aware Home and neutral launcher link copy.
- `apps/web/app/editor/page.tsx` — neutral recovery link copy.
- `e2e/project-launcher.test.ts` — smallest exact no-source and configured-local-source browser scenarios.
- `README.md` — current runnable launcher behavior and explicit local startup.
- `docs/architecture.md` — canonical current/future deployment mapping and Launcher 1/7 boundary.
- `docs/editor.md` — current App Home, error, and minimal Project Home states.

---

### Task 1: Remove browser local-path activation from the session API

**Files:**
- Modify: `apps/web/app/api/project-session/route.test.ts`
- Modify: `apps/web/app/api/project-session/route.ts`
- Modify: `apps/web/app/api/project-session/handler.ts`
- Modify: `apps/web/lib/project-session.test.ts`
- Modify: `apps/web/lib/project-session.ts`

**Interfaces:**
- Consumes: `resolveActiveProjectSession(request, dependencies)` and configured `local-file` startup from `apps/web/lib/project-session.server.ts`.
- Produces: GET-only `/api/project-session` returning `ActiveProjectDescriptor | 204`; no exported `POST` handler and no client `openLocalProject(path)` helper.

- [ ] **Step 1: Add a failing API-surface test**

Add the route-module import and this case to `apps/web/app/api/project-session/route.test.ts`:

```ts
import * as projectSessionRoute from "./route.js";

it("does not expose browser local-path activation", () => {
  expect("POST" in projectSessionRoute).toBe(false);
});
```

Keep the existing GET tests for 204 and configured-path bootstrap. Delete the three cases that call `handleProjectSessionPost` because that contract is no longer owned by Launcher 1/7.

- [ ] **Step 2: Run the test and verify the current route fails the new boundary**

Run:

```bash
rtk pnpm exec vitest run apps/web/app/api/project-session/route.test.ts
```

Expected: FAIL because `route.ts` still exports `POST`.

- [ ] **Step 3: Remove the public POST implementation**

Replace `apps/web/app/api/project-session/route.ts` with:

```ts
// SPDX-License-Identifier: Apache-2.0
import { handleProjectSessionGet } from "./handler.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleProjectSessionGet(request);
}
```

Delete `handleProjectSessionPost` from `apps/web/app/api/project-session/handler.ts`. Retain `cookieValue`, `clearCookie`, `descriptorResponse`, and `handleProjectSessionGet`; configured startup must still set the opaque session cookie.

- [ ] **Step 4: Remove the obsolete client path helper**

Delete `openLocalProject` from `apps/web/lib/project-session.ts`. Replace the obsolete client failure test with GET failure coverage in `apps/web/lib/project-session.test.ts`:

```ts
it("returns the server error when active-session lookup fails", async () => {
  const fetcher = vi.fn(async () => Response.json(
    { error: "Invalid configured project document" },
    { status: 422 },
  ));

  await expect(fetchActiveProject(fetcher))
    .rejects.toThrow("Invalid configured project document");
});
```

- [ ] **Step 5: Run focused API/client tests**

Run:

```bash
rtk pnpm exec vitest run apps/web/app/api/project-session/route.test.ts apps/web/lib/project-session.test.ts apps/web/lib/project-session.server.test.ts
```

Expected: all selected tests PASS; the route exposes GET only, configured startup creates a session, and the descriptor remains source-neutral.

- [ ] **Step 6: Commit the API boundary**

```bash
rtk git add apps/web/app/api/project-session/route.ts apps/web/app/api/project-session/handler.ts apps/web/app/api/project-session/route.test.ts apps/web/lib/project-session.ts apps/web/lib/project-session.test.ts
rtk git commit -m "fix: remove browser path activation endpoint"
```

---

### Task 2: Replace the raw path form with an honest foundation App Home

**Files:**
- Modify: `e2e/project-launcher.test.ts`
- Modify: `apps/web/components/project-launcher/ProjectLauncher.tsx`
- Modify: `apps/web/components/project-launcher/ProjectHome.tsx`
- Modify: `apps/web/app/editor/page.tsx`

**Interfaces:**
- Consumes: `fetchActiveProject()` and the source-neutral `ActiveProjectDescriptor`.
- Produces: App Home with no textbox/form; configured local startup still redirects to minimal Project Home; Project Home reveals an exact location only when `capabilities.revealLocation` and `displayLocation` permit it.

- [ ] **Step 1: Replace launcher E2E expectations first**

Rewrite `e2e/project-launcher.test.ts` around two independently started hosts:

```ts
it("shows an honest no-active-project App Home without a path field", async () => {
  const server = await startWebServer(undefined, {
    storeSpecsPath: resolve(repoRoot, "store-specs.json"),
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    await page.goto(server.url, { waitUntil: "load" });
    await page.getByRole("heading", { name: "No active project" }).waitFor();
    expect(await page.getByRole("textbox").count()).toBe(0);
    expect(await page.getByText("PROJECT_PATH", { exact: false }).count()).toBeGreaterThan(0);
  } finally {
    await context.close();
    await server.stop();
  }
});

it("opens a configured local project through the same Home and Workspace session", async () => {
  const server = await startWebServer(projectPath, {
    storeSpecsPath: resolve(repoRoot, "store-specs.json"),
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    await page.goto(server.url, { waitUntil: "load" });
    await page.waitForURL(`${server.url}/home`);
    await page.getByRole("heading", { name: projectName, exact: true }).waitFor();
    expect(await page.getByText(realpathSync(projectPath), { exact: true }).count()).toBe(1);
    await page.getByRole("link", { name: "Open workspace" }).click();
    await page.waitForURL(`${server.url}/editor`);
    await page.waitForSelector("canvas");
  } finally {
    await context.close();
    await server.stop();
  }
});
```

Keep the fixture copied into a temporary project root and preserve/restore inherited `PROJECT_PATH`. Remove UI path switching, identical-revision A/B, and failed-drain browser scenarios; their owned coordinator, identity, and resource cleanup contracts remain covered by focused web tests.

- [ ] **Step 2: Run the exact browser file and verify the old form fails**

Run:

```bash
rtk pnpm exec vitest run --config vitest.e2e.config.ts e2e/project-launcher.test.ts
```

Expected: the no-source scenario FAILS because the old page renders “Open a screenshot project” and a textbox.

- [ ] **Step 3: Implement the foundation App Home**

In `ProjectLauncher.tsx`, remove `FormEvent`, path/opening state, `openLocalProject`, `switchActiveProject`, the form, and its path copy. Keep the active-session redirect and error handling. Render this state:

```tsx
<main className="min-h-dvh bg-[var(--editor-color-surface-subtle)] px-6 py-12">
  <section className="mx-auto max-w-3xl">
    <p className={editorUi.sectionLabel}>Screenshot Studio</p>
    <h1 className="mt-3 text-4xl font-semibold text-[color:var(--editor-color-text-strong)]">
      No active project
    </h1>
    <p className="mt-3 max-w-2xl text-sm text-[color:var(--editor-color-text-secondary)]">
      Browser project import is delivered by the next launcher workflow. This foundation build opens local projects through explicit CLI or server startup.
    </p>
    {error ? <p role="alert" className={`mt-6 ${editorUi.statusError}`}>{error}</p> : null}
    <section className="mt-8 rounded-2xl border border-[var(--editor-color-border)] bg-white p-6 shadow-sm" aria-labelledby="local-startup-title">
      <h2 id="local-startup-title" className="text-base font-semibold">Open a local project for now</h2>
      <p className="mt-2 text-sm text-[color:var(--editor-color-text-secondary)]">
        Start Screenshot Studio with <code>screenshots dev --project …</code> or set <code>PROJECT_PATH</code>. App Home never asks you to paste that path into a web form.
      </p>
    </section>
  </section>
</main>
```

The ellipsis is display copy, not an executable placeholder.

- [ ] **Step 4: Make navigation copy source-neutral**

In `ProjectHome.tsx`, keep the capability-gated location block unchanged. Rename the secondary link from `Open another project` to `Project launcher`.

In `apps/web/app/editor/page.tsx`, rename the recovery link from `Open another project` to `Return to project launcher`. Keep `href="/?switch=1"` so the user can reach the foundation launcher state without clearing or mutating the active session.

- [ ] **Step 5: Run focused unit and exact browser verification**

Run:

```bash
rtk pnpm test:web
rtk pnpm exec vitest run --config vitest.e2e.config.ts e2e/project-launcher.test.ts
```

Expected: all web tests PASS and both launcher browser scenarios PASS.

- [ ] **Step 6: Commit the UI boundary**

```bash
rtk git add apps/web/components/project-launcher/ProjectLauncher.tsx apps/web/components/project-launcher/ProjectHome.tsx apps/web/app/editor/page.tsx e2e/project-launcher.test.ts
rtk git commit -m "fix: align App Home with launcher foundation"
```

---

### Task 3: Align durable documentation with Launcher 1/7 and the 1/7–7/7 map

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/editor.md`

**Interfaces:**
- Consumes: the approved cross-slice design and current Launcher 1/7 behavior.
- Produces: documentation that clearly separates current explicit local startup from future managed browser import and never claims the web UI accepts a raw path.

- [ ] **Step 1: Update README Quick Start and Editor sections**

Replace the path-form explanation with:

```md
Without an explicit project source, App Home reports that no project is active and never opens or
autosaves the bundled sample. The Launcher 1/7 foundation intentionally does not expose a browser
filesystem-path form. Start a local project explicitly with `PROJECT_PATH=... pnpm dev` or
`screenshots dev --project ...`; browser Folder/ZIP/JSON import is delivered through managed project
storage in the later launcher slices.
```

In the Editor section, state that `pnpm dev` shows the no-active-project App Home and list the two explicit local startup commands. Do not say “Open an existing project there.”

- [ ] **Step 2: Update the architecture deployment mapping and examples**

Replace the local path form row/example with source-honest rows:

```md
| CLI-seeded local web | `PROJECT_PATH` or `screenshots dev --project` | Canonical local JSON path | Exact path | `local-file`; implemented in Launcher 1/7 |
| Managed browser web | Folder/ZIP/JSON import | Opaque managed project id | Project name / managed label | `managed-project`; Launcher 2/7–3/7 |
| Electron or another desktop shell | Native OS open dialog | Canonical local JSON path | Exact path | The same `local-file` adapter; future shell |
| Hosted cloud project | Authenticated project catalog | Provider-owned project id | Project/workspace label or URL | `cloud-project`; future adapter |
```

The local example must use:

```bash
PROJECT_PATH=/Users/alex/Projects/MyAppScreenshots/app-store-screenshots.json pnpm dev
```

Update “Compatibility and first delivery” to say Launcher 1/7 exposes no browser path activation, seeds only explicit startup sources, and leaves managed storage/import to Launcher 2/7–3/7.

- [ ] **Step 3: Update editor states**

Replace the path-centric states with:

```md
- **No active project** → App Home states that no source is active and explains explicit CLI/server startup; it exposes no raw path field and never selects the bundled sample implicitly.
- **Invalid configured local project** → App Home shows the validation/path error without activating or mutating a project.
- **Selected local project** → minimal Project Home shows source identity and the exact location only because the local source reports `revealLocation`; managed-source identity and the full overview belong to later launcher slices.
```

- [ ] **Step 4: Check stale copy and Markdown**

Run:

```bash
rtk rg -n "asks for the existing absolute path|Open an existing project there|Project file path|enters:" README.md docs/architecture.md docs/editor.md
rtk git diff --check
```

Expected: the stale path-form phrases are absent and `git diff --check` reports no errors.

- [ ] **Step 5: Commit durable docs**

```bash
rtk git add README.md docs/architecture.md docs/editor.md
rtk git commit -m "docs: align launcher foundation workflow"
```

---

### Task 4: Final Slice 1 verification and PR handoff

**Files:**
- Verify only; no planned source changes.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: evidence that the current draft PR satisfies Launcher 1/7 and remains compatible with later managed sources.

- [ ] **Step 1: Run exact static and web checks**

```bash
rtk pnpm --filter @screenshot-studio/web typecheck
rtk pnpm test:web
rtk pnpm lint
```

Expected: all commands exit 0.

- [ ] **Step 2: Run only the launcher browser file**

```bash
rtk pnpm exec vitest run --config vitest.e2e.config.ts e2e/project-launcher.test.ts
```

Expected: both no-source and configured-local-source scenarios PASS. Do not run the full local E2E suite.

- [ ] **Step 3: Verify scope and repository state**

```bash
rtk rg -n "openLocalProject|handleProjectSessionPost|Project file path|Open a screenshot project" apps/web e2e README.md docs/architecture.md docs/editor.md
rtk git diff --check
rtk git status --short --branch
```

Expected: no obsolete browser path activation symbols/copy, no whitespace errors, and only intentional commits ahead of the remote branch.

- [ ] **Step 4: Push and update the draft PR description**

Push the branch and update draft PR #31 to identify it as **Launcher 1/7 — active project session foundation**. The PR description must list the retained session/API work, the removed raw path surface, exact verification commands, and explicit deferrals to Launcher 2/7–7/7.
