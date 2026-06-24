# Roadmap & Execution Plan

Scope, sequencing, and risks. This is the part that changes often.
Version 0.4, 24 June 2026.

The guiding principle: ship a **thin vertical slice** first, and prove the riskiest thesis
before building on top of it. Everything visually impressive (connected canvas, AI, themes,
templates) lives *after* the MVP.

---

## 1. MVP scope (thin slice: import → edit → export)

What makes the cut for the first usable, dogfoodable version:

- Elements: `text`, `screenshot`, `device-frame`, `shape`.
- A basic inspector (type-specific properties).
- A screen list — **isolated artboards only** (no connected canvas).
- Save / load the project JSON (strict Zod validation).
- Apple + Google export at verified sizes.
- CLI: `init`, `dev`, `export`.

**Out of the MVP (post-MVP):** snapping & smart guides, undo/redo *UI*, element grouping, the
font-management UI, themes, templates, locales / RTL, connected canvas, AI assistance.

**State model is the one exception we design up front.** The editor store uses immutable
state / patches (Zustand + Immer) from day 0 so undo/redo can be added later without a
rewrite. We ship without the undo *buttons*, but not without the architecture for them.

---

## 2. Feature scope (where each area lands)

- **Editor (Phase 1).** Konva stage with zoom/pan; move/resize/rotate with handles; a layers
  panel (z-order, lock, hide, rename — **no grouping**); inspector. Snapping, undo/redo UI, and
  element grouping come once the basics are stable (grouping pulls in a selection model, nested
  transforms, serialization, and z-order edge cases, so it stays out of the thin slice).
- **Export (Phase 2).** Verified store bundles from `store-specs.json`, alpha-channel removal,
  Vitest dimension tests, zip by platform/device/locale.
- **Fonts & themes (Phase 3).** System + Google + custom upload UI; theme tokens applied across
  all screens; a template library of reusable layouts. (Minimal font *embedding* ships earlier
  with export — see architecture.md §5.)
- **Locales & RTL (Phase 4).** Per-language screenshot sets; mirrored layout/alignment for
  Arabic/Hebrew so slides are RTL-native, not just translated.
- **AI (Phase 5).** A bonus on top of a deterministic core, never a prerequisite.

---

## 3. Phased plan

**Phase 0 — Schema + renderer parity spike (the de-risking phase).**
Project schema + validator (Zod), a sample project, CLI `init` / `export`, and the
**render/export parity proof**: one JSON → a pixel-correct PNG from both the UI button and
`cli export`. Decide and wire the export renderer (headless Playwright vs node-canvas — see
architecture.md §2). Includes minimal font embedding, since text is the hardest parity case.
*This phase must pass before anything else is built.*

**Phase 1 — Web editor (basics).**
Elements (`text`, `shape`, `screenshot`, `device-frame`), inspector, layers panel (no
grouping), screen management (isolated). Immutable state model in place; undo/redo UI,
snapping, and grouping deferred.

**Phase 2 — Verified export.**
`store-specs.json` as the source of truth, alpha removal, dimension tests, zip bundles by
platform/device/locale. Export is now "rock-solid."

**Phase 3 — Themes / templates / fonts UI.**
Theme tokens, template library, full font-management UI (upload, preview, system/Google).

**Phase 4 — Locales & RTL.**
Multi-locale sets, RTL-native layouts.

**Phase 5 — Agent workflows.**
`AGENTS.md` recipes: copy generation, auto-layout, locale translation via the CLI agent
(subscription, no keys). Local image processing (background removal / auto-crop) via a WASM
model or a local utility.

**Phase 6 — Connected canvas + polish.**
Cross-screen elements with precise export crops, the optional skill installer, and community
polish (README GIF, `CONTRIBUTING.md`, example projects).

---

## 4. Technical risks

1. **Render/export parity (highest).** UI (browser Konva) vs CLI (headless) must produce the
   same pixels, especially for text. *Mitigation:* the Phase 0 spike; prefer a headless browser
   so parity is by construction. **Exit criterion: from the same project JSON, the UI export
   button and `cli export` produce a PNG with exact target dimensions, no alpha channel, and a
   visual diff within tolerance** (not byte-identical — PNG metadata/compression can differ).
   Do not proceed to Phase 1 until this holds.
2. **Store spec drift.** Apple/Google change sizes and rules. *Mitigation:* `store-specs.json` +
   tests, not hardcoded values.
3. **Font fidelity.** Custom fonts must embed and render identically across both renderers.
   *Mitigation:* ship minimal embedding with the Phase 0 spike, not as a late feature.
4. **Scope creep.** The vision is large. *Mitigation:* hold the line on the thin MVP; defer
   connected canvas and AI explicitly.
