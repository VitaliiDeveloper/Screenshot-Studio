# Output Family Screen Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tall all-output Structure list with a horizontally scrollable output-family selector and a list scoped to the active family.

**Architecture:** Reuse the existing `groupScreensByOutput` workspace helper as the only grouping source. Keep selector rendering in a small client component, while `ScreensSection` owns active-screen selection, DnD scope, deletion, and persistence through existing store actions.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Zustand, dnd-kit, Vitest, Playwright.

## Global Constraints

- Preserve strict project schema v6 and render/export parity; this change is editor navigation only.
- Keep connected workspaces and exact-size variant workspaces unchanged.
- Preserve project order and the existing `reorderScreens` family/store-target guard.
- Use ordinary accessible buttons with `aria-pressed`, native keyboard activation, and visible focus rings.
- Do not add dependencies or persistent UI state.
- Keep `fixtures/phase-0-sample/app-store-screenshots.json` out of this change because the running browser session modified it independently.
- Verification is targeted: exact workspace E2E scenario, `test:web`, web typecheck, touched-file ESLint, and `git diff --check`.

---

### Task 1: Specify the family-switching behavior in E2E

**Files:**
- Modify: `e2e/editor-workspace.test.ts`

**Interfaces:**
- Consumes: existing Add Output menu, Structure toggle, Overview output regions, and screen selection.
- Produces: an executable contract for the selector accessible names and visible screen scope.

- [x] **Step 1: Keep the temporary E2E baseline valid for a multi-output sample**

Extend the local baseline type with `platforms: string[]`, then normalize the derived manifest after
filtering screens:

```ts
const baseline = JSON.parse(readFileSync(sample, "utf8")) as {
  platforms: string[];
  screens: Array<{ platform: string; device: string; variantOf?: string; storeTargetId?: string }>;
};
baseline.screens = baseline.screens.filter(/* existing iPhone root predicate */);
baseline.platforms = ["apple"];
```

This changes only the temporary project written under the test's `mkdtemp` directory. It does not
rewrite the sample fixture.

- [x] **Step 2: Add failing assertions after iPad output creation**

Add this block after the existing assertion that the iPad output is current:

```ts
const structureToggle = page.getByRole("button", { name: "Structure panel", exact: true });
if ((await structureToggle.getAttribute("aria-pressed")) !== "true") await structureToggle.click();

const outputFamilies = page.getByRole("navigation", { name: "Output families for en", exact: true });
await expect.poll(() => outputFamilies.getByRole("button").count()).toBe(2);
const ipadSelector = outputFamilies.getByRole("button", { name: "App Store · iPad · 3", exact: true });
expect(await ipadSelector.getAttribute("aria-pressed")).toBe("true");

const ipadScreens = page.getByRole("list", { name: "Screens for en · App Store · iPad", exact: true });
await expect.poll(() => ipadScreens.getByRole("listitem").count()).toBe(3);
expect(await page.getByRole("button", { name: "Hero · iphone", exact: true }).count()).toBe(0);

await outputFamilies.getByRole("button", { name: "App Store · iPhone · 3", exact: true }).click();
const iphoneScreens = page.getByRole("list", { name: "Screens for en · App Store · iPhone", exact: true });
await expect.poll(() => iphoneScreens.getByRole("listitem").count()).toBe(3);
expect(await page.getByRole("button", { name: "Hero · iphone", exact: true }).getAttribute("aria-current"))
  .toBe("true");
expect(await page.getByTestId("overview-output-families").getByRole("region").count()).toBe(2);

await ipadSelector.click();
```

- [x] **Step 3: Run the exact test and confirm RED**

Run:

```bash
pnpm exec vitest run --config vitest.e2e.config.ts e2e/editor-workspace.test.ts -t "creates and opens an independent iPad output set"
```

Expected: FAIL because the `Output families for en` navigation does not exist.

### Task 2: Implement the output-family selector

**Files:**
- Create: `apps/web/components/OutputFamilySwitcher.tsx`
- Modify: `apps/web/components/ScreensSection.tsx`

**Interfaces:**
- Consumes: `OutputFamilyRow[]`, active `platform/device` key, locale, and `onSelect(screenId)` callback.
- Produces: `OutputFamilySwitcher` with horizontally scrollable, auto-revealed pressed buttons.

- [x] **Step 1: Create the focused selector component**

Create a client component with this public interface:

