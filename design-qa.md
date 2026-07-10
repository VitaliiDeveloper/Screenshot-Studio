# Phase 3.6 design QA

- Source visual truth: `/Users/vitalii_lavreniuk/.codex/generated_images/019f48cf-9ff7-7f32-b34a-576bd8b6088f/exec-fd6faee2-a840-41fb-bae3-0b902846fa9e.png`
- Structure hierarchy reference: `/Users/vitalii_lavreniuk/.codex/generated_images/019f48cf-9ff7-7f32-b34a-576bd8b6088f/exec-962400a8-2fff-4736-abd8-3661a362f149.png`
- Implementation screenshot: `/tmp/appreview-phase3-6-desktop-matched.png`
- Combined comparison: `/tmp/appreview-phase3-6-comparison-matched.png`
- Responsive evidence: `/tmp/appreview-phase3-6-compact.png`
- User-reported selection reference: `/var/folders/3z/f6m_gjs96l3_q4scq0s7xly40000gn/T/codex-clipboard-8e196f9d-f4cb-42e3-87b3-f5c2b36bef98.png`
- Closure selection evidence: `/tmp/appreview-phase36-audit/09-text-selection-after.png`
- Closure comparison: `/tmp/appreview-phase36-audit/14-text-selection-comparison.jpg`
- Live-resize evidence: `/tmp/appreview-phase36-audit/10-compact-after.png`
- Compact drawer evidence: `/tmp/appreview-phase36-audit/11-compact-structure.png`, `/tmp/appreview-phase36-audit/12-compact-inspector.png`
- Phone dialog evidence: `/tmp/appreview-phase36-audit/13-phone-fonts.png`
- Viewports: 1488 × 1058 original desktop QA; 1257 × 1354 selection; 720 × 900 compact; 390 × 844 phone
- State: Overview with selected text; live desktop→compact resize; each side drawer; phone Fonts dialog
- Capture and interaction method: Codex in-app Browser against `http://localhost:3000/editor`

## Full-view comparison evidence

The source, implementation, and a native-height side-by-side composite were opened at original
detail in the final pass. Both views keep the same editor skeleton: 56px top bar, compact permanent
rail, contextual Add shelf, three isolated portrait artboards, canvas pattern control, and a
canvas-owned bottom zoom dock. The implementation preserves the source's white/cool-gray chrome,
blue primary action and selected states, restrained dividers/shadows, and open-canvas container
model.

## Focused region evidence

The individual 1488px-wide source and implementation images were inspected at original detail for
the Add shelf, top bar, artboard labels/selection outline, Grid treatment, and zoom dock. No
additional crop was required: labels, control geometry, icon weight, and artboard content were
readable in the original-size views.

The accepted structure reference and the hierarchy implementation were inspected at original
detail after user review found that Screens and Layers still read as flat utility lists. The
follow-up preserves the shell while restoring numbered screen previews, an explicit active-screen
label above typed layer rows, and contextual actions. A second review removed duplicated screen
roots from Layers because Screens already owns screen selection and ordering.

The closure pass then captured the current editor again in the in-app Browser. It confirms the
active-only Layers hierarchy, the corrected headline selection box, dynamic drawer behavior at
720px, and the single-column resource dialog at 390px. Console warning/error output was empty.

## Fidelity ledger

| Surface | Source evidence | Render evidence | Result |
|---------|-----------------|-----------------|--------|
| Layout / density | Permanent rail, ~280–330px Add shelf, open canvas, collapsed Inspector | 56px rail, 288px Add shelf, open canvas, top-bar Inspector toggle | Passed; the compact Inspector treatment follows the approved option-2 + option-3 hybrid. |
| Typography | Small disciplined editor chrome; large marketing headlines | Explicit 10–14px chrome styles; Pacifico demo headlines; readable generated app UI | Passed. Demo supporting copy uses the registered project font to preserve deterministic export. |
| Palette / tokens | True white chrome, cool slate grid, blue primary/selection | White/slate workbench, blue Export/tool/active-artboard ring, dark navy artboards | Passed. |
| Icons / controls | Consistent thin outlined tool and action icons | Existing Lucide family at 1.8–2px stroke; stable 32–40px targets and visible focus | Passed. |
| Canvas / artboards | Overview of three isolated screens on a square grid | Three v1 artboards in export order; active Hero blue ring; Grid/Dots/None; 48% source-matched Fit | Passed. |
| Asset treatment | Real product UI inside device/cropped compositions | Project-local generated logistics UI used by device-frame and screenshot elements | Passed; real asset path also succeeded through headless export. |
| Responsive behavior | Compact rail and collapsible side surfaces | Live desktop→720 resize closes both surfaces; opening Structure or Inspector makes them mutually exclusive and repositions canvas controls; 390px dialogs stack | Passed. |
| Interaction model | Focus/Overview, Add, pattern, zoom controls | Browser verified panel switching and modal Escape/focus return; e2e verifies insert shortcuts, modified-wheel zoom, Hand pan, accurate Fit, lock guards, and inline edit | Passed. |
| Structure hierarchy | Screen previews plus readable typed layer rows | Shared-renderer thumbnails in Screens; Layers names the active screen and lists only its elements | Passed. Screen selection is no longer duplicated inside Layers. |

