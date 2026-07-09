# Phase 3 Slice 4 — Theme model + CLI

## Goal

Add file-backed theme definitions and `screenshots theme set <id>` without making themes part
of the render contract. Applying a theme is a pure transformation that bakes role tokens into
the existing literal element fields, so editor and export continue to render only `Project`.

## Theme contract

Each `themes/<id>.json` is validated independently from the project:

- `id`, `name`;
- complete role colors for `heading`, `body`, `accent`, and `surface`;
- optional exact font identities per role (`family` + `weight`).

Spacing tokens stay out until a concrete template/layout consumer exists. Unknown keys and
unknown roles fail loudly. Theme ids are lowercase slugs so CLI lookup cannot escape `themes/`.

## Project role + baking

Every element accepts optional `role`. The field is additive, so schema version stays `1`.
`applyTheme(project, theme)`:

- leaves elements without a role byte-for-byte unchanged;
- applies a role color to text `color` and shape `fill`;
- applies an optional role font to text `fontFamily` + `weight`;
- preserves the role so applying another theme remains deterministic;
- rejects a font identity that is not registered in `project.fonts` before returning a project.

Screenshot and device-frame elements may carry role metadata but currently have no themeable
literal fields, so they remain visually unchanged. The renderer and `elementToNodeConfig` are
untouched.

## CLI

`screenshots theme set <id>` loads `themes/<id>.json` beside the selected project, validates it,
applies it, validates the resulting project, and saves through the existing project storage
boundary. Missing files, invalid ids/schema, and unregistered theme fonts are explicit errors.

## Out of scope

Theme discovery/listing, editor UI, live renderer token resolution, project-level theme refs,
spacing/layout mutation, templates, gradients, and background roles.

## Verification

- Schema tests cover optional roles and strict rejection.
- Core tests cover role baking, opt-out behavior, repeated application, and font validation.
- CLI tests cover parsing, theme-file lookup, persistence, and failure without partial writes.
- Unit suite and typecheck remain green.