```tsx
export function OutputFamilySwitcher({
  locale,
  rows,
  activeKey,
  onSelect,
}: {
  locale: string;
  rows: readonly OutputFamilyRow[];
  activeKey: string;
  onSelect: (screenId: string) => void;
})
```

It renders:

```tsx
<nav
  ref={railRef}
  aria-label={`Output families for ${locale}`}
  className="flex gap-1 overflow-x-auto border-y border-slate-100 bg-slate-50/80 px-2 py-1.5 [scrollbar-width:thin]"
>
  {rows.map((row) => {
    const active = row.key === activeKey;
    return (
      <button
        key={row.key}
        ref={active ? activeButtonRef : undefined}
        type="button"
        aria-label={`${row.label} · ${row.screens.length}`}
        aria-pressed={active}
        className={cx(
          editorUi.buttonGhost,
          "min-h-7 shrink-0 rounded-md border px-2 text-[10px]",
          active
            ? "border-blue-200 bg-white text-blue-700 shadow-sm hover:bg-white"
            : "border-transparent text-slate-500",
        )}
        onClick={() => onSelect(row.screens[0]!.id)}
      >
        <span>{row.label}</span>
        <span aria-hidden="true" className="text-slate-400">·</span>
        <span>{row.screens.length}</span>
      </button>
    );
  })}
</nav>
```

Use `useEffect`, `railRef`, and `activeButtonRef` to adjust only `railRef.current.scrollLeft` when the active button falls outside the rail's visible left or right edge. Do not call page-level `scrollIntoView`.

- [x] **Step 2: Scope `ScreensSection` to the active family**

Replace the inline `platform/device` heading logic with:

```tsx
const outputRows = project.mode === "isolated" && activeScreen?.variantOf === undefined
  ? groupScreensByOutput(screens)
  : [];
const activeOutputKey = activeScreen ? `${activeScreen.platform}/${activeScreen.device}` : "";
const showOutputSwitcher = outputRows.length > 1;
const visibleScreens = showOutputSwitcher
  ? outputRows.find((row) => row.key === activeOutputKey)?.screens ?? outputRows[0]!.screens
  : screens;
const visibleOutput = showOutputSwitcher
  ? outputRows.find((row) => row.key === activeOutputKey) ?? outputRows[0]!
  : undefined;
const listLabel = visibleOutput
  ? `Screens for ${activeLocale} · ${visibleOutput.label}`
  : project.mode === "connected" && activeScreen
    ? `Screens for ${activeLocale} ${activeScreen.device} group`
    : `Screens for ${activeLocale}`;
```

Render `OutputFamilySwitcher` only when `showOutputSwitcher` is true. Pass `visibleScreens` to
`SortableContext` and map only `visibleScreens`. Badge numbering uses the visible zero-based index.
Remove `Fragment`, repeated output headings, and the explanatory paragraph.

- [x] **Step 3: Run the exact test and confirm GREEN**

Run the same command as Task 1 Step 3.

Expected: one selected test passes and proves family selection, visible-list scoping, and Overview preservation.

### Task 3: Verify and checkpoint the implementation

**Files:**
- Modify only if verification reveals a scoped defect: `apps/web/components/OutputFamilySwitcher.tsx`, `apps/web/components/ScreensSection.tsx`, `e2e/editor-workspace.test.ts`

**Interfaces:**
- Consumes: completed selector implementation and exact E2E contract.
- Produces: verified, reviewable git checkpoint.

- [x] **Step 1: Run targeted verification**

```bash
pnpm test:web
pnpm --filter @screenshot-studio/web typecheck
pnpm exec eslint apps/web/components/OutputFamilySwitcher.tsx apps/web/components/ScreensSection.tsx e2e/editor-workspace.test.ts
pnpm exec vitest run --config vitest.e2e.config.ts e2e/editor-workspace.test.ts -t "creates and opens an independent iPad output set"
git diff --check
```

Expected: all commands exit 0.

- [x] **Step 2: Review the scoped diff**

Confirm the diff contains the plan, selector component, Screens integration, and targeted E2E only. Confirm the independently modified fixture remains unstaged.

- [x] **Step 3: Commit the implementation**

```bash
git add docs/archive/plans/2026-07-12-output-family-screen-switcher.md \
  apps/web/components/OutputFamilySwitcher.tsx \
  apps/web/components/ScreensSection.tsx \
  e2e/editor-workspace.test.ts
git commit -m "feat: add output family screen switcher"
```
