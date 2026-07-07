# Phase 2 Slice 1 — Schema widening (platform/device)

Design spec. Deliberately short (see RULES: no heavier than the task needs).
Contract wins: `docs/architecture.md` and the Zod schema.

## Goal & risk retired

Widen the single-platform schema so verified Apple **+ Google** export bundles (Slice 2)
become expressible. Today `Screen.platform`/`Screen.device` and `Project.platforms` are
`apple`/`iphone` literals, so a Google or iPad screen cannot even be represented. This slice
retires **"the schema rejects everything Slice 2 must bundle"** — nothing more. It does *not*
add bundle export, store-target validation, or new bezels.

The widening is **additive** (`z.literal` → `z.enum`): every existing v1 document stays valid,
`schemaVersion` stays `1`, and **no migration runs** (roadmap §3 carry-in).

## Decisions (locked in brainstorming)

1. **Platform-keyed validation, strict.** `device` is constrained by `platform`; an invalid
   pair (`apple` + `phone`) fails loudly — in the spirit of the `.strict()` schema.
2. **Device set = exactly what `store-specs.json` seeds.** `apple → {iphone, ipad}`,
   `android → {phone}`. No device is admitted that has no export sizes (schema and store-specs
   stay in lockstep).
3. **`device-frame.deviceType` stays `z.literal("iphone")`.** ipad/android bezels are asset +
   slot-alignment work, not schema-only — out of scope.

## Schema change (`packages/core/src/model/schema.ts`)

**`Screen` becomes a discriminated union on `platform`**, sharing a `screenBase` spread (the
existing `elementBase` pattern):

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
                                 device: z.enum(["iphone", "ipad"]), ...screenBase }).strict();
const AndroidScreen = z.object({ platform: z.literal("android"),
                                 device: z.enum(["phone"]),          ...screenBase }).strict();
export const Screen = z.discriminatedUnion("platform", [AppleScreen, AndroidScreen]);
```

`z.infer<typeof Screen>` is now a union that statically narrows `device` by `platform`. Safe:
no code uses `Screen.shape`/`.extend`/`.pick`, and `addScreen` **clones** an existing screen
rather than constructing one from literals. The export path (`specs.ts findStoreSize`) already
looks devices up by string, so it is untouched.

*Rejected alternative:* a flat object + `superRefine`. Keeps `Screen` a `ZodObject` but loses
static narrowing — and nothing needs the `ZodObject` API, so the union wins.

**`Project.platforms`:** `z.array(z.literal("apple")).min(1)` →
`z.array(z.enum(["apple", "android"])).min(1)`.

**Project-level refine (included):** every `screen.platform` must be listed in
`project.platforms`. Cheap, strict-in-spirit, and stops `platforms` from being an unchecked
duplicate of the per-screen field. Implemented as a `superRefine` on `Project` with a path to
the offending screen.

## store-specs alignment

No data change — `store-specs.json` already seeds `apple.iphone`, `apple.ipad`,
`android.phone`. This slice only makes the schema able to *reference* them.

## Lockstep guard (the key new test)

A Vitest unit test asserts the schema's allowed `(platform, device)` combinations **equal** the
keys present in `store-specs.json` — bidirectionally. This fails CI if a future change adds a
device to one side but not the other (a schema device with no export sizes, or an orphan spec).
This is the durable contract that keeps decision #2 true over time.

## Fixtures + schema tests

- Add minimal valid fixtures for the new combos: one `apple/ipad` and one `android/phone`
  screen (artboards set to their store-specs lead sizes: ipad 2064×2752, phone 1080×1920).
- Schema tests: accept the new combos; **reject** `apple`+`phone` and `android`+`iphone`;
  reject a `Project` whose screen platform is absent from `platforms` (the refine).
- Existing `apple/iphone` fixtures and the 21 current schema tests stay green (additive proof).

## Out of scope (no duplicate builds)

Bundle export, artboard↔store-target validation/snapping, and the UI export button → **Slice 2/3**.
New bezels, gradient/image backgrounds, `themes`, locales/RTL → later phases.

## Verification

- `pnpm test` — schema + lockstep units (the changed surface).
- `pnpm typecheck` — the `Screen` union type change ripples cleanly.
- A render/export **parity gate** run (`pnpm test:e2e`) stays green: this slice changes no
  rendering code, so the existing apple/iphone output must not move a pixel (the gate asserts
  within-tolerance, not byte-identical — roadmap §4).
