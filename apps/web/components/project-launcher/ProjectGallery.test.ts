// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { parseProject } from "@screenshot-studio/core/model";
import type { ProjectLibraryEntry } from "@web/lib/project-library-client.js";
import { closeProjectActionsMenu, ProjectGallery } from "./ProjectGallery.js";

vi.mock("../ScreenThumbnail.js", () => ({
  ScreenThumbnail: () => createElement("img", { alt: "" }),
}));

const project = parseProject(JSON.parse(
  readFileSync("fixtures/sample/app-store-screenshots.json", "utf8"),
));
const managed: ProjectLibraryEntry = {
  entryId: "project_00000000000000000000000000000001",
  sourceKind: "managed-project" as const,
  name: "Store Launch Demo",
  lastOpenedAt: "2026-07-20T10:00:00.000Z",
  availability: "available" as const,
  platforms: ["apple:iphone", "apple:ipad"],
  screenCount: 6,
  layoutCount: 1,
  previewLayoutId: "default",
  previewScreenIds: ["hero", "save-fast", "stay-organized"],
  previewProject: project,
};

function render(
  entries = [managed],
  options: {
    action?: Parameters<typeof ProjectGallery>[0]["action"];
    actionError?: string | null;
    actionNotice?: Parameters<typeof ProjectGallery>[0]["actionNotice"];
    visibleOpeningEntryId?: string | null;
  } = {},
) {
  return renderToStaticMarkup(createElement(ProjectGallery, {
    entries,
    action: options.action ?? null,
    actionError: options.actionError ?? null,
    actionNotice: options.actionNotice ?? null,
    visibleOpeningEntryId: options.visibleOpeningEntryId ?? null,
    onOpen: vi.fn(),
    onOpenDetails: vi.fn(),
    onExportArchive: vi.fn(),
    onDeleteProject: vi.fn(),
    onRemoveRecent: vi.fn(),
  }));
}

describe("ProjectGallery", () => {
  it("renders preview-led responsive cards with one direct Workspace action", () => {
    const markup = render();
    expect(markup).toContain("grid-cols-1");
    expect(markup).toContain("md:grid-cols-2");
    expect(markup).toContain("xl:grid-cols-3");
    expect(markup).toContain('aria-label="Open Store Launch Demo in Workspace"');
    expect(markup).toContain("6 screens");
    expect(markup).toContain("1 layout");
    expect(markup).toContain("iPhone");
    expect(markup).toContain("iPad");
    expect(markup).not.toContain(">Open project<");
  });

  it("shows human-readable platform and device labels instead of internal values", () => {
    const markup = render([{ ...managed,
      platforms: [
        "apple:iphone",
        "apple:ipad",
        "apple:watchos",
        "android:phone",
        "android:tablet-7",
        "android:wear",
        "windows:xbox",
        "web:desktop",
        "web:laptop",
        "web",
      ],
    }]);

    expect(markup).toContain(
      "iPhone · iPad · watchOS · Android phone · Android tablet · Wear OS · Xbox · Desktop · Laptop · Web",
    );
    expect(markup).not.toContain("android:phone");
    expect(markup).not.toContain("android:tablet-7");
    expect(markup).not.toContain("windows:xbox");
    expect(markup).not.toContain(">desktop<");
  });

  it("keeps overflow actions separate and removal local-history only", () => {
    const managedMarkup = render();
    expect(managedMarkup).toContain('aria-label="More actions for Store Launch Demo"');
    expect(managedMarkup).toContain("Project details");
    expect(managedMarkup).toContain("lucide-info");
    expect(managedMarkup).toContain("Export archive");
    expect(managedMarkup).toContain("Delete project…");
    expect(managedMarkup).not.toContain("Remove from recents");

    const localMarkup = render([{ ...managed,
      entryId: "recent_00000000000000000000000000000002",
      sourceKind: "local-file",
    }]);
    expect(localMarkup).toContain("Remove from recents");
    expect(localMarkup).not.toContain("Delete project…");
  });

  it("keeps unavailable local history visible but not openable", () => {
    const markup = render([{ ...managed,
      entryId: "recent_00000000000000000000000000000002",
      sourceKind: "local-file",
      availability: "unavailable",
      previewProject: null,
      previewLayoutId: null,
      previewScreenIds: [],
    }]);
    expect(markup).toContain("Source unavailable");
    expect(markup).toContain("Reopen or import the source");
    expect(markup).toContain('aria-label="Remove Store Launch Demo from recents"');
    expect(markup).toContain("project files stay untouched");
    expect(markup).toContain("justify-between");
    expect(markup).not.toContain("pr-14");
    expect(markup).not.toContain(">Remove from recents<");
    expect(markup).not.toContain('aria-label="Open Store Launch Demo in Workspace"');
    expect(markup).not.toContain('aria-label="More actions for Store Launch Demo"');
    expect(markup).not.toContain("Project details");
  });

  it("uses a card-bounded opening overlay instead of an inline opening row", () => {
    const markup = render([managed], { visibleOpeningEntryId: managed.entryId });
    expect(markup).toContain("Opening workspace…");
    expect(markup).not.toContain("mt-3 flex items-center");
  });

  it("closes the overflow and reports archive preparation without shifting card content", () => {
    const summary = { focus: vi.fn() };
    const menu = { open: true, querySelector: vi.fn(() => summary) };
    closeProjectActionsMenu({ closest: vi.fn(() => menu) } as never);

    expect(menu.open).toBe(false);
    expect(summary.focus).toHaveBeenCalledWith({ preventScroll: true });

    const markup = render([managed], {
      action: { entryId: managed.entryId, kind: "archive" },
    });
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Preparing archive…");
  });

  it("announces archive download only after it starts", () => {
    const markup = render([managed], {
      actionNotice: {
        entryId: managed.entryId,
        message: "Archive download started.",
        motion: "visible",
      },
    });
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Archive download started.");
    expect(markup).toContain("project-card-action-status");
    expect(markup).toContain('data-motion="visible"');
  });

  it("keeps an archive notice scoped to its project card", () => {
    const second = { ...managed, entryId: "project_00000000000000000000000000000002" };
    const markup = render([managed, second], {
      actionNotice: {
        entryId: second.entryId,
        message: "Archive download started.",
        motion: "closing",
      },
    });
    expect(markup.match(/Archive download started\./gu)).toHaveLength(1);
    expect(markup).toContain('data-motion="closing"');
  });
});
