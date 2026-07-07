# Phase 2 Slice 1 — Schema Widening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen the Zod schema from apple/iphone literals to a platform-keyed device union (apple→{iphone,ipad}, android→{phone}) so Slice 2 can bundle Apple iPhone/iPad + Google phone-portrait targets.

**Architecture:** One exported source-of-truth constant `SCREEN_DEVICES_BY_PLATFORM` drives the schema enums; `Screen` becomes a `z.discriminatedUnion` on `platform`; `Project.platforms` becomes a derived manifest enforced by a `superRefine`. A data-level lockstep test pins the constant to `store-specs.json`. No rendering code changes.

**Tech Stack:** TypeScript, Zod 3.25, Vitest. Monorepo package `packages/core`.

## Global Constraints

- **Additive widening only** — `z.literal` → `z.enum`. Every existing v1 document stays valid; `schemaVersion` stays `1`; **no migration** is added or changed.
- **Lockstep** — the schema's `(platform, device)` set must equal `store-specs.json`'s. Widen both in the same change, never one alone.
- **Device scope** — `apple → [iphone, ipad]`, `android → [phone]` only. Do **not** add Google phone-landscape / 7″ / 10″ tablet / feature-graphic (later slice, with their specs).
- **`platforms` is a derived manifest** — no duplicates; its set equals the set of screen platforms. Not a declared superset.
- **`device-frame.deviceType` stays `z.literal("iphone")`** — untouched this slice.
- **Parity untouched** — no rendering code changes; the e2e parity gate must stay green (apple/iphone output must not move a pixel).
- Keep every schema object `.strict()`. KISS/YAGNI.

**Working branch:** `phase-2` (commit directly; phase-branch workflow, no PR to main).

---

### Task 1: SoT constant + `Screen` discriminated union

**Files:**
- Modify: `packages/core/src/model/schema.ts` (the `Screen` block, currently lines ~120–134)
- Test: `packages/core/src/model/schema.test.ts`

**Interfaces:**
- Produces: `export const SCREEN_DEVICES_BY_PLATFORM` (`{ readonly apple: readonly ["iphone","ipad"]; readonly android: readonly ["phone"] }`), `export type Platform`, and a widened `export const Screen` (a `ZodDiscriminatedUnion`, `z.infer` = `AppleScreen | AndroidScreen`).

- [ ] **Step 1: Write the failing test**

Add `Screen` to the existing import in `packages/core/src/model/schema.test.ts` (it currently imports from `./index.js`):

```ts
import { parseProject, ProjectValidationError, getScreen, SCHEMA_VERSION, Element, Screen } from "./index.js";
```

Append this block at the end of the file:

```ts
describe("Screen platform/device union", () => {
  const baseScreen = {
    id: "s1",
    name: "S",
    locale: "en",
    artboard: { width: 1320, height: 2868 },
    background: { type: "solid", color: "#000000" },
    elements: [],
  };

  it("accepts apple/ipad", () => {
    const r = Screen.safeParse({
      ...baseScreen, platform: "apple", device: "ipad",
      artboard: { width: 2064, height: 2752 },
    });
    expect(r.success).toBe(true);
  });

  it("accepts android/phone", () => {
    const r = Screen.safeParse({
      ...baseScreen, platform: "android", device: "phone",
      artboard: { width: 1080, height: 1920 },
    });
    expect(r.success).toBe(true);
  });

  it("rejects apple/phone", () => {
    expect(Screen.safeParse({ ...baseScreen, platform: "apple", device: "phone" }).success).toBe(false);
  });

  it("rejects android/iphone", () => {
    expect(Screen.safeParse({ ...baseScreen, platform: "android", device: "iphone" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @screenshot-studio/core exec vitest run src/model/schema.test.ts -t "platform/device union"`
Expected: FAIL — "accepts apple/ipad" and "accepts android/phone" fail, because today `Screen` is `platform: z.literal("apple")`, `device: z.literal("iphone")`.

- [ ] **Step 3: Widen the schema**

