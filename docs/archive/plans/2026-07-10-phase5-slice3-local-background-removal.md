# Phase 5 Slice 3 — Local background removal utility

## Goal

Remove a flat or near-uniform image background locally by making only matching edge-connected pixels
transparent, with no hosted model, network request, render-time effect, or source mutation.

## Contract

- `screenshots asset remove-background <file> [--background RRGGBB] [--tolerance 0..255]` uses
  the same safe project-local input and collision-safe processed-output boundary as auto-crop.
- Without `--background`, the top-left opaque pixel is the reference colour. Existing transparent
  edge pixels remain transparent.
- A four-neighbour flood fill removes only edge-connected pixels whose RGB channels are each within
  tolerance; same-colour holes enclosed by the foreground remain opaque.
- Output is an RGBA PNG under `assets/processed/`. The final store exporter remains responsible for
  stripping alpha from finished screenshots.
- This is deliberately a deterministic flat-background utility, not semantic person/object
  segmentation. Complex scenes remain out of scope rather than silently producing misleading masks.

## Files

- Extend `packages/cli/src/asset-service.ts`, `asset-commands.ts`, and their focused tests.
- Update the generated project agent guide with exact commands and limitations.
- Align architecture, roadmap, README, and root `AGENTS.md` after verification.

## Verification

1. Pixel-level tests for border removal, enclosed same-colour preservation, explicit tolerance,
   non-destructive output, collision handling, and path containment.
2. A command-level test with `fetch` disabled/observed to prove the default implementation is local.
3. The full CLI suite and CLI typecheck.
