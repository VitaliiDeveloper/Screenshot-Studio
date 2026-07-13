# Phase 9 Slice 5 — built-in frame presets

## Goal

Cover every shipped output family with trusted deterministic device framing while retaining one
existing `device-frame` leaf and one shared renderer.

## Contract

- Schema v10 widens `deviceType` to `iphone | android-phone | tablet | desktop | tv | watch`.
- Core owns normalized bezel, slot, optional notch, and canonical aspect-ratio data.
- Preset changes preserve width and fit height to the canonical outer aspect ratio.
- All frames are native Konva primitives; only the project screenshot is an asset.
- Mapping: iPhone→iphone, Android phone→android-phone, iPad→tablet, macOS/Windows→desktop,
  tvOS→tv, watchOS→watch.

## Boundaries

No vendor artwork, remote downloads, model/year catalogs, perspective mockups, 3D, shadows, or
author-defined slot geometry.
