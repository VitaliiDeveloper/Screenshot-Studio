# Vision & Strategy

Screenshot Studio is a platform for creating App Store and Google Play marketing
screenshots: a visual canvas editor with screens, elements, fonts, themes, optional
AI assistance, and export to exact store sizes.

This document covers strategy and positioning — the parts that change rarely.
Version 0.4, 24 June 2026.

---

## 1. Product form & strategy

**The project is pure open-source.** Built first for our own use and as a benefit to the
community. No SaaS, no billing, no paywalls. The goal is the best free, code-first,
AI-native tool for store screenshots.

**The repository is the product.**

- **Self-hosted, always free.** `clone → install → run` gives the user a full canvas
  editor locally. Data stays with them, no vendor lock-in.
- **Conventions + CLI as the interface (not a skill).** Standard directories, a documented
  JSON schema, a management CLI, and an `AGENTS.md` / `CLAUDE.md` at the repo root. Any CLI
  agent working inside the repo immediately knows the conventions and commands — no separate
  skill package required (see architecture.md).
- **Skill — optional and later.** A thin installer is only needed for zero-config
  distribution *outside* the repo (`npx skills add` in an empty folder → the agent scaffolds
  the project). Not foundational; added last.
- **AI via the CLI agent, no keys.** AI features are performed by the CLI agent (Claude Code,
  Cursor, etc.) the user already pays for by subscription; image processing runs locally.
  No server proxy and no API keys (an optional bring-your-own-key is only a fallback).
  Not required for basic use.

**Why OSS rather than monetization.** The niche is saturated and cheap, and usage is
*bursty* (once per release) — subscriptions fit poorly. OSS plus agent/CLI distribution
builds audience, reputation, and contributions quickly. The real value is privacy, a
code workflow, and being a "modern fastlane" — all best delivered for free.

---

## 2. How it differs from the reference

Inspired by [ParthJadhav/app-store-screenshots](https://github.com/ParthJadhav/app-store-screenshots),
but built to remove its ceiling.

| Aspect | Reference (ParthJadhav) | This platform |
|--------|-------------------------|----------------|
| Render | DOM/CSS + html-to-image | Konva object model, pixel-correct export |
| Elements | limited set, react-rnd | typed system + layers + grouping |
| Fonts | system / CSS | system + Google + custom upload (embedded in project) |
| Themes | a couple in constants.ts | tokens + template library |
| Distribution | skill only | OSS repo + CLI + conventions (skill optional) |
| AI | a button | workflow through the CLI agent (subscription, no keys) |
| Architecture | single Next.js project | core/shell, testable core, open to extensions |

We keep the reference's strengths: JSON as the source of truth, schema migrations, and
size-bucketed export bundles. (Connected canvas is a later feature — see roadmap.md.)

---

## 3. License, contributions, distribution

**License — Apache-2.0 (chosen).** Maximally permissive, like MIT, plus an explicit patent
grant and a NOTICE requirement — the more "grown-up" choice, friendlier to contributions from
companies. (MIT was the alternative; AGPL was ruled out as contrary to the goal of maximum
reach.)

Practical implications: ship a top-level `LICENSE` (the Apache-2.0 text) and a `NOTICE` file,
add SPDX headers (`SPDX-License-Identifier: Apache-2.0`) to source files, and keep a short
license/contribution note in `CONTRIBUTING.md`.

**DX and low entry barrier = OSS marketing.** What should ship at release:

- A README with a GIF of the editor in action and a one-line install.
- One-line install: `clone → install → run` (and optionally `npx skills add <repo>` for zero-config).
- A clear, documented project schema (JSON) — hand-editable and git-friendly.
- A `CONTRIBUTING.md` and good first issues.
- 2–3 example projects (different styles/locales) as living templates.
- Screenshots made by the tool itself, in its own README (dogfooding as the demo).

**Channels:** skills.sh / skill registries, GitHub topics (like the reference: `screenshot`,
`ios`, `appstore`, `skills`), Show HN / r/iOSProgramming / r/androiddev, dev communities.
Optionally GitHub Sponsors — not monetization, just a way to cover coffee / demo hosting.