In `packages/core/src/model/schema.ts`, replace the current `Screen` definition:

```ts
export const Screen = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    platform: z.literal("apple"),
    device: z.literal("iphone"),
    locale: z.string().min(1),
    artboard: z
      .object({ width: z.number().int().positive(), height: z.number().int().positive() })
      .strict(),
    background: Background,
    elements: z.array(Element),
  })
  .strict();
export type Screen = z.infer<typeof Screen>;
```

with:

```ts
/**
 * Source of truth for which devices each platform allows. The schema enums below are built
 * from this, and the store-specs lockstep test compares it against store-specs.json — so the
 * pair is declared in exactly one place. Widen HERE and in store-specs.json in the same change.
 */
export const SCREEN_DEVICES_BY_PLATFORM = {
  apple: ["iphone", "ipad"],
  android: ["phone"],
} as const;
export type Platform = keyof typeof SCREEN_DEVICES_BY_PLATFORM;

/** Fields every screen shares, regardless of platform (mirrors the elementBase pattern). */
const screenBase = {
  id: z.string().min(1),
  name: z.string().min(1),
  locale: z.string().min(1),
  artboard: z
    .object({ width: z.number().int().positive(), height: z.number().int().positive() })
    .strict(),
  background: Background,
  elements: z.array(Element),
};

const AppleScreen = z
  .object({
    platform: z.literal("apple"),
    device: z.enum(SCREEN_DEVICES_BY_PLATFORM.apple),
    ...screenBase,
  })
  .strict();

const AndroidScreen = z
  .object({
    platform: z.literal("android"),
    device: z.enum(SCREEN_DEVICES_BY_PLATFORM.android),
    ...screenBase,
  })
  .strict();

/** `device` is constrained by `platform`; an invalid pair (apple+phone) fails validation. */
export const Screen = z.discriminatedUnion("platform", [AppleScreen, AndroidScreen]);
export type Screen = z.infer<typeof Screen>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @screenshot-studio/core exec vitest run src/model/schema.test.ts -t "platform/device union"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/model/schema.ts packages/core/src/model/schema.test.ts
git commit -m "feat: widen Screen to a platform-keyed device union"
```

---

### Task 2: `Project.platforms` enum + derived-manifest refine

**Files:**
- Modify: `packages/core/src/model/schema.ts` (the `Project` block, currently lines ~136–151)
- Test: `packages/core/src/model/schema.test.ts`

