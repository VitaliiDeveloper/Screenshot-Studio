// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { parseProject } from "@screenshot-studio/core/model";
import type { ProjectLibraryEntry } from "../../lib/project-library-client.js";
import { ProjectGallery } from "./ProjectGallery.js";

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
  project,
};

function render(
  entries = [managed],
  visibleOpeningEntryId: string | null = null,
) {
  return renderToStaticMarkup(createElement(ProjectGallery, {
    entries,
    action: null,
    actionError: null,
    visibleOpeningEntryId,
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

  it("keeps overflow actions separate and removal local-history only", () => {
    const managedMarkup = render();
    expect(managedMarkup).toContain('aria-label="More actions for Store Launch Demo"');
    expect(managedMarkup).toContain("Project details");
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
      project: null,
      previewLayoutId: null,
      previewScreenIds: [],
    }]);
    expect(markup).toContain("Source unavailable");
    expect(markup).toContain("Reopen or import the source");
    expect(markup).toContain('disabled=""');
    expect(markup).not.toContain("Project details");
  });

  it("uses a card-bounded opening overlay instead of an inline opening row", () => {
    const markup = render([managed], managed.entryId);
    expect(markup).toContain("Opening workspace…");
    expect(markup).not.toContain("mt-3 flex items-center");
  });
});
