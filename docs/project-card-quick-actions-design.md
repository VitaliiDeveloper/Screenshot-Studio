# Project Card Quick Actions And Opening Feedback

Date: 2026-07-20

## Decision

Make the Projects card overflow menu useful without adding permanent controls to the card surface.
Managed projects receive direct archive and deletion actions in addition to Project details. Local
projects retain source-neutral behavior and expose only Project details plus Remove from recents.
Replace the short-lived inline `Opening…` row with a delayed, non-layout-shifting card overlay.

## Card Actions

The whole available card remains the primary Open in Workspace target. The overflow menu contains:

- Managed project: `Project details`, `Export archive`, a separator, and `Delete project…`.
- Local project: `Project details` and `Remove from recents`.
- Unavailable local project: `Remove from recents`; actions that require the source stay absent.

Quick actions use the same opaque library entry identity as card opening. They never expose or accept
a project path. Only one action may run at a time across the gallery.

`Export archive` activates the exact managed entry through the existing save/activate/reset
coordinator, then uses the existing managed archive client to download the portable archive. Its busy
and failure states stay on Projects.

`Delete project…` activates the exact managed entry and opens the existing destructive confirmation
experience on top of Projects. The flow keeps the current archive-first choice, typed confirmation,
lifecycle/version fences, cancellation, and recovery behavior. Successful deletion removes the card,
clears the matching session, and leaves the user on `/`. Cancellation leaves the card and session
data unchanged. Local sources never receive a permanent-delete action.

The deletion orchestration must be shared with Project Home rather than copied into a second
implementation. Project Home remains the owner of detailed lifecycle information, while the reusable
controller/dialog owns the destructive operation.

## Opening Feedback

Clicking a card immediately disables competing gallery actions and gives the selected card its normal
pressed/busy state. Do not add content or change card height. Start a 200 ms timer at the same moment:

- If activation resolves and navigation is requested before the timer fires, render no loader.
- If the activation is still pending after 200 ms, show a translucent overlay inside the existing
  card bounds with the shared loader icon and `Opening workspace…`.
- Remove the overlay on navigation, failure, or unmount.
- Reduced-motion mode keeps the overlay but disables spinner animation.

The card retains `aria-busy`; the delayed visible label uses `role="status"`. A failed open removes the
overlay and reports the existing inline alert without navigating.

## Components And State

- `ProjectGallery` renders source-appropriate menu actions and an optional opening overlay. It remains
  presentational and receives callbacks plus the visible-overlay entry id.
- `ProjectLauncher` owns the single gallery action state and the 200 ms opening timer. Archive and
  delete begin only after source-safe activation succeeds.
- Existing archive, deletion, session, and managed-lifecycle clients remain the only transport and
  mutation paths. No schema, renderer, preview, or project-library response changes are needed.
- Extract only the minimum shared managed-deletion controller needed by Project Home and Projects;
  do not widen the lifecycle API or create a second deletion protocol.

## Failure And Accessibility Behavior

- Menu controls close after selection and remain keyboard reachable with distinct accessible names.
- Archive, delete, and open errors use the existing Projects alert region.
- Destructive confirmation receives initial focus, restores focus to the originating overflow control
  on cancellation where possible, and cannot be bypassed.
- The delayed overlay never captures pointer events, shifts content, or covers a separate card menu.
- Disabled and busy states must not reduce text contrast below the existing accessibility gate.

## Verification

Use test-first changes for each behavior:

1. Gallery markup tests fail first for managed/local/unavailable action sets and the absence of the old
   inline `Opening…` row.
2. Opening-state tests fail first for the 200 ms threshold, cleanup, error reset, and overlay markup.
3. Quick-action tests fail first for source-safe activation, archive handoff, deletion cancellation,
   successful removal, and the absence of permanent deletion for local entries.
4. Run the focused component/client tests, `pnpm test:web`, and the exact launcher closure browser file.
5. In the in-app Browser, verify managed and local menus, fast and intentionally delayed opening,
   deletion cancellation, compact width, focus behavior, console output, and serious/critical axe
   findings. Compare the final Projects screenshot with the accepted gallery before closing QA.

## Out Of Scope

Do not add duplication, rename, cloud actions, Trash, Restore, bulk selection, permanent deletion of
local files, schema fields, alternative archive formats, or a second managed lifecycle path.