**Interfaces:**
- Consumes: `SCREEN_DEVICES_BY_PLATFORM`, `Platform`, `Screen` from Task 1.
- Produces: a widened `export const Project` (now a `ZodEffects` wrapping the strict object; `parseProject`'s `Project.safeParse` still works unchanged).

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/model/schema.test.ts`:

```ts
describe("Project.platforms manifest", () => {
  function androidProject() {
    const p = validProject();
    p.platforms = ["android"];
    p.screens[0]!.platform = "android";
    p.screens[0]!.device = "phone";
    p.screens[0]!.artboard = { width: 1080, height: 1920 };
    return p;
  }

  it("accepts an android/phone project", () => {
    expect(() => parseProject(androidProject())).not.toThrow();
  });

  it("rejects a duplicate platform", () => {
    const bad = validProject();
    bad.platforms = ["apple", "apple"];
    expect(() => parseProject(bad)).toThrow(ProjectValidationError);
  });

  it("rejects a declared platform with no screen", () => {
    const bad = validProject();
    bad.platforms = ["apple", "android"]; // only an apple screen exists
    expect(() => parseProject(bad)).toThrow(ProjectValidationError);
  });

  it("rejects a screen whose platform is not declared", () => {
    const bad = androidProject();
    bad.platforms = ["apple"]; // screen is android
    expect(() => parseProject(bad)).toThrow(ProjectValidationError);
  });
});
```

Note: `validProject()` already exists at the top of this file and returns an apple/iphone project with `platforms: ["apple"]`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @screenshot-studio/core exec vitest run src/model/schema.test.ts -t "platforms manifest"`
Expected: FAIL — "accepts an android/phone project" throws (today `platforms` is `z.array(z.literal("apple"))`), and the duplicate/no-screen/undeclared cases do not throw (no refine yet).

- [ ] **Step 3: Widen `Project`**

In `packages/core/src/model/schema.ts`, add the platform-values tuple right after the `SCREEN_DEVICES_BY_PLATFORM` / `Platform` declarations from Task 1:

```ts
/** Non-empty tuple of platform keys, for z.enum. Safe cast: the constant always has keys. */
const PLATFORM_VALUES = Object.keys(SCREEN_DEVICES_BY_PLATFORM) as [Platform, ...Platform[]];
```

Then replace the current `Project` definition:

```ts
export const Project = z
  .object({
    meta: z
      .object({
        name: z.string().min(1),
        appIcon: z.string().optional(),
        schemaVersion: z.literal(SCHEMA_VERSION),
      })
      .strict(),
    platforms: z.array(z.literal("apple")).min(1),
    locales: z.array(z.string().min(1)).min(1),
    fonts: z.array(FontAsset).default([]),
    screens: z.array(Screen).min(1),
  })
  .strict();
export type Project = z.infer<typeof Project>;
```

with:

```ts
export const Project = z
  .object({
    meta: z
      .object({
        name: z.string().min(1),
        appIcon: z.string().optional(),
        schemaVersion: z.literal(SCHEMA_VERSION),
      })
      .strict(),
    platforms: z.array(z.enum(PLATFORM_VALUES)).min(1),
    locales: z.array(z.string().min(1)).min(1),
    fonts: z.array(FontAsset).default([]),
    screens: z.array(Screen).min(1),
  })
  .strict()
  // `platforms` is a derived manifest: no duplicates, and its set equals the set of platforms
  // the screens actually use (not a declared superset). See the Slice 1 spec.
  .superRefine((proj, ctx) => {
    if (new Set(proj.platforms).size !== proj.platforms.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "platforms must not contain duplicates",
        path: ["platforms"],
      });
    }
    const declared = new Set(proj.platforms);
    const used = new Set(proj.screens.map((s) => s.platform));
    for (const p of declared) {
      if (!used.has(p)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `platform "${p}" is declared but no screen uses it`,
          path: ["platforms"],
        });
      }
    }
    proj.screens.forEach((s, i) => {
      if (!declared.has(s.platform)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `screen platform "${s.platform}" is not listed in platforms`,
          path: ["screens", i, "platform"],
        });
      }
    });
  });
export type Project = z.infer<typeof Project>;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @screenshot-studio/core exec vitest run src/model/schema.test.ts`
Expected: PASS — the new "platforms manifest" block plus all 21 pre-existing tests (the apple/iphone `validProject` stays valid: `["apple"]` set-equals its one apple screen).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/model/schema.ts packages/core/src/model/schema.test.ts
git commit -m "feat: make Project.platforms a validated derived manifest"
```

---

### Task 3: store-specs lockstep test

**Files:**
- Create: `packages/core/src/export/store-specs-lockstep.test.ts`

**Interfaces:**
- Consumes: `SCREEN_DEVICES_BY_PLATFORM` (Task 1, re-exported from `../model/index.js`), `parseStoreSpecs` (`./specs.js`).

- [ ] **Step 1: Write the test**

Create `packages/core/src/export/store-specs-lockstep.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SCREEN_DEVICES_BY_PLATFORM } from "../model/index.js";
import { parseStoreSpecs } from "./specs.js";

// parseStoreSpecs drops the "$comment" key, so specs holds only real platforms.
const specs = parseStoreSpecs(
  JSON.parse(
    readFileSync(fileURLToPath(new URL("../../../../store-specs.json", import.meta.url)), "utf8"),
  ),
);

