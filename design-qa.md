# Projects gallery design QA

- Source visual truth: `/Users/vitalii_lavreniuk/.codex/generated_images/019f7eae-b278-74e3-9dff-4a38138e3ea9/exec-1e2fa7bd-b63f-4adf-ae08-2505441e4272.png`
- Final implementation screenshot: `/tmp/screenshot-studio-projects-final-1536.png`
- Workspace rail screenshot: `/tmp/screenshot-studio-workspace-final-1536.png`
- Compact screenshot: `/tmp/screenshot-studio-projects-640.png`
- Full-view comparison: `/tmp/screenshot-studio-design-comparison-final.png`
- Focused card comparison: `/tmp/screenshot-studio-card-comparison.png`
- Viewport and state: 1536 x 1024 populated Projects gallery with one real managed project; 640 x 900 compact gallery; 1536 x 1024 active Workspace.

## Findings

No actionable P0, P1, or P2 differences remain.

- Typography: the implementation uses the existing Screenshot Studio type stack and a denser scale than the concept image. Heading, card title, metadata, date, badges, and controls retain a clear hierarchy without clipping at either tested width. The date now uses `text-slate-500`, which passes the serious/critical axe contrast gate.
- Spacing and layout: the card footprint and three-preview composition preserve the selected option's compact gallery intent. The root deliberately omits the concept's editor rail per the product decision; Workspace alone owns that rail. The one-project state leaves open canvas for future cards without adding onboarding content.
- Colors and tokens: the gallery uses existing editor surface, border, focus, accent, and text tokens. Real project colors come from the shared renderer rather than decorative substitutes.
- Image quality and assets: project previews are rasterized by `ScreenThumbnail` through the shared core renderer. They are real project output, so they intentionally differ from the fictional product screenshots in the concept image. No fake SVG, CSS-art, emoji, or placeholder product imagery is used.
- Copy and content: the root exposes only `New project` and `Import`; `Capture folder` remains nested under Import. Project cards show source-derived name, platform, screen/layout counts, recency, and a secondary `Project details` action.
- Icons and affordances: Lucide icons remain consistent with the existing product. The bottom Workspace action uses a house icon labelled `Projects`; the Next development indicator is moved to bottom-right so it cannot obscure or intercept the app control. Production does not render that development indicator.
- Responsiveness and accessibility: 640 x 900 preserves both primary actions, a readable one-column card, visible overflow action, and the Workspace Projects action. First-run and populated gallery states have no serious or critical axe violations after the contrast fix. Focus rings and semantic button/summary labels remain available.

## Comparison history

1. Initial browser pass found project creation returning 422. Evidence showed the preview server was launched from `apps/web` without `INIT_CWD`, so `store-specs.json` resolved from the wrong directory. The preview was restarted with the repository root; empty and starter creation then returned 201 and opened `/editor` directly. This was an environment correction, not a product-code change.
2. First exact browser journey found the Next development portal intercepting the bottom-left Projects action. `devIndicators.position` was set to `bottom-right`; the post-fix browser journey and in-app Browser both activated Projects successfully.
3. The populated gallery accessibility pass found serious contrast on the update date. The date token changed from `text-slate-400` to `text-slate-500`; the post-fix exact axe pass is clean.
4. Final full-view comparison uses `/tmp/screenshot-studio-design-comparison-final.png`. The intentional differences are the absent root editor rail and source-rendered project content. Neither changes the selected compact gallery hierarchy.
5. Focused comparison uses `/tmp/screenshot-studio-card-comparison.png`. It confirms consistent card radius, border, three-preview rhythm, title/metadata grouping, date, badge, and overflow affordance. No further focused crop is needed because the remaining product surfaces are readable in the Workspace and compact screenshots.
6. The exact configured-local and import journey exposed an ordering race between session recording and the source-safe project library request. Projects now records the active session before loading the library; the exact launcher and round-trip browser files pass after the fix.

## Primary interactions tested

- First-run `New project` and `Import` boundary.
- Starter creation and direct `/editor` handoff.
- Workspace bottom Projects action and return to `/`.
- Real preview loading, metadata, overflow, and Project details.
- Direct gallery-card reopen to `/editor`.
- Configured-local recording before source-safe gallery loading.
- Compact-width reachability.
- Browser console errors and warnings: none.

## Follow-up polish

- P3: if a still quieter section header is preferred after using the gallery with many real projects, the `Your workspace` eyebrow can be removed without changing information architecture.

final result: passed
