# Project Card Quick Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add useful source-safe project-card actions and replace the flickering inline opening message with delayed overlay feedback.

**Architecture:** Keep `ProjectGallery` presentational, let `ProjectLauncher` coordinate opaque-entry activation, and extract the existing Project Home deletion state machine into one reusable hook. Use existing archive/deletion clients and session fences; do not add endpoints or project fields.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, Vitest, existing Lucide/editor UI primitives.

## Global Constraints

- Managed menu: `Project details`, `Export archive`, separator, `Delete project…`.
- Local menu: `Project details`, `Remove from recents`; unavailable local entries expose removal only.
- Local source files must never receive permanent deletion.
- Opening overlay appears only after 200 ms, never changes card dimensions, and respects reduced motion.
- Reuse existing archive, deletion, save-drain, session, and lifecycle paths; no schema or API widening.
- Keep verification economical: focused component/controller tests, `test:web`, and one exact launcher browser file.

---

### Task 1: Gallery Actions And Opening Overlay

**Files:**
- Modify: `apps/web/components/project-launcher/ProjectGallery.tsx`
- Modify: `apps/web/components/project-launcher/ProjectGallery.test.ts`

**Interfaces:**
- Consumes: existing `ProjectLibraryEntry` and `ProjectLibraryAction`.
- Produces: `visibleOpeningEntryId: string | null`, `onExportArchive(entryId)`, and `onDeleteProject(entryId)` props for `ProjectGallery`.

- [ ] **Step 1: Add one focused failing markup test**

Extend the render helper with the three new props, then assert:

```ts
expect(managedMarkup).toContain("Export archive");
expect(managedMarkup).toContain("Delete project…");
expect(localMarkup).not.toContain("Delete project…");
expect(unavailableMarkup).not.toContain("Project details");
expect(openingMarkup).toContain("Opening workspace…");
expect(openingMarkup).not.toContain("mt-3 flex items-center");
```

- [ ] **Step 2: Run the focused test and confirm the new assertions fail**

Run: `rtk env CI=true pnpm exec vitest run apps/web/components/project-launcher/ProjectGallery.test.ts`

- [ ] **Step 3: Implement the minimal presentational changes**

Expand `ProjectLibraryAction["kind"]` to `"opening" | "details" | "archive" | "deleting" | "removing"`. Add Lucide `Download` and `Trash2` menu icons using the existing icon library. Render managed and local action sets exactly as specified. Remove the inline `Opening…` row and render this card-bounded, pointer-transparent overlay only when `visibleOpeningEntryId === entry.entryId`:

```tsx
<span className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-2xl bg-white/80 backdrop-blur-[1px]">
  <span role="status" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-blue-700 shadow-sm">
    <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
    Opening workspace…
  </span>
</span>
```

- [ ] **Step 4: Run the focused test and commit**

Run the Task 1 command again; expect PASS. Commit: `feat: add project card quick actions`.

### Task 2: Shared Managed Deletion Flow And Launcher Actions

**Files:**
- Create: `apps/web/components/project-launcher/useManagedProjectDeletion.ts`
- Create: `apps/web/components/project-launcher/useManagedProjectDeletion.test.ts`
- Modify: `apps/web/components/project-launcher/ProjectHome.tsx`
- Modify: `apps/web/components/project-launcher/ProjectLauncher.tsx`
- Modify: `apps/web/components/project-launcher/AppHomeShell.tsx`
- Modify: `apps/web/components/project-launcher/ProjectLauncher.test.ts`

**Interfaces:**
- Consumes: `ProjectHomeData`, `ProjectDeletionDialog`, `advanceProjectHomeDeletion`, `requestProjectArchive`, and `downloadProjectArchive`.
- Produces:

```ts
export interface ManagedProjectDeletionFlow {
  dialog: ProjectDeletionDialogState | null;
  projectName: string | null;
  confirmation: string;
  acknowledged: boolean;
  open(data: ProjectHomeData): void;
  close(): void;
  exportArchive(): Promise<void>;
  continueWithoutArchive(): void;
  confirm(): Promise<void>;
  retry(): Promise<void>;
  setConfirmation(value: string): void;
  setAcknowledged(value: boolean): void;
}

export function useManagedProjectDeletion(options: {
  onDeleted(projectId: string): void;
}): ManagedProjectDeletionFlow;
```

