# Phase 9 Slice 1 — store output families

## Goal

Turn the Inspector's single-family Store Targets list into a store-output manager for App Store
iPhone, iPad, macOS, tvOS, and watchOS, Google Play Android phone, and Microsoft Store Windows
desktop deliverables.

## Contract

- A store output is one exact `platform/device/locale` root screen set.
- Every new root/master starts at that device family's exact lead dimensions. The Inspector keeps
  the master size read-only by default; an explicit custom-size flow resizes every root in that
  output set and fits each composition atomically, with a one-action reset to the exact lead.
- Creating another output copies every root screen in the active set with fresh screen and element
  ids, fits the composition into that output's lead artboard, and never mutates the source set.
- Cross-family copies are independent roots. `variantOf` and `storeTargetId` remain paired and are
  used only for alternate exact sizes inside one output family.
- An existing output is opened rather than copied again; creation is idempotent.
- The shared renderer and current flat `Screen` model remain unchanged. Adding platform/device
  alternatives is an additive v6 schema widening, not a migration.
- Bundle paths and filters remain `platform/device/locale/target`; every new family exports through
  the existing UI/CLI render host.
- Custom master dimensions must remain proportional to the lead target so the shared export path
  can scale without distortion. No custom-size schema flag is stored because exact/custom status is
  derived from the artboard and `store-specs.json`.

## Supported families and lead targets

| Store | Family | Lead target |
|---|---|---|
| App Store | iPhone | 1320×2868 |
| App Store | iPad | 2064×2752 |
| App Store | macOS | 2880×1800 |
| App Store | tvOS | 3840×2160 |
| App Store | watchOS | 422×514 |
| Google Play | Android phone | 1080×1920 preset |
| Microsoft Store | Windows desktop | 3840×2160 preset |

Apple sizes are accepted App Store Connect sizes. Google and Microsoft entries are explicit editor
presets inside their published ranges; they are not presented as exhaustive accepted-size lists.

Sources:

- https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/
- https://support.google.com/googleplay/android-developer/answer/9866151
- https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/screenshots-and-images

## Out of scope

- New device-frame render types for Mac, TV, Watch, or Windows.
- Ongoing synchronization after an output is copied.
- Android tablet, TV, Wear OS, Automotive, XR, Xbox, Holographic, or visionOS families.
- Arbitrary range validation UI for Google Play or Microsoft Store.

## Verification

- Schema/store-spec lockstep and placement tests cover every family and reject cross-products.
- Core/editor-store tests prove full-set fresh-id cloning, fitting, idempotency, and source safety.
- Editor workspace E2E proves add/open behavior and unchanged source dimensions.
- Bundle export E2E proves exact alpha-free output for a newly supported family.
- Because this widens schema and export contracts, closure runs unit, lint, typecheck, and full E2E.
