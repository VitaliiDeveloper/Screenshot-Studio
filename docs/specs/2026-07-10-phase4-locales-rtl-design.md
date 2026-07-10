# Phase 4 — Locales and RTL

## Goal

Turn the existing per-screen `locale` label into a complete locale-set workflow and make RTL
screens explicit, editable, and pixel-stable in both the editor and headless export.

Phase 4 does not translate copy automatically. It creates a deterministic target locale from an
existing set, materializes RTL placement when requested, and leaves the translated literals in the
same git-trackable project JSON. Agent-driven translation remains Phase 5.

## Existing baseline

- `Screen.locale` already partitions bundle output and `Project.locales` is recomputed by core
  screen mutations.
- `screen add --locale`, capture import, template creation, and export filtering accept locale
  values, but there is no whole-set add/list/remove workflow.
- The editor presents one flat screen list and Overview renders every locale together.
- Text has physical `left | center | right` alignment. No stored layout direction reaches Konva,
  the inline editor, or new-element defaults.
- Export paths include the raw locale value and screenshot numbering is global rather than scoped
  to each platform/device/locale group.

## Invariants

1. **One project remains the source of truth.** Locale sets are ordinary `Screen[]` entries; no
   translation database, sidecar manifest, or second renderer is introduced.
2. **`Project.locales` is a derived manifest.** It is duplicate-free and set-equal to the locale
   values used by screens, matching the existing `platforms` contract.
3. **Locale identifiers remain explicit strings.** Phase 4 does not silently normalize them,
   require BCP-47, or infer layout direction from a language tag. Existing documents must not
   change pixels merely because a locale happens to be `ar` or `he`.
4. **Direction is stored per screen.** `direction: "ltr" | "rtl"` defaults to `"ltr"`; every
   screen in one locale set must agree. This gives render/export and new-element creation one
   deterministic input without replacing `locales: string[]` with a v2 object model.
5. **RTL conversion is baked.** Horizontal placement and physical text alignment are rewritten in
   project JSON. Render never mirrors geometry implicitly.
6. **One shared render map remains.** The editor and static renderer pass the same screen direction
   to `elementToNodeConfig`; Konva receives an explicit text `direction`.
7. **Editor chrome stays LTR.** Only screenshot content, inline text editing, and locale-aware
   creation use the active screen direction.

## Locale-set model

`cloneLocaleSet(project, sourceLocale, targetLocale, targetDirection)` copies every source screen
in its existing relative order, appends the copies, regenerates every screen and element id, changes
the locale, and recomputes manifests once. Binary asset paths are intentionally shared: cloning a
locale does not duplicate files. A caller can replace localized screenshot assets afterward.

Locale copies are independent after creation. Phase 4 adds no persistent pairing id between an
English screen and its Arabic copy. The source order is the copy-time correspondence; forcing an
ongoing one-to-one relationship would reject legitimate store sets with different counts and would
pull translation workflow state into the render schema.

Removing a locale removes all of its screens, refuses to remove the last locale, and does not delete
assets. Individual screen commands continue to work.

## RTL contract

Changing a screen from one direction to the other is an explicit, idempotent operation: applying
the already-active direction is a no-op. On an actual direction change:

```text
x' = artboard.width - x - width
left <-> right
center stays center
```

The operation applies to every element's placement. It preserves `y`, dimensions, z-order,
opacity, visibility, lock state, content, media pixels, and rotation. This is **placement mirroring**,
not pixel reflection: screenshots and device contents must never be reversed, and rotated-node
reflection would require a different transform/anchor model. A later feature may add an explicit
opposite-tilt tool; Phase 4 does not hide that geometry inside rendering.

Text direction is separate from physical alignment. Konva receives the screen direction so Arabic
and Hebrew shaping, punctuation, numerals, and wrapping have an explicit bidi base direction;
`align` remains the stored physical placement chosen by the baked transform or inspector.

## CLI workflow

The primary interface becomes:

```text
screenshots locale list
screenshots locale add <target> --from <source> [--direction ltr|rtl]
screenshots locale direction <locale> --to <ltr|rtl>
screenshots locale rm <locale>
```

`locale add` defaults to the source direction. `locale direction` is the explicit destructive
placement conversion and is safe to repeat. `screen add` inherits an existing locale's direction;
a brand-new locale created through the lower-level screen command defaults to LTR unless the caller
passes a direction.

## Editor workflow

- The top bar exposes the active locale and opens locale management.
- Structure/Screens and Overview show only the active locale set. Screen labels include the locale
  where ambiguity remains, and drag reorder writes by screen id within the active locale rather than
  passing filtered indices into the global array.
- “Create locale” chooses a source, target identifier, and direction, previews that RTL conversion
  mirrors placement, then persists through the existing serialized project-save boundary.
- Removing a locale requires confirmation; the last locale is protected.
- Changing direction is explicit and idempotent. Inline text editing receives `dir`; newly inserted
  text defaults to right alignment on RTL screens. The inspector keeps physical left/center/right
  controls.
- Templates inherit both locale and direction from the active screen.

## Export contract

- Locale remains the logical bundle grouping key, but the filesystem segment is sanitized before
  joining paths so a free-form value cannot escape the export root.
- Screenshot prefixes restart at `01` for each platform/device/locale group, matching store slot
  order rather than the global project index.
- Filtering remains exact against the stored locale string.
- RTL verification uses a committed, file-backed Arabic-capable font and exercises the same
  UI/headless renderer. No system-font fallback is accepted.

## Execution slices

1. **Locale-set core contract.** Derived locale-manifest validation plus pure clone/remove helpers
   with fresh ids, stable order, shared assets, and focused model tests.
2. **RTL direction + render parity.** Additive screen direction, baked direction conversion,
   render context, inline-render plumbing, an Arabic-capable fixture, and RTL parity coverage.
3. **Locale CLI.** `locale list/add/direction/rm` plus direction-aware `screen add`.
4. **Editor locale workspace.** Locale selector/manager, filtered Screens and Overview,
   locale-scoped reorder, direction-aware insertion/editing, and template inheritance.
5. **Export hardening and closure.** Safe locale path segments, per-group numbering, multi-locale
   export coverage, docs truth, and the full Phase 4 gate.

## Verification

- Slice 1: schema and project-ops tests plus core typecheck.
- Slice 2: schema/project-ops/node-config tests and `test:e2e:parity` with a real RTL font fixture.
- Slice 3: exact locale/screen CLI tests and CLI typecheck.
- Slice 4: editor-store tests and one locale-workspace E2E file registered only in
  `test:e2e:editor`.
- Slice 5: bundle unit tests, targeted export E2E, then one full `test`, `lint`, `typecheck`, and
  `test:e2e` closure gate.

## Out of scope

Automatic translation or copy generation, translation-provider credentials, locale inference from
text, persistent source/translation pairing ids, per-element bidi overrides, pixel reflection,
connected canvas, asset-picker work, and repeated-import overwrite/upsert policy.
