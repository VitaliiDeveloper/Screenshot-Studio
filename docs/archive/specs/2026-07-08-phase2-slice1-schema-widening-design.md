# Phase 2 Slice 1 — Schema widening (platform/device)

Design spec. Deliberately short (see RULES: no heavier than the task needs).
Contract wins: `docs/architecture.md` and the Zod schema.

## Goal & risk retired

Widen the single-platform schema so the verified export bundles Slice 2 ships become
expressible. Today `Screen.platform`/`Screen.device` and `Project.platforms` are `apple`/
`iphone` literals, so an iPad or Google screen cannot even be represented. This slice retires
**"the schema rejects every target in Slice 2's bundle scope"** — nothing more. It does *not*
add bundle export, store-target validation, or new bezels.

### Slice 1/2 bundle scope (Android is deliberately narrow)

Slice 1/2 support **Apple iPhone, Apple iPad, and Google phone _portrait_** — exactly the
device keys `store-specs.json` seeds today. `architecture.md`'s broader Google surfaces
(**phone landscape, 7″ tablet, 10″ tablet, feature graphic**) are **out of Slice 1/2** and land
in a later slice *together with* their `store-specs.json` sizes — schema and specs widen as one
unit so the lockstep invariant below never breaks. With that scope fixed, "the schema rejects
every target Slice 2 must bundle" is exactly true: iPad and Google-phone-portrait are the new
targets, and both become valid here.

The widening is **additive** (`z.literal` → `z.enum`): every existing v1 document stays valid,
`schemaVersion` stays `1`, and **no migration runs** (roadmap §3 carry-in).

## Decisions (locked in brainstorming)

1. **Platform-keyed validation, strict.** `device` is constrained by `platform`; an invalid
   pair (`apple` + `phone`) fails loudly — in the spirit of the `.strict()` schema.
2. **Device set = exactly what `store-specs.json` seeds**, expressed once as an exported
   constant `SCREEN_DEVICES_BY_PLATFORM` (`apple → [iphone, ipad]`, `android → [phone]`). The
   schema enums are built *from* it, and the lockstep test compares it *against* store-specs —
   so no device is admitted that has no export sizes.
3. **`device-frame.deviceType` stays `z.literal("iphone")`.** ipad/android bezels are asset +
   slot-alignment work, not schema-only — out of scope.

## Schema change (`packages/core/src/model/schema.ts`)

**A single source-of-truth constant drives both the schema enums and the lockstep test** — the
`(platform, device)` pair is never hand-written twice:

```ts
/** SoT for which devices each platform allows. Schema enums are built from this; the
 *  store-specs lockstep test compares this against store-specs.json. Widen here + in
 *  store-specs.json in the same change. */
export const SCREEN_DEVICES_BY_PLATFORM = {
  apple: ["iphone", "ipad"],
  android: ["phone"],
} as const;
```

**`Screen` becomes a discriminated union on `platform`**, sharing a `screenBase` spread (the
existing `elementBase` pattern), with each member's `device` enum sourced from the constant:

```ts
const screenBase = {
  id: z.string().min(1),
  name: z.string().min(1),
  locale: z.string().min(1),
  artboard: z.object({ width: z.number().int().positive(),
                       height: z.number().int().positive() }).strict(),
  background: Background,
  elements: z.array(Element),
};
const AppleScreen   = z.object({ platform: z.literal("apple"),
                                 device: z.enum(SCREEN_DEVICES_BY_PLATFORM.apple),   ...screenBase }).strict();
const AndroidScreen = z.object({ platform: z.literal("android"),
                                 device: z.enum(SCREEN_DEVICES_BY_PLATFORM.android), ...screenBase }).strict();
export const Screen = z.discriminatedUnion("platform", [AppleScreen, AndroidScreen]);
```

(`z.enum` accepts the `as const` readonly tuple. Adding a platform is a two-line edit: a new
constant entry + a new union member.)

`z.infer<typeof Screen>` is now a union that statically narrows `device` by `platform`. Safe:
no code uses `Screen.shape`/`.extend`/`.pick`, and `addScreen` **clones** an existing screen
rather than constructing one from literals. The export path (`specs.ts findStoreSize`) already
looks devices up by string, so it is untouched.

