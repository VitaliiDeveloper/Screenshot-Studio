# Phase 3 Slice 5 — Theme UI

## Goal

Expose the Slice 4 baked theme contract in the editor: assign/clear roles on themeable elements,
inspect available theme files, and apply one through the same pure transformation as the CLI.

## Shared server boundary

Theme directory I/O moves behind an exported Node service in `@screenshot-studio/cli/theme-service`.
Both `screenshots theme set` and the Next API use it; `core` remains filesystem-agnostic.

`/api/themes` is the editor boundary:

- `GET` validates and returns all `themes/*.json`, sorted by id;
- `POST { id }` loads the current project, applies that exact theme, saves it, and returns the
  validated durable project.

Before POST, the editor flushes pending edits through the existing serialized persistence
coordinator. The returned project replaces the store snapshot before the lock is released.

## Editor UI

- The toolbar gains a Themes button and compact picker dialog.
- Each definition shows role colors and optional font identities; Apply is one explicit action.
- Text and shape inspector sections gain a role picker (`none`, `heading`, `body`, `accent`,
  `surface`). Clearing removes the optional field rather than serializing a fake value.
- Applying a theme preserves active screen and selection because ids do not change.

Screenshot/device-frame elements do not show a role picker because Slice 4 has no visual token
to bake into them.

## Out of scope

Theme creation/editing/deletion, live preview, project-level selected-theme state, background
roles, spacing/layout tokens, and templates.

## Verification

- Service/API tests cover sorted listing, strict invalid definitions, apply/persist, missing ids,
  and no partial writes.
- Store tests cover setting/clearing roles and durable project replacement.
- Editor e2e covers role assignment, theme apply, persisted literals, and reload.
- Unit suite, lint, typecheck, and existing e2e remain green.
