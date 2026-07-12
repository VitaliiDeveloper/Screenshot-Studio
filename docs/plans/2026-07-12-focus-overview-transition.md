# Focus and Overview Canvas Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the stale-zoom jump when switching canvas views and add a short, interruptible camera-style transition.

**Architecture:** Keep the view value owned by `EditorPage`, but let `CanvasViewport` coordinate destination fitting and the visual transition around its existing layout. Reuse the current fit geometry and animate one canvas content wrapper with the Web Animations API, so project state and the shared renderer remain untouched.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Web Animations API, Vitest, Playwright.

## Global Constraints

- Presentation-only: do not modify project JSON, editor history, selection, core rendering, export, or CLI behavior.
- Reuse `fitArtboardsZoom` and `fitArtboardRowsZoom`; do not create a second fit or rendering path.
- Transition duration is approximately 220 ms and rapid view changes settle on the latest request.
- `prefers-reduced-motion: reduce` switches directly to the correctly fitted destination.
- Run only the exact workspace E2E scenario, web typecheck, and diff checks; never run full local Playwright.

---

### Task 1: Establish the browser regression contract

**Files:**
- Modify: `e2e/editor-workspace.test.ts`

**Interfaces:**
- Consumes: `Canvas view`, `Focus`, `Overview`, `canvas-viewport`, and the canvas transition marker.
- Produces: a failing contract that detects the stale destination frame, animation lifecycle, interruption, and reduced-motion bypass.

- [ ] **Step 1: Add a focused failing test**

Add a scenario at the reported viewport and assert the transition lifecycle exposed by the canvas surface:

```ts
it("transitions between fitted Focus and Overview without a stale zoom frame", async () => {
  const page = await browser.newPage({ viewport: { width: 651, height: 998 } });
  await page.goto(`${server.url}/editor`, { waitUntil: "load" });
  await page.waitForSelector("canvas");

  const viewport = page.getByTestId("canvas-viewport");
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect.poll(() => viewport.getAttribute("data-view-transition")).toBe("running");
  await expect.poll(() => viewport.getAttribute("data-view-transition")).toBe("idle");
  expect(await viewport.getAttribute("data-view")).toBe("focus");

  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect.poll(() => viewport.getAttribute("data-view")).toBe("focus");
  await expect.poll(() => viewport.getAttribute("data-view-transition")).toBe("idle");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  expect(await viewport.getAttribute("data-view-transition")).toBe("idle");
  expect(await viewport.getAttribute("data-view")).toBe("overview");
  await page.close();
});
```

During the running assertion, also sample `data-fitted-view` and require it to equal `data-view`; this is the regression guard proving the destination fit is installed before animation exposure.

- [ ] **Step 2: Run the exact scenario and confirm RED**

Run:

```bash
pnpm exec vitest run --config vitest.e2e.config.ts e2e/editor-workspace.test.ts -t "transitions between fitted Focus and Overview"
```

Expected: FAIL because `data-view`, `data-fitted-view`, and `data-view-transition` do not exist.

- [ ] **Step 3: Commit the executable contract**

```bash
git add e2e/editor-workspace.test.ts
git commit -m "test: cover focus overview canvas transition"
```

### Task 2: Fit first and animate the canvas camera

**Files:**
- Modify: `apps/web/components/CanvasViewport.tsx`

**Interfaces:**
- Consumes: the existing `view`, `zoom`, `onZoomChange`, viewport insets, content bounds, and fit helpers.
- Produces: `data-view`, `data-fitted-view`, and `data-view-transition` state plus an interruptible 220 ms camera animation on one content wrapper.

- [ ] **Step 1: Add transition coordination refs and state**

Add a content wrapper ref, the last rendered view, the latest animation, and observable lifecycle state:

```ts
const contentRef = useRef<HTMLDivElement>(null);
const previousViewRef = useRef(view);
const transitionRef = useRef<Animation | null>(null);
const [fittedView, setFittedView] = useState<WorkspaceView>(view);
const [transitioning, setTransitioning] = useState(false);
```

Extract the body of `fit` into a callback that returns the fitted zoom while preserving the existing public `fit()` behavior. The view-change layout effect must calculate the destination zoom, synchronously update `zoomRef` and `onZoomChange`, reset scroll, and set `fittedView` before exposing `running`.

- [ ] **Step 2: Animate one camera wrapper**

After the destination geometry is committed, cancel any prior animation and animate `contentRef.current` from a restrained scale/opacity offset toward its natural position:

```ts
const animation = content.animate(
  [
    { opacity: 0.72, transform: view === "overview" ? "scale(1.025)" : "scale(0.975)" },
    { opacity: 1, transform: "scale(1)" },
  ],
  { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
);
```

Set `transformOrigin` to the active artboard center when it is measurable, falling back to `center center`. Guard completion by animation identity so an interrupted animation cannot clear the newest transition. On cleanup, cancel the active animation and pending animation frames.

If `matchMedia("(prefers-reduced-motion: reduce)").matches`, skip `animate`, set the final scroll/fit immediately, and keep the lifecycle `idle`.

- [ ] **Step 3: Expose stable test and accessibility state**

On `canvas-viewport`, add:

```tsx
data-view={view}
data-fitted-view={fittedView}
data-view-transition={transitioning ? "running" : "idle"}
```

The attributes describe presentation state only and must never affect rendering logic.

- [ ] **Step 4: Run the exact scenario and confirm GREEN**

Run the Task 1 command. Expected: PASS for normal motion, interrupted clicks, and reduced motion.

- [ ] **Step 5: Commit the implementation**

```bash
git add apps/web/components/CanvasViewport.tsx
git commit -m "fix: smooth focus overview canvas transitions"
```

### Task 3: Verify the localized interaction

**Files:**
- Verify: `apps/web/components/CanvasViewport.tsx`
- Verify: `e2e/editor-workspace.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: scoped evidence that the behavior, types, and patch are clean.

- [ ] **Step 1: Run web typecheck**

```bash
pnpm --filter @screenshot-studio/web typecheck
```

Expected: exit 0 with no TypeScript errors.

- [ ] **Step 2: Re-run the exact browser scenario**

Run the Task 1 command. Expected: exit 0 and the transition scenario passes.

- [ ] **Step 3: Inspect the reported viewport manually**

At 651 x 998, switch Focus to Overview to Focus, click rapidly in both directions, and emulate reduced motion. Confirm no stale-zoom frame, the final fitted layouts match Fit, and no interaction is blocked.

- [ ] **Step 4: Validate patch hygiene**

```bash
git diff --check dev...HEAD
git status -sb
```

Expected: no whitespace errors and only intentional worktree changes.
