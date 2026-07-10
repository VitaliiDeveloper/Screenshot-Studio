# Phase 5 — Agent workflows and local image processing

Status: complete. All four execution slices and the full repository closure gate have passed.

## Goal

Make the existing deterministic project/CLI contract directly usable by a subscription-backed CLI
agent, without adding an AI provider, API key, hosted service, or second project model. Copy
generation, literal layout, and locale translation remain agent procedures over the strict v1 JSON.
Image preprocessing runs locally and produces ordinary project assets.

## Baseline at phase start

- `screenshots init` creates a valid project and the standard directories, but it does not create
  the `AGENTS.md` / `CLAUDE.md` management surface promised by the architecture.
- The CLI already owns safe structural operations for screens, fonts, themes, templates, locales,
  import, and export. Text and element geometry remain editable literals in the strict project JSON.
- Locale cloning and direction conversion are deterministic, but there is no documented agent recipe
  for translating the cloned set without inventing persistent translation state.
- Asset loading accepts project-local files, while background removal and auto-crop have no local CLI
  surface yet.

## Invariants

1. **AI is optional orchestration.** The product remains fully usable without an agent. Phase 5 does
   not add an OpenAI, Anthropic, or other hosted inference dependency.
2. **The strict v1 project stays authoritative.** Agent output is ordinary validated project JSON;
   there is no prompt history, translation pairing, responsive constraint, or generated-copy field.
3. **The CLI owns structural mutations.** Recipes use screen/locale/font/theme/import/export commands
   where they exist and limit direct JSON edits to literals the CLI does not manage.
4. **Auto-layout is baked geometry.** The agent writes explicit `x`, `y`, `width`, `height`, and text
   properties. Render and export never perform a second responsive layout pass.
5. **Translation starts from a locale clone.** `locale add` establishes fresh ids, target direction,
   and stable copy-time correspondence before the agent changes target-locale text or media.
6. **Image processing is local and explicit.** It never runs implicitly during render/export, never
   mutates a source asset in place, and writes a new file under `assets/processed/`.
7. **Generated control files are not overwritten.** `screenshots init` fails before scaffolding when
   its project or agent instruction files already exist.

## Project agent guide

`screenshots init` writes a self-contained `AGENTS.md` beside `app-store-screenshots.json` and a
small `CLAUDE.md` that imports it. The guide is a project-user contract, not a copy of this
repository's contributor instructions. Its canonical source lives with the CLI so initialization
and future packaging share one template.

The guide contains three recipes:

- **Generate copy:** plan one outcome per slide, edit target-locale text literals only, keep registered
  font identities and stable ids, then inspect and export the affected set.
- **Lay out slides:** prefer existing templates, otherwise bake literal geometry and z-order into v1
  elements, keep every artboard independently useful, then inspect at the real artboard ratio.
- **Translate a locale:** clone with `locale add`, choose direction explicitly, translate only the
  cloned literals, replace locale-specific media deliberately, verify glyph coverage, and export the
  exact target locale.

The recipes distinguish the generic `screenshots` executable from the current repository-only
`pnpm screenshots` entry point. Packaging the executable remains Phase 6.

## Local image-processing boundary

Phase 5 adds an `asset` CLI namespace for explicit preprocessing. Auto-crop and background removal
accept a project-local source, write a collision-safe derived file under `assets/processed/`, and
print the persisted relative path for the agent to place in ordinary elements. The source remains
unchanged. Processed transparency is allowed in assets; final store export still strips alpha.

Sharp decodes/encodes RGBA for both operations. A shared four-neighbour edge-connected mask treats
pixels as background when every RGB channel is within the requested tolerance of the top-left colour
(or they are already transparent). Auto-crop takes the remaining foreground bounds; background
removal makes the mask transparent and optionally accepts an explicit RGB reference. This is
intentionally honest flat/near-uniform background processing, not semantic segmentation of arbitrary
scenes. Neither operation reaches the network or enters the render core, web editor, or export path.

The shipped commands are:

```text
screenshots asset auto-crop <file> [--threshold 0..255]
screenshots asset remove-background <file> [--background RRGGBB] [--tolerance 0..255]
```

Relative sources resolve from the project root. Real-path containment rejects traversal and symlink
escapes. Both commands write collision-safe PNGs and print their project-relative output path plus
dimensions; they never update an element automatically.

## Execution slices

1. **Project agent guide scaffold ✅.** Generate `AGENTS.md` plus the `CLAUDE.md` forwarding file from
   `screenshots init`; document copy, literal auto-layout, and locale-translation recipes; preflight
   all control-file collisions; add focused CLI tests.
2. **Deterministic auto-crop CLI ✅.** Add `asset auto-crop` with non-destructive processed output,
   path containment, collision handling, and image-level tests.
3. **Local background removal utility ✅.** Add deterministic edge-connected flat-background removal
   behind the asset-processing boundary, with no API key, network, or render-time dependency.
4. **Dogfood and closure ✅.** Exercise a newly initialized project with a committed fixture asset,
   align public docs, cover the asset commands end to end, and run the Phase 5 closure gate.

## Verification

- Slice 1: `packages/cli/src/init.test.ts`, the CLI package suite, and CLI typecheck.
- Slice 2: focused asset path/image tests plus the CLI package suite and CLI typecheck.
- Slice 3: pixel-level utility tests, one exact CLI integration scenario, and a no-network assertion.
- Slice 4: targeted agent/asset scenarios, then one full `test`, `lint`, `typecheck`, and `test:e2e`
  closure gate.

## Out of scope

Hosted AI APIs, provider credentials, prompt persistence, an in-editor chat panel, automatic
translation during render, a responsive layout engine, new schema fields, persistent locale pairing,
connected canvas, implicit asset mutation, and packaging/publishing the CLI.
