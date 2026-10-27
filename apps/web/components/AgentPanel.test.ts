// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STORE_SPECS } from "@screenshot-studio/core/export";
import { parseProject } from "@screenshot-studio/core/model";
import type { AgentStatus } from "@web/lib/agents/agent-registry.server";
import type { AgentEvent } from "@web/lib/agents/agent-session.server";
import { editorStore } from "@web/lib/editor/editor-store";
import type { EditorAgentChat } from "@web/app/editor/use-editor-agent-chat";
import { AgentPanel, AgentRunBanner } from "./AgentPanel";
import { applyAgentEvent, attachmentFileProblem, createAgentTurn } from "./agent-panel-model";

const sample = JSON.parse(readFileSync(
  new URL("../../../fixtures/sample/app-store-screenshots.json", import.meta.url),
  "utf8",
));
const policy = { level: "supported", reason: "", consequences: "", sourceUrl: "https://example.test", checkedAt: "2026-10-15" } as const;
const claude: AgentStatus = {
  id: "claude-code", name: "Claude Code", installed: true, version: "2.1.296", minVersion: "2.1.268",
  state: "ready", authMode: "subscription", policy, consented: null,
  models: [{ id: "claude-sonnet-5-5", label: "Sonnet 5.5" }, { id: "claude-haiku-5-5", label: "Haiku 5.5" }],
  efforts: [{ id: "medium", label: "Medium" }, { id: "high", label: "High" }], defaultEffort: "high",
  setupUrl: "https://code.claude.com/docs/en/setup", signInCommand: "claude",
};
const codex: AgentStatus = {
  ...claude, id: "codex", name: "Codex", state: "not-signed-in", authMode: null, models: [], efforts: [], defaultEffort: null,
  setupUrl: "https://developers.openai.com/codex/quickstart", signInCommand: "codex login",
};

function chat(overrides: Partial<EditorAgentChat> = {}): EditorAgentChat {
  const agents = overrides.agents === undefined ? [claude, codex] : overrides.agents;
  return {
    agents,
    agentsError: null,
    checking: false,
    selected: agents?.[0],
    selectedModel: agents?.[0]?.models[0]?.id ?? null,
    selectedEffort: agents?.[0]?.defaultEffort ?? null,
    turns: [],
    phase: "idle",
    locked: false,
    outcome: null,
    outcomeError: null,
    criticOffered: false,
    consentError: null,
    setConsent: vi.fn(),
    refreshAgents: vi.fn(),
    selectAgent: vi.fn(),
    selectModel: vi.fn(),
    selectEffort: vi.fn(),
    send: vi.fn(),
    critique: vi.fn(),
    dismissCritic: vi.fn(),
    queueStart: vi.fn(),
    stop: vi.fn(),
    keep: vi.fn(),
    undo: vi.fn(),
    newChat: vi.fn(),
    ...overrides,
  };
}

const render = (state: EditorAgentChat) => renderToStaticMarkup(createElement(AgentPanel, {
  chat: state,
  open: true,
  specs: DEFAULT_STORE_SPECS,
  issueCounts: { blockers: 0, warnings: 1 },
  onClose: vi.fn(),
  onGoToScreen: vi.fn(),
  onOpenIssues: vi.fn(),
}));

