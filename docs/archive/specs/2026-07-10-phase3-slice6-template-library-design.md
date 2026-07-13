# Phase 3 Slice 6 — Template library

## Goal

Create a new screen from a strict project-local `templates/*.json` definition without adding a
second layout/render path. A template supplies ordinary background/element literals and a target
platform/device/artboard; the resulting screen is an ordinary `Project` screen.

## Template contract

Each definition contains:

- lowercase slug `id`, display `name`, optional `description`;
- one schema-valid platform/device pair and exact artboard dimensions;
- current background and element shapes from the enforced project schema.

Locale is deliberately absent. The editor supplies the active screen's locale when creating a
screen, so one layout can be reused across locale sets without embedding locale state.

Templates are exact layouts, not responsive algorithms. No implicit coordinate/font scaling occurs;
separate device/artboard variants remain separate files. Unknown keys and filename/id mismatches fail.

## Instantiation

`createScreenFromTemplate(project, template, locale)` is pure and:

- verifies every template text font identity is registered in the project;
- generates fresh ids for the new screen and every element (editor patches search globally by id);
- appends through the existing manifest recomputation path;
- keeps schema version `1` because templates remain outside `Project`.

## Service, API, and UI

The shared Node service lists/loads/instantiates templates for the current project directory.
`GET /api/templates` returns sorted definitions. `POST { id, locale }` creates and persists one
screen, returning the durable project and created screen id.

The toolbar Templates dialog lists platform/device/size and element count. Create uses the active
screen's locale, then replaces the durable project in the store and selects the new screen.

## Out of scope

Template authoring/edit/delete UI, a CLI command, responsive scaling, placeholders/variable
substitution, remote catalogues, preview thumbnails, and applying a template over an existing screen.

## Verification

- Core tests cover schema strictness, fresh ids, manifests, locale injection, and font rejection.
- Service/API tests cover sorted list, filename validation, create/persist, and explicit errors.
- Editor e2e covers create, selection, disk persistence, and reload.
- Full unit suite, lint, typecheck, and full e2e remain green.
