// SPDX-License-Identifier: Apache-2.0
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { parseProject } from "@screenshot-studio/core/model";
import { listStarterProjectTemplates } from "@screenshot-studio/core/scaffold";
import type { AgentStatus } from "@web/lib/agents/agent-registry.server";
import type { ProjectLibraryEntry } from "@web/lib/clients/project-library-client.js";
import { AppHomeShell, type AppHomeShellProps } from "./AppHomeShell.js";
import { agentStartMessage } from "@web/lib/editor/agent-start-request";

vi.mock("../ScreenThumbnail.js", () => ({
  ScreenThumbnail: () => createElement("img", { alt: "" }),
}));

const dialogSource = readFileSync(new URL("./ProjectImportDialog.tsx", import.meta.url), "utf8");
const dialogShellSource = readFileSync(new URL("../editor-ui/DialogShell.tsx", import.meta.url), "utf8");
const appHomeSource = readFileSync(new URL("./AppHomeShell.tsx", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

const policy = { level: "supported", reason: "", consequences: "", sourceUrl: "https://example.test", checkedAt: "2026-10-15" } as const;
const claude: AgentStatus = {
  id: "claude-code", name: "Claude Code", installed: true, version: "2.1.296", minVersion: "2.1.268",
  state: "ready", authMode: "subscription", policy, consented: null, models: ["sonnet", "opus", "haiku"],
  setupUrl: "https://code.claude.com/docs/en/setup", signInCommand: "claude",
};
const signedOut: AgentStatus = { ...claude, id: "codex", name: "Codex", state: "not-signed-in", models: [] };
const ownRisk: AgentStatus = {
  ...claude, id: "agy", name: "Antigravity", policy: { ...policy, level: "at-own-risk" }, consented: false,
};
const entry: ProjectLibraryEntry = {
  entryId: "project_00000000000000000000000000000001",
  sourceKind: "managed-project",
  name: "Store Launch Demo",
  lastOpenedAt: "2026-07-20T10:00:00.000Z",
  availability: "available",
  platforms: ["apple:iphone"],
  screenCount: 1,
  layoutCount: 1,
  previewLayoutId: "default",
  previewScreenIds: ["hero"],
  previewProject: parseProject(JSON.parse(readFileSync("fixtures/sample/app-store-screenshots.json", "utf8"))),
};

function render(
  state: Parameters<typeof AppHomeShell>[0]["state"] = { status: "idle" },
  dialogClosing = false,
  overrides: Partial<AppHomeShellProps> = {},
) {
  return renderToStaticMarkup(createElement(AppHomeShell, {
    state,
    creationState: { status: "closed" },
    projectTemplates: listStarterProjectTemplates(),
    dialogClosing,
    projects: { status: "ready", entries: [] },
    projectAction: null,
    projectActionError: null,
    projectActionNotice: null,
    visibleOpeningEntryId: null,
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
    onChooseCapture: vi.fn(),
    onRetryProjects: vi.fn(),
    onOpenProject: vi.fn(),
    onOpenProjectDetails: vi.fn(),
    onExportArchive: vi.fn(),
    onDeleteProject: vi.fn(),
    onRemoveRecent: vi.fn(),
    ...overrides,
  }));
}

const gallery = { projects: { status: "ready", entries: [entry] } } as const;
const creating = {
  creationState: {
    status: "editing",
    form: { name: "Run Habit", platform: "apple", device: "iphone", layoutMode: "isolated", templateId: null },
  },
} as const;

describe("AppHomeShell", () => {
  it("restores the original launcher composition with exactly New project and Import", () => {
    const markup = render();

    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toContain("Screenshot Studio");
    expect(markup).toContain("Turn product moments into store-ready stories.");
    expect(markup).toContain('aria-label="Project actions"');
    expect(markup).toContain("New project");
    expect(markup).toContain("Import");
    expect(markup.match(/<button/g)).toHaveLength(2);
    expect(markup).not.toContain("Recent projects");
    expect(markup).not.toContain("Starter examples");
    expect(markup).not.toContain("Capture import");
    expect(markup).not.toContain("Create your first screenshot project");
    expect(markup).not.toContain('type="text"');
  });

  it("offers an agent that can run only inside New project, on first run and beside the gallery", () => {
    for (const projects of [{ projects: { status: "ready", entries: [] } } as const, gallery]) {
      const page = render({ status: "idle" }, false, { ...projects, agents: [signedOut, claude] });
      const dialog = render({ status: "idle" }, false, { ...projects, ...creating, agents: [signedOut, claude] });

      expect(page).not.toContain("Start with agent");
      expect(dialog).toMatch(/<input type="radio" class="mt-1 accent-\[var\(--editor-color-agent\)\]" name="starter"\/><span[^>]*><svg[^>]*>.*?<\/svg><\/span><span><span[^>]*>Start with agent<\/span>/);
      expect(dialog).toContain("Claude Code creates the first screens on a blank project.");
      expect(dialog).toMatch(/<input type="radio" name="starter" checked=""\/>.*?Blank/);
      expect(dialog).not.toContain("<textarea");
      expect(dialog).not.toContain("Codex");
    }
  });

  it("hides the agent starting point without an agent that can run now", () => {
    expect(render({ status: "idle" }, false, { ...gallery, ...creating, agents: [signedOut, ownRisk] })).not.toContain("Start with agent");
    expect(render({ status: "idle" }, false, { ...gallery, ...creating, agents: [] })).not.toContain("Start with agent");
    expect(render({ status: "idle" }, false, { ...gallery, ...creating, agents: [{ ...ownRisk, consented: true }] }))
      .toContain("Antigravity creates the first screens on a blank project.");
  });

  it("sends the destination with the description as the first message", () => {
    expect(agentStartMessage({ description: " Habit tracker \n", destination: "App Store · iPhone" })).toBe(
      "Create the first screens for this new screenshot project.\nDestination: App Store · iPhone\n\nHabit tracker",
    );
  });

  it("shows platform-aware starters with configuration and previews", () => {
    const markup = renderToStaticMarkup(createElement(AppHomeShell, {
      state: { status: "idle" },
      creationState: {
        status: "editing",
        form: {
          name: "Desktop launch",
          platform: "windows",
          device: "desktop",
          layoutMode: "connected",
          templateId: null,
        },
      },
      projectTemplates: listStarterProjectTemplates(),
      dialogClosing: false,
      projects: { status: "loading" },
      projectAction: null,
      projectActionError: null,
      projectActionNotice: null,
      visibleOpeningEntryId: null,
      onOpenImport: vi.fn(),
      onOpenCreate: vi.fn(),
      onCloseCreate: vi.fn(),
      onChangeCreation: vi.fn(),
      onSubmitCreation: vi.fn(),
      onCloseImport: vi.fn(), onCancelImport: vi.fn(), onConfirmImport: vi.fn(),
      onRetryImport: vi.fn(), onSelectSource: vi.fn(),
      onChooseCapture: vi.fn(),
      onRetryProjects: vi.fn(), onOpenProject: vi.fn(),
      onOpenProjectDetails: vi.fn(), onExportArchive: vi.fn(),
      onDeleteProject: vi.fn(), onRemoveRecent: vi.fn(),
    }));

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("Create a managed project");
    expect(markup).toContain('value="Desktop launch"');
    expect(markup).toContain("Target platform");
    expect(markup).toContain('aria-label="Target platform"');
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).not.toContain("<select");
    expect(markup).toContain("Layout mode");
    expect(markup).toContain("Blank");
    expect(markup).toContain("Feature focus");
    expect(markup).not.toContain("Product launch");
    expect(markup).not.toContain("iPhone");
    expect(markup).not.toContain("Play Feature Graphic");
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
    const focusableSelector = dialogShellSource.match(/querySelectorAll<HTMLElement>\(\s*\n?\s*"([^"]+)"/)?.[1];

    expect(dialogSource).toContain("<DialogShell");
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

  it("uses one motion contract for the two first-run actions", () => {
    expect(appHomeSource.match(/firstRunActionMotion/g)).toHaveLength(3);
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

  it("uses the shared modal focus trap and reserves closing during publication", () => {
    expect(dialogSource).toContain("<DialogShell");
    expect(dialogSource).toContain('initialFocus="heading"');
    expect(dialogSource).toContain('closeDisabled={closing || state.status === "publishing"}');
    expect(dialogShellSource).toContain('event.key !== "Tab"');
    expect(dialogShellSource).toContain('event.key === "Escape"');
    expect(dialogShellSource).toContain("headingRef.current");
    expect(dialogShellSource).toContain("summary, [tabindex]");
  });

});
