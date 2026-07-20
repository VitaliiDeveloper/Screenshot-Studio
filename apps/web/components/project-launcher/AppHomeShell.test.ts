// SPDX-License-Identifier: Apache-2.0
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { listStarterProjectTemplates } from "@screenshot-studio/core/scaffold";
import { AppHomeShell } from "./AppHomeShell.js";

const dialogSource = readFileSync(new URL("./ProjectImportDialog.tsx", import.meta.url), "utf8");
const appHomeSource = readFileSync(new URL("./AppHomeShell.tsx", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

function render(
  state: Parameters<typeof AppHomeShell>[0]["state"] = { status: "idle" },
  dialogClosing = false,
) {
  return renderToStaticMarkup(createElement(AppHomeShell, {
    state,
    creationState: { status: "closed" },
    projectTemplates: listStarterProjectTemplates(),
    dialogClosing,
    sessionError: null,
    onOpenImport: vi.fn(),
    onOpenCreate: vi.fn(),
    onCloseCreate: vi.fn(),
    onChangeCreation: vi.fn(),
    onSubmitCreation: vi.fn(),
    onCloseImport: vi.fn(),
    onCancelImport: vi.fn(),
    onConfirmImport: vi.fn(),
    onRetryImport: vi.fn(),
    onSelectSource: vi.fn(),
  }));
}

describe("AppHomeShell", () => {
  it("renders one App Home heading with enabled Create and Import plus the future recents slot", () => {
    const markup = render();

    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toContain("Screenshot Studio");
    expect(markup).toContain("Create project");
    expect(markup).not.toContain("Coming in Launcher 5");
    expect(markup).toContain("Choose starting point");
    expect(markup).toContain("Import project");
    expect(markup).toContain("Capture import");
    expect(markup).toContain("PNG capture folder");
    expect(markup).toContain("Recent projects");
    expect(markup).toContain("Launcher 8");
    expect(markup).not.toContain('type="text"');
  });

  it("shows a generic starter library with configuration, previews, and compatibility", () => {
    const markup = renderToStaticMarkup(createElement(AppHomeShell, {
      state: { status: "idle" },
      creationState: {
        status: "editing",
        form: {
          name: "Desktop launch",
          platform: "windows",
          layoutMode: "connected",
          templateId: null,
        },
      },
      projectTemplates: listStarterProjectTemplates(),
      dialogClosing: false,
      sessionError: null,
      onOpenImport: vi.fn(),
      onOpenCreate: vi.fn(),
      onCloseCreate: vi.fn(),
      onChangeCreation: vi.fn(),
      onSubmitCreation: vi.fn(),
      onCloseImport: vi.fn(), onCancelImport: vi.fn(), onConfirmImport: vi.fn(),
      onRetryImport: vi.fn(), onSelectSource: vi.fn(),
    }));

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("Create a managed project");
    expect(markup).toContain('value="Desktop launch"');
    expect(markup).toContain("Target platform");
    expect(markup).toContain('aria-label="Target platform"');
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).not.toContain("<select");
    expect(markup).toContain("Layout mode");
    expect(markup).toContain("Empty project");
    expect(markup).toContain("Feature focus");
    expect(markup).toContain("Product launch");
    expect(markup).toContain("Not available for Windows");
    expect(markup).not.toContain("PROJECT_PATH");
    expect(markup).not.toContain("server path");
  });

  it("describes managed-copy behavior and all supported import choices", () => {
    const markup = render({ status: "choosing" });

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("managed copy");
    expect(markup).toContain("Folder");
    expect(markup).toContain("Recommended");
    expect(markup).toContain("Project ZIP");
    expect(markup).toContain("Standalone JSON");
    expect(markup).toContain('accept=".zip,application/zip"');
    expect(markup).toContain('accept=".json,application/json"');
  });

  it("confirms the managed copy before transfer and explains local in-place opening", () => {
    const markup = render({ status: "confirming", kind: "folder" });

    expect(markup).toContain("Import a managed copy?");
    expect(markup).toContain("Your original folder stays unchanged");
    expect(markup).toContain("Import managed copy");
    expect(markup).toContain("Choose another source");
    expect(markup).toContain("PROJECT_PATH");
    expect(markup).toContain("screenshots dev --project");
    expect(markup).toMatch(/<h2[^>]*>Import a managed copy\?<\/h2>/);

    const archiveMarkup = render({ status: "confirming", kind: "archive" });
    expect(archiveMarkup).not.toContain("PROJECT_PATH");
  });

  it("keeps the folder confirmation disclosure inside the dialog focus trap", () => {
    const focusableSelector = dialogSource.match(/querySelectorAll<HTMLElement>\(\s*'([^']+)'/)?.[1];

    expect(focusableSelector).toContain("summary");
  });

  it("animates dialog entry, state changes, and exit while respecting reduced motion", () => {
    const markup = render({ status: "choosing" });
    const closingMarkup = render({ status: "choosing" }, true);

    expect(markup).toContain("active:scale-[0.98]");
    expect(markup).toContain("launcher-dialog-backdrop");
    expect(markup).toContain("launcher-dialog-panel");
    expect(markup).toContain("launcher-dialog-state");
    expect(markup).toContain('data-motion="open"');
    expect(closingMarkup).toContain('data-motion="closing"');
    expect(globalStyles).toContain("@keyframes launcher-dialog-in");
    expect(globalStyles).toContain("@keyframes launcher-dialog-out");
    expect(globalStyles).toContain("@keyframes launcher-dialog-state-in");
    expect(globalStyles).toContain('[data-motion="closing"]');
    expect(globalStyles).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("uses one motion contract for every App Home action", () => {
    expect(appHomeSource.match(/launcherActionMotion/g)).toHaveLength(4);
    expect(appHomeSource).toContain("duration-150");
    expect(appHomeSource).toContain("ease-out");
    expect(appHomeSource).toContain("hover:-translate-y-0.5");
    expect(appHomeSource).toContain("active:scale-[0.98]");
    expect(appHomeSource).toContain("motion-reduce:transform-none");
  });

  it("explains the native browser boundary before Folder selection", () => {
    const markup = render({ status: "choosing" });

    expect(markup).toContain(
      "Your browser may ask you to confirm uploading the selected files.",
    );
  });

  it("uses alert and list semantics for missing resources", () => {
    const markup = render({
      status: "error",
      message: "Project import is missing resources",
      missingResources: ["screenshots/hero.png", "assets/icon.png"],
    });

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("screenshots/hero.png");
    expect(markup).toContain("assets/icon.png");
    expect(markup).toContain("Try another source");
  });

  it("offers cancellation only while upload remains cancellable", () => {
    const uploading = render({ status: "uploading", kind: "archive", cancellable: true });
    const publishing = render({ status: "publishing", kind: "archive", cancellable: false });

    expect(uploading).toContain("Cancel import");
    expect(uploading).toContain('role="status"');
    expect(publishing).toContain("Validating and publishing");
    expect(publishing).not.toContain("Cancel import");
  });

  it("moves focus into the modal, traps Tab, and reserves Escape during publication", () => {
    expect(dialogSource).toContain("headingRef.current?.focus()");
    expect(dialogSource).toContain('event.key !== "Tab"');
    expect(dialogSource).toContain('event.key === "Escape" && state.status !== "publishing"');
    expect(dialogSource).toContain("tabIndex={-1}");
  });

});