*Rejected alternative:* a flat object + `superRefine`. Keeps `Screen` a `ZodObject` but loses
static narrowing — and nothing needs the `ZodObject` API, so the union wins.

**`Project.platforms`:** `z.array(z.literal("apple")).min(1)` →
`z.array(z.enum(platformKeys)).min(1)`, where `platformKeys` are the keys of
`SCREEN_DEVICES_BY_PLATFORM`.

**`platforms` is a derived manifest, not a declared target list.** A `superRefine` on `Project`
enforces:

1. **No duplicates** — `new Set(platforms).size === platforms.length`.
2. **Exact set-equality with screens** — `Set(platforms)` equals `Set(screens.map(s => s.platform))`.

So `platforms` carries no independent state: it is exactly the set of platforms the screens use,
listed once. We reject the looser "declared superset" reading (a platform with no screens)
because no current workflow needs to declare an empty platform ahead of its screens — the
editor's `addScreen` clones an existing screen, and CLI `screen add` (Slice 4) will maintain
`platforms` as it adds screens. Revisit only if such a workflow appears. Error paths point at
the offending screen / the extra platform.

## store-specs alignment

No data change — `store-specs.json` already seeds `apple.iphone`, `apple.ipad`,
`android.phone`. This slice only makes the schema able to *reference* them.

## Lockstep guard (the key new test)

A Vitest unit test asserts the SoT constant `SCREEN_DEVICES_BY_PLATFORM` **equals** the
`(platform, device)` structure of `store-specs.json` — bidirectionally, at the data level, with
**no Zod introspection**:

- Build the specs side by parsing store-specs (`parseStoreSpecs`) and reading
  `Object.keys(specs[platform])` for each platform.
- Compare platform sets and, per platform, device sets both ways.

This fails CI if a future change touches one side but not the other (a schema device with no
export sizes, or an orphan spec). Because the schema enums are *built from* the same constant,
the constant is the one place the pair is declared, and the test pins it to the export data.
This is the durable contract that keeps decision #2 true over time.

## Fixtures + schema tests

- Add minimal valid fixtures for the new combos: one `apple/ipad` and one `android/phone`
  screen (artboards set to their store-specs lead sizes: ipad 2064×2752, phone 1080×1920).
- Schema tests: accept the new combos; **reject** `apple`+`phone` and `android`+`iphone`; and
  for the `platforms` refine — reject a screen platform **missing from** `platforms`, reject a
  platform **listed with no screen**, and reject a **duplicate** in `platforms`.
- Existing `apple/iphone` fixtures and the 21 current schema tests stay green (additive proof).
  Confirm every existing fixture already has `platforms` set-equal to its screen platforms (the
  sample does: `["apple"]` + apple screens) so the stricter refine keeps them valid.

## Out of scope (no duplicate builds)

Bundle export, artboard↔store-target validation/snapping, and the UI export button → **Slice 2/3**.
New bezels, gradient/image backgrounds, `themes`, locales/RTL → later phases.

## Verification

Changed surface: `schema.ts` (constant + `Screen` union + `Project` refine), one new lockstep
test, new schema-test cases, two new fixtures. Matching checks:

- `pnpm test` — the schema tests (accept/reject cases above) and the lockstep unit.
- `pnpm typecheck` — runs across all workspaces (`-r`), covering every consumer of the now
  **union** `Screen` type. Surveyed today, the only `.device`/`.platform` reads are
  `ScreensSection.tsx` (JSX text), `cli/index.ts` (`findStoreSize` args + a filename template) —
  all use the fields as plain strings, which the union still satisfies, so **no ripple is
  expected**. Typecheck is the guard confirming that holds.
- `pnpm lint` — the new/edited files pass ESLint (CI gate).
- A render/export **parity gate** run (`pnpm test:e2e`) stays green: this slice changes no
  rendering code, so the existing apple/iphone output must not move a pixel (the gate asserts
  within-tolerance, not byte-identical — roadmap §4).
