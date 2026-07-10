# Phase 7 group model design

Status: ratified for Phase 7 Slice 2. This design widens the enforced document from v2 to v3 and
must pass schema, migration, traversal, shared-renderer, connected-crop, and headed/headless parity
checks before group authoring UI begins.

## Decision

Schema v3 adds one persisted `group` element whose children are existing leaf elements in group-local
coordinates. Persisted groups are exactly one level deep: a group cannot contain another group.

```text
Element = LeafElement | GroupElement

LeafElement = text | shape | screenshot | device-frame

GroupElement
├── id, type: "group", name?
├── x, y, width, height, rotation, opacity, locked, visible
└── children: LeafElement[]  // local coordinates, array order is child z-order
```

`role` remains a leaf concern and is not legal on a group. A group occupies one slot in its owner
screen's `elements` array; that slot defines the complete group's z-order relative to sibling
top-level elements. Child array order defines z-order inside the group.

## Geometry and rendering

- Group `x/y/rotation/opacity` are a Konva parent transform. Child geometry and opacity remain
  literal local values and compose through that parent in the shared `elementToNodeConfig` tree.
- `width/height` are the persisted authoring bounds. They do not create a clip and do not introduce
  a runtime scale. Slice 3 resize bakes scale into group bounds and child literals, returning the
  Konva node to scale 1 exactly as existing element resize does.
- A persisted group does not clip its children. Exact requested-screen stage dimensions remain the
  only export crop, so connected neighbour pixels retain the Phase 6 contract.
- Group visibility suppresses the whole subtree. A hidden child is skipped independently. Group
  opacity multiplies child opacity through ordinary Konva composition. `locked` is authoring-only.
- The interactive editor and static renderer both recurse through the same `NodeConfig` result.
  Internal renderer groups used by screenshot/device-frame leaves may nest below the one persisted
  group; this is render composition, not nested document grouping.
- A top-level group's rendered bounds include transformed child overflow, not only its declared
  `width/height`, when checking connected-to-isolated loss. Snapping and authoring bounds continue to
  use the persisted group box unless a later slice explicitly widens that interaction contract.

## Migration and validation

- `SCHEMA_VERSION` becomes 3. v1 migrates to v2 `isolated`, then v2 migrates to v3 by changing only
  `meta.schemaVersion`; all existing leaf documents are already valid v3 and preserve pixels.
- Current-version input remains strict. Unknown keys, a group inside `children`, an empty child list,
  or a group-level `role` fail validation.
- A v2 reader is not expected to accept v3. The version bump makes that incompatibility explicit
  rather than silently discarding group state.
- No new project-level group manifest, workspace selection, scale, clip, token, or theme state is
  introduced.

## Traversal contract

Core owns reusable one-level tree helpers so every consumer sees the same leaves:

- font resolution visits text leaves inside groups;
- asset collection visits screenshot/device-frame leaves inside groups;
- theme application rewrites role-tagged text/shape leaves and preserves group transforms;
- template validation and instantiation visit children and generate fresh group and child ids;
- screen/locale cloning generates fresh group and child ids;
- RTL direction changes mirror a group at artboard level, then mirror each child inside group width
  and swap physical text alignment exactly once;
- rendering visits visible top-level elements and recursively maps visible children.

CLI commands remain schema-agnostic through the shared project operations; they must not flatten or
silently drop group children.

## Slice boundary

Slice 2 may render and preserve JSON-authored groups but does not add group/ungroup commands,
child selection, group resize UI, nested Layers rows, or keyboard authoring. Those are Slice 3.
New `image`, `icon`, and badge representations remain Slices 4–6.

## Proof requirements

1. Strict schema tests for valid groups and invalid nesting/empty children/group role.
2. v1→v2→v3 and v2→v3 lossless migration tests plus current/future-version refusal.
3. Traversal tests for grouped fonts, assets, themes, templates, clone ids, and RTL.
4. Node mapper/static renderer tests for parent/child transforms, visibility, opacity, and z-order.
5. A JSON-authored connected v3 fixture where a rotated group crosses the owner boundary and exact
   crops contain the expected child pixels.
6. Headed/headless pixel mismatch below the existing parity tolerance and exact output dimensions.
7. The affected core, CLI, web, parity, export, lint, and typecheck gates required by the shared
   schema/render contract.
