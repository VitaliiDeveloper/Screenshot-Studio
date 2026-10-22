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
import { applyAgentEvent, createAgentTurn } from "./agent-panel-model";

const sample = JSON.parse(readFileSync(
  new URL("../../../fixtures/sample/app-store-screenshots.json", import.meta.url),
  "utf8",
));
const policy = { level: "supported", reason: "", consequences: "", sourceUrl: "https://example.test", checkedAt: "2026-10-15" } as const;
const claude: AgentStatus = {
  id: "claude-code", name: "Claude Code", installed: true, version: "2.1.296", minVersion: "2.1.268",
  state: "ready", authMode: "subscription", policy, models: ["sonnet", "opus", "haiku"],
  setupUrl: "https://code.claude.com/docs/en/setup", signInCommand: "claude",
};
const codex: AgentStatus = {
  ...claude, id: "codex", name: "Codex", state: "not-signed-in", authMode: null, models: [],
  setupUrl: "https://developers.openai.com/codex/quickstart", signInCommand: "codex login",
};

function chat(overrides: Partial<EditorAgentChat> = {}): EditorAgentChat {
  const agents = overrides.agents === undefined ? [claude, codex] : overrides.agents;
  return {
    agents,
    agentsError: null,
    checking: false,
    selected: agents?.[0],
    selectedModel: agents?.[0]?.models[0] ?? null,
    turns: [],
    phase: "idle",
    locked: false,
    outcome: null,
    outcomeError: null,
    refreshAgents: vi.fn(),
    selectAgent: vi.fn(),
    selectModel: vi.fn(),
    send: vi.fn(),
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

  it("picks the agent and model with labelled controls and names the composer", () => {
    const markup = render(chat());

    expect(markup.match(/aria-haspopup="menu"/g)).toHaveLength(2);
    expect(markup).toMatch(/aria-label="Agent" aria-haspopup="menu"/);
    expect(markup).toMatch(/aria-label="Model" aria-haspopup="menu"/);
    expect(markup).toContain("Your subscription · runs on this computer");
    expect(markup).toMatch(/<label[^>]*class="sr-only"[^>]*>Message to Claude Code<\/label>/);
    expect(markup).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Send<\/button>/);
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
      { type: "result", status: "accepted", reason: null, changed: false, changedScreens: [], revision: "r1" },
      { type: "done", status: "failed", summary: null, durationMs: 10 },
    ];
    const limit = render(chat({ turns: [limited.reduce(applyAgentEvent, createAgentTurn(1, "Claude Code", "Add German"))] }));
    expect(limit).toContain('role="alert"');
    expect(limit).toContain("Your Claude Code subscription limit resets 3pm (Europe/Kyiv). Nothing in the project was changed.");
    expect(limit).toContain("Switch agent");
    expect(limit).toContain("Retry");

    const rejectedEvents: AgentEvent[] = [
      { type: "result", status: "rejected", reason: "layouts: Required", changed: false, changedScreens: [], revision: "r1" },
      { type: "done", status: "failed", summary: null, durationMs: 10 },
    ];
    const rejected = render(chat({ turns: [rejectedEvents.reduce(applyAgentEvent, createAgentTurn(1, "Claude Code", "Add German"))] }));
    expect(rejected).toContain("didn&#x27;t pass schema validation. The project is back to its state before the run.");
    expect(rejected).toContain("<summary");
    expect(rejected).toContain("layouts: Required");
    expect(rejected).toContain("Ask agent to fix");
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
      outcome: { revision: "r2", changedScreens: ["save-fast", "hero"], finishedAt: "2026-10-22T12:06:00.000Z" },
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
});
