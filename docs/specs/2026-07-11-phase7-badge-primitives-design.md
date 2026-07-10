# Phase 7 Slice 6 — Badge primitives decision

Status: ratified for implementation.

## Decision

Do not add a `badge` schema member. The shipped v5 primitives already represent badge visuals and
editing semantics without loss:

- Rating badge = one ordinary non-nested group of shape + trusted star icon + editable text.
- “As seen on” badge = one ordinary non-nested group of shape + trusted sparkles icon + editable text.
- Official App Store / Google Play badge = one ordinary decorative image selected from project assets
  with non-cropping contain behavior.

Badge meaning does not alter rendering, export, validation, traversal, or lifecycle. A dedicated
union member would duplicate group/image fields and create special-case parity work without adding
document capability.

## Factory contract

Core exposes `createBadgePrimitive({ kind, font, x?, y?, createId? })` for:

- `rating`: `420×120`, dark pill, gold star, “4.9 • 12K ratings” text.
- `as-seen-on`: `460×120`, light card, purple sparkles, “AS SEEN ON” text.

Every call freshens the group and all child ids. Children stay group-local, ordinary, editable v5
leaves. Fonts use an explicitly registered identity supplied by the editor; there is no system-font
fallback. Badge literals carry no theme role, so later theme application does not silently rewrite
them.

## Authoring

- Add → Library exposes Rating badge and As seen on badge. If no registered font exists, the Fonts
  dialog opens instead of creating an unresolved text element.
- Add → Library → Store badge opens a store-specific mode of the existing secure image picker and
  inserts a named `image` element at `420×140`, `fit: contain`.
- After insertion, all editing is ordinary group/image behavior: Layers child inspection, text and
  colour changes, group transform/duplicate/ungroup, history, save, templates, and export.

## Proof

1. Factory schema validity, fresh-id, local geometry, registered font identity, and RTL/group
   traversal tests.
2. Add workflow for both grouped badges, no-font guard, official store-image picker, child editing,
   save, and reload.
3. Headed/headless/UI exact parity of generated badge groups and store-image composition.
4. Assert the enforced schema version remains v5 and `Element` rejects `type: "badge"`.
