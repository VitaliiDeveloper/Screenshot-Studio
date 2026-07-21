// SPDX-License-Identifier: Apache-2.0
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RecentProjectsPanel } from "@web/components/project-launcher/RecentProjectsPanel.js";

const entry = {
  recentId: "recent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  sourceKind: "managed-project" as const,
  name: "Launch story",
  lastOpenedAt: "2026-07-20T12:00:00.000Z",
  availability: "available" as const,
};

function render(props: Partial<Parameters<typeof RecentProjectsPanel>[0]> = {}) {
  return renderToStaticMarkup(createElement(RecentProjectsPanel, {
    state: { status: "ready", entries: [] },
    action: null,
    actionError: null,
    onRetry: vi.fn(),
    onOpen: vi.fn(),
    onRemove: vi.fn(),
    ...props,
  }));
}

describe("RecentProjectsPanel", () => {
  it("renders actionable loading, failure/retry, and first-run empty states", () => {
    expect(render({ state: { status: "loading" } })).toContain('role="status"');
    const failed = render({ state: { status: "error", message: "History unavailable" } });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Retry recent projects");
    const empty = render();
    expect(empty).toContain("No recent projects yet");
    expect(empty).toContain("Create a project, import a managed copy, or open a configured local source");
  });

  it("keeps Open, unavailable recovery, and Remove from recents semantics unambiguous", () => {
    const available = render({ state: { status: "ready", entries: [entry] } });
    expect(available).toContain("Open project");
    expect(available).toContain("Remove from recents");
    expect(available).toContain("removes history only");
    expect(available).not.toContain("Delete project");
    expect(available).not.toContain("Close project");

    const unavailable = render({ state: { status: "ready", entries: [{
      ...entry,
      sourceKind: "local-file",
      availability: "unavailable",
    }] } });
    expect(unavailable).toContain("Source unavailable");
    expect(unavailable).toContain("Reopen the source outside the browser or import it again");
    expect(unavailable).toContain('disabled=""');
  });

  it("announces per-entry progress and preserves a retryable action error", () => {
    const markup = render({
      state: { status: "ready", entries: [entry] },
      action: { recentId: entry.recentId, kind: "opening" },
      actionError: "Project could not be opened.",
    });
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Opening…");
    expect(markup).toContain('role="alert"');
  });
});