## Above-the-fold copy diff

Preserved or intentionally mapped: `Screenshot Studio`, project name, `Focus`, `Overview`,
`Inspect`, `Export`, `Add`, `Search add…`, `Basic`, `Text`, `Shape`, `Media`, `Screenshot`, `Image`,
`Frames`, `iPhone Device Frame`, `Library`, `Components`, screen names, pattern name, percentage,
and `Fit`.

Intentional product deviations:

- Undo/redo, Preview, and overflow actions from the concept are omitted because those workflows do
  not exist yet; no inert controls were introduced.
- `Components` opens the shipped project-template library and identifies it as project templates.
- Screenshot/Image/Device Frame entries remain visible but disabled until a real asset picker can
  supply required schema fields; the UI explains the limitation instead of writing invalid JSON.
- The implementation uses a top-bar Inspector toggle instead of reserving an empty collapsed right
  column, keeping the canvas larger while preserving the approved compact-panel direction.

## Comparison history

1. Initial compact pass: the open Structure shelf covered part of the Overview and zoom dock.
   Fix: shelves and Inspector now default closed at compact breakpoints, and an opened compact shelf
   reserves its own horizontal inset. Post-fix evidence: `/tmp/appreview-phase3-6-compact.png`.
2. Initial desktop pass: the active artboard inherited the neutral ring color despite the selected
   ring width. Fix: active and inactive ring classes are now mutually exclusive. Post-fix evidence:
   `/tmp/appreview-phase3-6-desktop-matched.png`.
3. User follow-up: Screens and Layers still read as flat rows and did not match the Figma-like
   hierarchy shown in the earlier concept. Fix: Screens now use numbered shared-renderer previews;
   Layers gained typed rows and contextual overflow actions so labels retain useful width.
4. Information-architecture follow-up: repeating every Screen as a root inside Layers duplicated
   the Screens section and made Focus/Overview responsibilities unclear. Fix: Layers now shows only
   the active screen's elements and names that screen in its header.
5. Hierarchy pass: no persisted groups were introduced because grouping remains outside the v1 schema.
6. User-reported text selection: the selected `headline` box ended at y=240 while the separate
   `hero-support` layer began at y=235. Fix: size all three headline logical boxes to their actual
   one-line content plus safety room; the selected border now clears supporting copy.
7. Live resize: breakpoint defaults ran only once, so open desktop panels survived a narrow resize
   and collapsed the canvas. Fix: reactive media queries, true overlay drawers below 1280px,
   compact mutual exclusion, visible-area Fit/insets, and hidden phone controls while a drawer owns
   nearly the whole viewport.
8. Canvas correctness: locked elements still exposed Transformer handles; contain-mode screenshots
   persisted fitted child geometry; Space-pan swallowed focused button activation; Fit scaled fixed
   CSS gaps. Fixes now preserve logical boxes, disable locked transforms/editing, respect interactive
   keyboard targets, and separate fixed chrome from scalable artboards.
9. Persistence and resource parity: Inspector accepted schema-invalid numbers, save failures were
   silent, quick reloads could beat the debounce, and newly referenced template assets were absent
   from the live image cache. Fixes add bounded drafts, blur flush, visible errors, serialized status,
   and incremental project-image reconciliation.
10. Keyboard/responsive polish: dialogs now trap focus, close with Escape, and restore the opener;
    layer menus have specific names, Rename, arrows, Escape, and outside-click close; phone resource
    layouts stack instead of squeezing desktop columns.

## Functional evidence

- Browser: correct `/editor` identity, meaningful DOM, no framework overlay, no console warnings or
  errors, separated text selection, desktop→compact response, mutually exclusive compact drawers,
  phone dialog reflow, Escape close, and focus restoration.
- Automated: `test:core` 98/98; `test:web` 58/58; `test:e2e:editor` 19/19 across seven files;
  `test:e2e:parity` 6/6; `test:e2e:export` 2/2; repository typecheck, lint, and diff-check passed.
- Render path: headed/headless screenshot and device-frame parity stayed within tolerance; UI and
  bundle exports still produce exact store dimensions with no alpha.

## Evidence limits

The screenshots verify visible hierarchy, clipping, responsive reflow, and focus state. They do not
by themselves prove full WCAG conformance, every browser/OS font rasterizer, or very large projects.
Keyboard E2E covers the repaired primary controls and dialogs; performance was reduced by isolating
stage subscriptions and memoizing unrelated thumbnails, but large-deck profiling remains future work.

## Remaining P3 polish

- A future Phase can add the real asset picker behind the disabled Media/Frame catalog entries.
- A second registered sans font would make the demo's small supporting marketing copy closer to the
  concept while keeping deterministic font files.
- Large-deck runtime profiling can tune thumbnail scheduling once real projects exceed the three-screen
  dogfood sample.

final result: passed