describe("AgentPanel", () => {
  beforeEach(() => {
    editorStore.getState().load(parseProject(sample));
    // Server rendering reads zustand's initial state; serve the loaded project instead.
    vi.spyOn(editorStore, "getInitialState").mockImplementation(() => editorStore.getState());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    editorStore.getState().resetProjectState();
  });

  it("picks the agent, model and effort with labelled controls and names the composer", () => {
    const markup = render(chat());

    expect(markup.match(/aria-haspopup="menu"/g)).toHaveLength(3);
    expect(markup).toMatch(/aria-label="Agent" aria-haspopup="menu"/);
    expect(markup).toMatch(/aria-label="Model" aria-haspopup="menu"[^]*?>Sonnet 5\.5<\/span>/);
    expect(markup).toMatch(/aria-label="Effort" aria-haspopup="menu"[^]*?>High effort<\/span>/);
    const codexMarkup = render(chat({ agents: [codex, claude], selected: { ...codex, state: "ready" }, selectedModel: null, selectedEffort: null }));
    expect(codexMarkup).toContain("CLI default model");
    expect(codexMarkup).not.toMatch(/aria-label="(?:Model|Effort)"/);
    expect(markup).toContain("Your subscription · runs on this computer");
    expect(markup).toMatch(/<label[^>]*class="sr-only"[^>]*>Message to Claude Code<\/label>/);
    expect(markup).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Send<\/button>/);
  });

  it("suggests starting points, offers the critic only after a kept run, and applies a critique through the composer", () => {
    const empty = render(chat());
    expect(empty).toMatch(/role="group" aria-label="Suggestions"[^]*>Make it sell<[^]*>Write store copy<[^]*>Match a reference<[^]*>Critique my set</);
    expect(empty).not.toContain("Run critic");

    const kept = createAgentTurn(1, "Claude Code", "Make it sell");
    expect(render(chat({ turns: [kept], criticOffered: true }))).toMatch(/aria-label="Critic review"[^]*>Run critic<[^]*>Not now</);
    expect(render(chat({ turns: [kept], criticOffered: true, phase: "running" }))).not.toContain("Run critic");

    const critique = ([
      { type: "text", text: "[major] Slide 1: headline names a feature." },
      { type: "result", status: "accepted", reason: null, changed: false, changedScreens: [], revision: "r", otherFiles: { files: [], count: 0 } },
      { type: "done", status: "completed", summary: null, durationMs: 10 },
    ] as AgentEvent[]).reduce(applyAgentEvent, createAgentTurn(2, "Claude Code", "Review", [], "critic"));
    const reviewed = render(chat({ turns: [critique] }));
    expect(reviewed).toContain(">Apply findings</button>");
    expect(reviewed).not.toContain("No changes to the project");
  });

  it("explains every 7c state with its next action", () => {
    const missing = { ...claude, installed: false, state: "not-installed" as const };
    const noAgent = render(chat({ agents: [missing, { ...codex, installed: false, state: "not-installed" }] }));
    expect(noAgent).toContain("No agent found");
    expect(noAgent).toContain("The editor works without an agent.");
    expect(noAgent).toContain('href="https://code.claude.com/docs/en/setup"');
    expect(noAgent).toContain('aria-label="Set up Codex"');
    expect(noAgent).toContain("Check again");
    expect(noAgent).not.toContain('aria-haspopup="menu"');

    const signedOut = render(chat({ selected: codex, selectedModel: null }));
    expect(signedOut).toContain("Codex is installed but not signed in.");
    expect(signedOut).toContain("<code");
    expect(signedOut).toContain("codex login");
    expect(signedOut).toContain("CLI default model");

    const limited: AgentEvent[] = [
      { type: "error", code: "usage-limit", message: "limit", resets: "3pm (Europe/Kyiv)" },
      { type: "result", status: "accepted", reason: null, changed: false, changedScreens: [], revision: "r1", otherFiles: { files: [], count: 0 } },
      { type: "done", status: "failed", summary: null, durationMs: 10 },
    ];
    const limit = render(chat({ turns: [limited.reduce(applyAgentEvent, createAgentTurn(1, "Claude Code", "Add German"))] }));
    expect(limit).toContain('role="alert"');
    expect(limit).toContain("Your Claude Code subscription limit resets 3pm (Europe/Kyiv). Nothing in the project was changed.");
    expect(limit).toContain("Switch agent");
    expect(limit).toContain("Retry");

    const earlierLimit = { ...limited.reduce(applyAgentEvent, createAgentTurn(1, "Claude Code", "Add German")), earlier: true, droppedImages: 2 };
    const restored = render(chat({ turns: [earlierLimit, createAgentTurn(2, "Claude Code", "Now French")] }));
    expect(restored).toContain("Your Claude Code subscription limit resets 3pm (Europe/Kyiv).");
    expect(restored).toContain("2 images not kept after reload");
    expect(restored).toContain('role="separator"');
    expect(restored).toContain("Restored after the page reloaded");
    expect(restored).not.toContain("Switch agent");
    expect(restored).not.toContain(">Retry<");

    const rejectedEvents: AgentEvent[] = [
      { type: "result", status: "rejected", reason: "layouts: Required", changed: false, changedScreens: [], revision: "r1", otherFiles: { files: [], count: 0 } },
      { type: "done", status: "failed", summary: null, durationMs: 10 },
    ];
    const rejected = render(chat({ turns: [rejectedEvents.reduce(applyAgentEvent, createAgentTurn(1, "Claude Code", "Add German"))] }));
    expect(rejected).toContain("didn&#x27;t pass schema validation. The project is back to its state before the run.");
    expect(rejected).toContain("<summary");
    expect(rejected).toContain("layouts: Required");
    expect(rejected).toContain("Ask agent to fix");
  });

  it("badges each policy level and asks for explicit consent before an at-own-risk agent", () => {
    expect(render(chat())).toMatch(/Policy: <\/span>Supported/);
    expect(render(chat({ selected: codex, selectedModel: null }))).not.toContain("Revoke consent");

    const risky: AgentStatus = {
      ...claude, id: "risky", name: "Risky", models: [], consented: false,
      policy: { ...policy, level: "at-own-risk", reason: "Terms forbid wrappers.", consequences: "Your account can be banned.", sourceUrl: "https://example.test/terms" },
    };
    const warning = render(chat({ agents: [claude, risky], selected: risky, selectedModel: null }));
    expect(warning).toContain("Use Risky at your own risk");
    expect(warning).toContain("Terms forbid wrappers.");
    expect(warning).toContain("Your account can be banned.");
    expect(warning).toContain('href="https://example.test/terms"');
    expect(warning).toContain("checked 2026-10-15");
    expect(warning).toContain("I understand, enable Risky");
    expect(warning).toMatch(/Policy: <\/span>At your own risk/);
    expect(warning).not.toContain("Revoke consent");
    expect(warning).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Send<\/button>/);

    const consented = render(chat({ agents: [claude, { ...risky, consented: true }], selected: { ...risky, consented: true }, selectedModel: null }));
    expect(consented).not.toContain("I understand, enable");
    expect(consented).toContain("Revoke consent");
    expect(render(chat({ agents: [claude, { ...risky, consented: true }], selected: { ...risky, consented: true }, selectedModel: null, consentError: "Consent could not be saved (500)" })))
      .toContain("Consent could not be saved (500)");

    const unavailable = { ...risky, state: "unavailable" as const, policy: { ...risky.policy, level: "unavailable" as const } };
    expect(render(chat({ agents: [claude, unavailable], selected: unavailable, selectedModel: null })))
      .not.toContain("I understand, enable");
    const noAdapter = { ...risky, state: "no-adapter" as const, installed: null, consented: true };
    const unwired = render(chat({ agents: [claude, noAdapter], selected: noAdapter, selectedModel: null }));
    expect(unwired).toContain("Not supported in the editor yet");
    expect(unwired).not.toContain("I understand, enable");
  });

  it("announces a running step, shows the command, and offers Stop", () => {
    const turn: AgentEvent[] = [
      { type: "progress", step: 2, total: 3, steps: [
        { label: "Read project", status: "completed" },
        { label: "Add locale DE", status: "in_progress" },
        { label: "Validate project", status: "pending" },
      ] },
      { type: "tool-use", tool: "Bash", command: "screenshots locale add de", path: null },
    ];
    const state = chat({
      phase: "running",
      locked: true,
      turns: [turn.reduce(applyAgentEvent, createAgentTurn(1, "Claude Code", "Add German"))],
    });
    const markup = render(state);

    expect(markup).toMatch(/role="status"[^>]*>.*Running · step 2 of 3 · Changing the project/);
    expect(markup).toContain('aria-label="Steps"');
    expect(markup).toContain("(in progress)");
    expect(markup).toContain("screenshots locale add de");
    expect(markup).toMatch(/<button type="button"[^>]*>Stop<\/button>/);
    expect(markup).toContain("The agent is working. You can type the next request.");

    const banner = renderToStaticMarkup(createElement(AgentRunBanner, { chat: state }));
    expect(banner).toContain("Claude Code is editing this project");
    expect(banner).toContain("Editing, Export and Undo are paused until it finishes.");
    expect(banner).toContain('aria-label="Stop Claude Code"');
  });

  it("reviews an accepted run with Go to, checks, and Keep / Undo run (7b)", () => {
    const markup = render(chat({
      outcome: {
        revision: "r2", changedScreens: ["save-fast", "hero"], otherFiles: { files: [], count: 0 }, finishedAt: "2026-10-22T12:06:00.000Z",
      },
    }));

    expect(markup).toContain('aria-label="Agent run review"');
    expect(markup).toContain("Changes · 2");
    expect(markup).toContain('aria-label="Go to Save Fast"');
    expect(markup).toContain("Project passes schema validation");
    expect(markup).toContain("1 warning");
    expect(markup).toContain("Undo run");
    expect(markup).toContain("Keep changes");
    expect(markup).not.toContain("Message to Claude Code");
  });

  it("lists the other files a run changed, which neither Undo run nor Stop restores", () => {
    const otherFiles = {
      files: [{ path: "AGENTS.md", change: "modified" as const }, { path: "themes/brand.json", change: "added" as const }],
      count: 3,
    };
    const unchangedEvents: AgentEvent[] = [
      { type: "result", status: "accepted", reason: null, changed: false, changedScreens: [], revision: "r1", otherFiles },
      { type: "done", status: "completed", summary: null, durationMs: 10 },
    ];
    const unchanged = render(chat({ turns: [unchangedEvents.reduce(applyAgentEvent, createAgentTurn(1, "Codex", "Tidy"))] }));
    expect(unchanged).toContain("No changes to the project file.");
    expect(unchanged).toContain("Other files · 3");
    expect(unchanged).toMatch(/aria-label="Other files changed".*AGENTS\.md<\/span><span[^>]*>changed<\/span>/);
    expect(unchanged).toContain("and 1 more");
    expect(unchanged).toContain("Undo run and Stop don&#x27;t restore these files.");

    const stoppedEvents: AgentEvent[] = [
      { type: "result", status: "accepted", reason: null, changed: false, changedScreens: [], revision: "r1", otherFiles: null },
      { type: "done", status: "cancelled", summary: null, durationMs: 10 },
    ];
    const stopped = render(chat({ turns: [stoppedEvents.reduce(applyAgentEvent, createAgentTurn(1, "Codex", "Tidy"))] }));
    expect(stopped).toContain("Stopped. The project file is back to its state before this run.");
    expect(stopped).toContain("The project folder could not be compared, so changes to other files are unknown.");

    const review = render(chat({
      outcome: { revision: "r2", changedScreens: ["hero"], otherFiles, finishedAt: "2026-10-22T12:06:00.000Z" },
    }));
    expect(review).toContain('aria-label="Agent run review"');
    expect(review).toContain("Other files · 3");
    expect(review).toContain("themes/brand.json");
    expect(review).toContain("Undo run restores the project file from the snapshot taken before the run.");
  });

  it("offers a labelled Attach button and shows a message's images with their file names", () => {
    const image = new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "brand.png", { type: "image/png" });
    const turn = createAgentTurn(1, "Claude Code", "Match this", [{ file: image, url: "blob:brand" }]);

    const markup = render(chat({ turns: [turn] }));

    expect(markup).toContain('aria-label="Attach images"');
    expect(markup).toContain('accept="image/png,image/jpeg,image/webp"');
    expect(markup).toMatch(/<ul aria-label="Attached images"[^>]*><li><img src="blob:brand" alt="brand.png"/);
  });

  it("checks a picked file by its bytes, not its name or type", async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    expect(await attachmentFileProblem(new File([png], "ref.png", { type: "image/png" }))).toBeNull();
    expect(await attachmentFileProblem(new File([png], "ref.txt", { type: "text/plain" }))).toBeNull();
    expect(await attachmentFileProblem(new File(["<svg/>"], "ref.png", { type: "image/png" }))).toMatch(/PNG, JPEG and WebP/);
  });
});
