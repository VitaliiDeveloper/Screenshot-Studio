// SPDX-License-Identifier: Apache-2.0
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OUTPUT_DESTINATIONS } from "@screenshot-studio/core/export";
import { CaptureImportDialog, captureImportPlatformOptions } from "./CaptureImportDialog.js";
import { createCaptureImportState, type CaptureImportState } from "./capture-import-model.js";

const currentTarget = {
  projectName: "Current receiver",
  preferredLayoutId: "primary",
  layouts: [{ id: "primary", name: "Primary layout" }, { id: "secondary", name: "Secondary" }],
};
const preview = {
  receiving: { kind: "current-project" as const, projectName: "Current receiver", layoutId: "primary", layoutName: "Primary layout" },
  summary: {
    screenCount: 2,
    assetCount: 1,
    platforms: [{ id: "apple", count: 2 }],
    devices: [{ id: "apple/iphone", count: 2 }],
    locales: [{ id: "en", count: 1 }, { id: "fr", count: 1 }],
  },
  screens: [{
    sourcePath: "screenshots/apple/iphone/en/01.png",
    screenId: "apple-iphone-en-01",
    elementId: "apple-iphone-en-01-screenshot",
    resourcePath: "assets/imports/apple-iphone-en-01-aabbccddeeff.png",
    platform: "apple", device: "iphone", locale: "en", width: 1320, height: 2868,
  }],
  resources: [{
    sourcePath: "assets/icon.png", destinationPath: "assets/icon.png", digest: "2".repeat(64),
  }],
  warnings: [{ code: "unsupported-input", path: "notes.txt", message: "Skipping unsupported input" }],
  invalidEntries: [],
  canApply: true,
  confirmationFingerprint: "3".repeat(64),
};

function render(state: Exclude<CaptureImportState, { status: "closed" }>) {
  return renderToStaticMarkup(createElement(CaptureImportDialog, {
    state,
    onClose: vi.fn(),
    onSelectFiles: vi.fn(),
    onChooseDestination: vi.fn(),
    onChooseCurrentLayout: vi.fn(),
    onChangeNewProject: vi.fn(),
    onPreview: vi.fn(),
    onApply: vi.fn(),
    onCancel: vi.fn(),
    onRetry: vi.fn(),
    onRecoverStale: vi.fn(),
  }));
}

