# Phase 9 closure design — finite product expansion

## Goal

Close Phase 9 as a finite expansion of the shipped local editor: complete the most valuable
existing-type authoring gaps, cover the output families already supported by the schema, and end
with measured workflow/render reliability. Phase 9 remains independent of release publication.

## Slice sequence

1. **Store output families — done.** Independent iPhone, iPad, macOS, tvOS, watchOS, Android phone,
   and Windows desktop root sets with family-local exact-size variants.
2. **Background authoring.** Strict solid, linear-gradient, and project-image backgrounds with one
   shared UI/CLI renderer, secure project-asset selection, and exact alpha-free export.
3. **Media crop controls.** Persisted normalized focal point and bounded zoom for `screenshot` and
   decorative `image` cover rendering; contain mode remains deterministic and ignores crop state.
4. **Text and shape styling.** Deterministic text shadow plus shape ellipse, optional stroke, and
   linear-gradient fill without adding a generic effects or arbitrary-SVG system.
5. **Built-in frame presets.** Trusted deterministic phone, tablet, desktop, TV, and watch frame
   presets mapped to the existing output families; no downloaded vendor artwork at render time.
6. **Workflow/performance closure.** Dogfood the completed surfaces, remove redundant browser work,
   preserve isolated E2E ownership, record render/export budgets, close accessibility/docs/examples,
   and run the Phase 9 gate.

Every slice must update the strict schema/migration when persisted state changes, the shared Konva
node mapping, UI and CLI parity coverage, relevant inspector/asset traversal, living examples, and
public documentation. A slice is not complete when only the editor preview works.

## Closure criteria

- Every supported persisted literal renders through the same shared node mapping in UI and CLI.
- Project asset paths retain the existing real-path/symlink containment guarantees.
- New authoring controls are keyboard accessible and have no serious/critical Axe violations.
- Unit tests own deterministic schema/model/math branches; browser E2E owns only real interaction,
  persistence, renderer/export parity, accessibility, and packed-consumer contracts.
- Full browser coverage is composed from isolated leaf groups; no monolithic mutable test process.
- Living examples exercise the new styling/media/frame surface across isolated and connected LTR/RTL
  output sets.
- Roadmap, architecture, editor guide, generated project guide, and community guards agree with the
  enforced schema and shipped UI.

## Explicitly out of scope

- Ongoing synchronization between independently edited output families.
- Android tablet/TV/Wear/Automotive/XR, visionOS, Xbox, or Holographic output families.
- Arbitrary Google Play or Microsoft Store range generators.
- Nested groups, clipping groups, animation, video, 3D scenes, filters, blend modes, or a generic
  effects graph.
- Arbitrary remote SVG/HTML, runtime font/image downloads, cloud collaboration, or an AI provider.
- Semantic image segmentation; the existing bounded local flat-background removal remains the
  supported contract.

These omissions are deliberate YAGNI boundaries, not deferred requirements for Phase 9 closure.