describe("schema ↔ store-specs lockstep", () => {
  it("declares the same platforms as store-specs", () => {
    expect(new Set(Object.keys(SCREEN_DEVICES_BY_PLATFORM))).toEqual(new Set(Object.keys(specs)));
  });

  it("declares the same devices per platform as store-specs (both directions)", () => {
    for (const [platform, devices] of Object.entries(SCREEN_DEVICES_BY_PLATFORM)) {
      expect(new Set(devices)).toEqual(new Set(Object.keys(specs[platform] ?? {})));
    }
    for (const platform of Object.keys(specs)) {
      expect(Object.keys(SCREEN_DEVICES_BY_PLATFORM)).toContain(platform);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `pnpm --filter @screenshot-studio/core exec vitest run src/export/store-specs-lockstep.test.ts`
Expected: PASS (2 tests). store-specs.json seeds `apple.{iphone,ipad}` and `android.phone`, matching the constant exactly.

- [ ] **Step 3: (Sanity) prove the guard bites**

Temporarily add `"tablet7"` to `SCREEN_DEVICES_BY_PLATFORM.android` in `schema.ts`, re-run the test above, and confirm it now FAILS (device sets differ). Then revert the edit and re-run to confirm PASS again. Do not commit the temporary edit.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/export/store-specs-lockstep.test.ts
git commit -m "test: pin schema device set to store-specs.json (lockstep)"
```

---

### Task 4: Full verification + doc sync

**Files:**
- Modify: `AGENTS.md` (the "Current v1 (enforced today)" block, lines ~57 and ~61)

**Interfaces:**
- Consumes: everything from Tasks 1–3.

- [ ] **Step 1: Update the enforced-schema doc**

In `AGENTS.md`, replace line 57:

```
├── platforms: ["apple"]                   # apple only — android widens in Phase 2
```

with:

```
├── platforms: ["apple" | "android", …]    # derived manifest: set-equal to the screens' platforms
```

and replace line 61:

```
    ├── id, name, platform: "apple", device: "iphone", locale
```

with:

```
    ├── id, name, platform, device, locale  # apple→{iphone,ipad}, android→{phone}
```

- [ ] **Step 2: Typecheck across all workspaces**

Run: `pnpm typecheck`
Expected: PASS. The `Screen` type is now a union; the only `.device`/`.platform` readers (`apps/web/components/ScreensSection.tsx`, `packages/cli/src/index.ts`) use them as strings, so no consumer change is required.

- [ ] **Step 3: Run the full core unit suite + lint**

Run: `pnpm test`
Expected: PASS — all pre-existing tests plus the new union / manifest / lockstep tests.

Run: `pnpm lint`
Expected: PASS (exit 0).

- [ ] **Step 4: Run the render/export parity gate**

Run: `pnpm test:e2e`
Expected: PASS. This slice changes no rendering code, so the apple/iphone parity diff stays within tolerance (roadmap §4). If this is run in CI, it already wraps in `xvfb-run`; locally on macOS it runs headed directly.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md
git commit -m "docs: sync AGENTS.md enforced schema to the widened platform/device union"
```

---

## Notes for the implementer

- Run vitest for a single package with `pnpm --filter @screenshot-studio/core exec vitest run <path>`; the root `pnpm test` runs the whole suite.
- Do **not** touch `store-specs.json`, `migrate.ts`, `device-frames.ts`, or any render/engine file — this slice is schema + tests + one doc block only.
- If `pnpm typecheck` surfaces an unexpected consumer of the old single-object `Screen` shape, stop and report it rather than widening scope; the survey found none, so a hit means something changed.
- **Fixtures for the new combos are inline test objects** (Task 1's `baseScreen` for apple/ipad + android/phone, Task 2's `androidProject`), not new fixture directories. This slice adds no new render/export e2e, so a fixture *file* would have no consumer (YAGNI). The spec's "fixtures" requirement is met by these inline valid+invalid cases.
- **Existing fixture files stay valid** under the stricter `platforms` refine — all five (`phase-0-sample`, `slice-2-screenshot`, `slice-3-device-frame`, incl. `_missing.json`) already have `platforms: ["apple"]` set-equal to their apple screens, verified. Task 4 Step 4 (`pnpm test:e2e`) re-parses them through `parseProject` as the guard.