describe("CaptureImportDialog", () => {
  it("starts with an explicit source and destination choice without project-import terminology", () => {
    const markup = render(createCaptureImportState(currentTarget));

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("Capture import");
    expect(markup).toContain("Choose capture folder");
    expect(markup).toContain("screenshots/&lt;platform&gt;/&lt;device&gt;/&lt;locale&gt;/&lt;file&gt;.png");
    expect(markup).toContain("assets/");
    expect(markup).toContain("Choose where captures are added");
    expect(markup).toContain("Current project and layout");
    expect(markup).toContain("New managed project");
    expect(markup).not.toContain("Folder, ZIP, or JSON");
    expect(markup).not.toContain("Import existing project");
    expect(markup).toContain("Preview capture import");
    expect(markup).toContain("disabled");
  });

  it("offers only a new managed receiver from App Home", () => {
    const markup = render(createCaptureImportState(null));

    expect(markup).not.toContain("Current project and layout");
    expect(markup).toContain("New managed project");
  });

  it("shows the explicit current layout or strict new-project controls", () => {
    const current = createCaptureImportState(currentTarget);
    const currentMarkup = render({
      ...current,
      draft: { ...current.draft, destinationKind: "current-project", files: [{} as File] },
    });
    expect(currentMarkup).toContain("Current receiver");
    expect(currentMarkup).toContain('aria-label="Receiving layout"');
    expect(currentMarkup).toContain("Primary layout");

    const created = createCaptureImportState(null);
    const newMarkup = render({
      ...created,
      draft: { ...created.draft, destinationKind: "new-project", files: [{} as File] },
    });
    expect(newMarkup).toContain("Project name");
    expect(newMarkup).toContain("Target platform");
    expect(newMarkup).toContain("Layout mode");
    expect(newMarkup).toContain("Capture-ready empty project");
    expect(captureImportPlatformOptions).toEqual(
      OUTPUT_DESTINATIONS.map(({ id, label }) => ({ value: id, label })),
    );
    expect(newMarkup).not.toContain("Apple App Store");
  });

  it("renders the server preview destination, counts, planned IDs/paths, and warnings before apply", () => {
    const state = createCaptureImportState(currentTarget);
    const markup = render({
      status: "reviewing",
      draft: { ...state.draft, destinationKind: "current-project", files: [{} as File] },
      preview,
    });

    expect(markup).toContain("Review capture import");
    expect(markup).toContain("Current receiver");
    expect(markup).toContain("Primary layout");
    expect(markup).toContain("2 screens");
    expect(markup).toContain("1 related asset");
    expect(markup).toContain("apple-iphone-en-01");
    expect(markup).toContain("apple-iphone-en-01-screenshot");
    expect(markup).toContain("assets/imports/apple-iphone-en-01-aabbccddeeff.png");
    expect(markup).toContain("assets/icon.png");
    expect(markup).toContain("notes.txt");
    expect(markup).toContain("Confirm capture import");
  });

  it("disables apply for invalid entries and exposes busy cancellation and safe stale recovery", () => {
    const base = createCaptureImportState(currentTarget);
    const draft = { ...base.draft, destinationKind: "current-project" as const, files: [{} as File] };
    const invalidMarkup = render({
      status: "reviewing",
      draft,
      preview: {
        ...preview,
        canApply: false,
        invalidEntries: [{ code: "unsafe-path", path: "../escape.png", message: "Unsafe path" }],
      },
    });
    expect(invalidMarkup).toContain("../escape.png");
    expect(invalidMarkup).toMatch(/<button[^>]*disabled[^>]*>Confirm capture import/);

    const applyingMarkup = render({ status: "applying", draft, preview });
    expect(applyingMarkup).toContain('role="status"');
    expect(applyingMarkup).toContain("Applying capture import");
    expect(applyingMarkup).toContain("Cancel capture import");

    const errorMarkup = render({
      status: "error", draft, preview, message: "Active project changed", staleTarget: true,
    });
    expect(errorMarkup).toContain('role="alert"');
    expect(errorMarkup).not.toContain("Preview again");
    expect(errorMarkup).toContain("Reload active project");
    expect(errorMarkup).toMatch(/aria-label="Close capture import"[^>]*disabled/);
    expect(errorMarkup).not.toMatch(/>Close<\/button>/);

    const recoveringMarkup = render({
      status: "error", draft, preview, message: "Checking active project", staleTarget: true,
      recovering: true,
    });
    expect(recoveringMarkup).toMatch(/<button[^>]*disabled[^>]*>.*?Reloading active project.*?<\/button>/);
  });

  it("does not claim an apply cancellation left project data unchanged", () => {
    const base = createCaptureImportState(currentTarget);
    const markup = render({
      status: "error",
      draft: { ...base.draft, destinationKind: "current-project", files: [{} as File] },
      preview,
      message: "The confirmation request was cancelled. Its final server result is unknown.",
      staleTarget: true,
    });

    expect(markup).toContain("final server result is unknown");
    expect(markup).not.toContain("No project data was changed");
    expect(markup).not.toContain("Preview again");
  });

  it("uses the shared focus-trapped dialog and bounds long preview lists", () => {
    const source = readFileSync(new URL("./CaptureImportDialog.tsx", import.meta.url), "utf8");

    expect(source).toContain("DialogShell");
    expect(source).toContain("PREVIEW_ITEM_LIMIT");
    expect(source).toContain("max-w-5xl");
    expect(source).toContain("sm:grid-cols-2");
  });
});