- [ ] **Step 1: Add targeted failing tests for the extracted controller boundary**

Cover only cancellation reset, archive-error transition, and successful `onDeleted(projectId)` using injected archive/deletion dependencies. Add source assertions that both `ProjectHome` and `ProjectLauncher` call `useManagedProjectDeletion` and that ProjectLauncher uses `switchActiveProject(() => openProjectLibraryEntry(entryId))` before `loadProjectHomeData()`.

- [ ] **Step 2: Run focused tests and confirm they fail for the missing hook**

Run: `rtk env CI=true pnpm exec vitest run apps/web/components/project-launcher/useManagedProjectDeletion.test.ts apps/web/components/project-launcher/ProjectLauncher.test.ts`

- [ ] **Step 3: Extract the existing deletion state without changing its safeguards**

Move the dialog state, confirmation state, attempt holder, archive-first transition, exact-name/acknowledgement gate, pending-save gate, and `advanceProjectHomeDeletion` call from `ProjectHome` into the hook. Preserve the existing error copy and `ProjectDeletionDialog` props. Replace Project Home's local implementation with the hook and keep its current post-delete navigation.

- [ ] **Step 4: Add launcher archive and deletion coordinators**

In `ProjectLauncher`, add one helper that activates the opaque entry and then loads exact Project Home data:

```ts
const loadManagedProjectAction = async (entryId: string) => {
  const opened = await switchActiveProject(() => openProjectLibraryEntry(entryId));
  const loaded = await loadProjectHomeData();
  if (!loaded || loaded.selection.projectId !== opened.projectId) {
    throw new Error("The active project changed before the requested action could start.");
  }
  return loaded;
};
```

`Export archive` requests/downloads with `loaded.selection.projectId` and `loaded.resources.revision`. `Delete project…` calls `deletion.open(loaded)` and renders the shared dialog through `AppHomeShell`. On successful deletion, discard persistence, clear project-keyed workspace navigation, remove the entry from gallery state, and stay on `/`. Route every failure to `projectActionError` and always clear `projectAction`.

- [ ] **Step 5: Run focused tests and commit**

Run the Task 2 command plus `apps/web/components/project-launcher/ProjectDeletionDialog.test.ts`; expect PASS. Commit: `feat: add managed project quick actions`.

### Task 3: Delayed Opening Feedback And Verification

**Files:**
- Create: `apps/web/components/project-launcher/delayed-opening-state.ts`
- Create: `apps/web/components/project-launcher/delayed-opening-state.test.ts`
- Modify: `apps/web/components/project-launcher/ProjectLauncher.tsx`
- Modify: `e2e/launcher-closure.test.ts`
- Modify: `docs/editor.md`
- Modify: `design-qa.md`

**Interfaces:**
- Produces `OPENING_OVERLAY_DELAY_MS = 200` and a small timer lifecycle used only by `ProjectLauncher`.

- [ ] **Step 1: Add one focused timer test**

With fake timers, verify the visible entry stays `null` at 199 ms, becomes the opening entry at 200 ms, and clears on completion. Run it once and confirm the missing implementation fails.

- [ ] **Step 2: Implement the timer lifecycle**

Start it only for `kind: "opening"`; clear it before every new action, in the action `finally`, and on unmount. Pass the visible id through `AppHomeShell` to `ProjectGallery`. Do not delay navigation itself.

- [ ] **Step 3: Update the exact browser journey economically**

In `e2e/launcher-closure.test.ts`, delay the project-library POST once, assert `Opening workspace…` appears without changing the card bounding box, then allow the response and assert `/editor`. Open the managed overflow menu and verify the quick-action labels; open deletion and cancel without deleting the fixture.

- [ ] **Step 4: Run the owned verification gates**

Run:

```bash
rtk env CI=true pnpm test:web
rtk env CI=true pnpm exec vitest run --config vitest.e2e.config.ts e2e/launcher-closure.test.ts
rtk git diff --check
```

Expect all tests to pass and no whitespace errors. Update `docs/editor.md` and `design-qa.md` with the final behavior and captured in-app Browser evidence. Commit: `test: verify project card quick actions`.
