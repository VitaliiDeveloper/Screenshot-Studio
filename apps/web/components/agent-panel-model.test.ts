// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_STORE_SPECS } from "@screenshot-studio/core/export";
import { parseProject } from "@screenshot-studio/core/model";
import type { AgentStatus } from "@web/lib/agents/agent-registry.server";
import type { AgentEvent } from "@web/lib/agents/agent-session.server";
import {
  agentCanRun,
  agentNotice,
  agentStateLabel,
  applyAgentEvent,
  changedScreenRows,
  createAgentEventParser,
  createAgentTurn,
  defaultAgentId,
  turnActivity,
  turnOutcome,
  turnProgressLabel,
  type AgentTurn,
} from "./agent-panel-model";

const sample = parseProject(JSON.parse(readFileSync(
  new URL("../../../fixtures/sample/app-store-screenshots.json", import.meta.url),
  "utf8",
)));

const policy = { level: "supported", reason: "", consequences: "", sourceUrl: "https://example.test", checkedAt: "2026-10-15" } as const;
function agentStatus(overrides: Partial<AgentStatus> = {}): AgentStatus {
  return {
    id: "claude-code", name: "Claude Code", installed: true, version: "2.1.296", minVersion: "2.1.268",
    state: "ready", authMode: "subscription", policy, consented: null, models: ["sonnet", "opus", "haiku"],
    setupUrl: "https://code.claude.com/docs/en/setup", signInCommand: "claude",
    ...overrides,
  };
}
const gemini = agentStatus({
  id: "gemini-cli", name: "Gemini CLI", installed: null, version: null, minVersion: null, state: "unavailable",
  authMode: null, models: [], setupUrl: null, signInCommand: null,
  policy: { ...policy, level: "unavailable", reason: "No individual subscriptions." },
});

const accepted = (changedScreens: string[]): AgentEvent => ({
  type: "result", status: "accepted", reason: null, changed: changedScreens.length > 0, changedScreens, revision: "r2",
});
const done = (status: "completed" | "failed" | "cancelled" = "completed"): AgentEvent => ({
  type: "done", status, summary: status === "completed" ? "Added DE to 4 screens." : null, durationMs: 100,
});
const play = (...events: AgentEvent[]): AgentTurn =>
  events.reduce(applyAgentEvent, createAgentTurn(1, "Claude Code", "Add German"));

describe("agent event stream", () => {
  it("splits SSE frames across chunks and skips keep-alives and broken frames", () => {
    const parse = createAgentEventParser();
    expect(parse(': keep-alive\n\ndata: {"type":"text","te')).toEqual([]);
    expect(parse('xt":"Hi"}\n\ndata: not json\n\ndata: {"type":"done","status":"completed","summary":null,"durationMs":1}\n\n'))
      .toEqual([{ type: "text", text: "Hi" }, { type: "done", status: "completed", summary: null, durationMs: 1 }]);
  });

  it("follows the plan and says whether the agent thinks or changes the project", () => {
    const steps = [
      { label: "Read project", status: "completed" },
      { label: "Add locale DE", status: "in_progress" },
      { label: "Validate project", status: "pending" },
    ] as const;
    const reading = play({ type: "text", text: "I'll add German." }, { type: "tool-use", tool: "Read", command: null, path: "AGENTS.md" });
    expect(turnProgressLabel(reading)).toBe("Running");
    expect(turnActivity(reading)).toBe("Thinking");

    const writing = applyAgentEvent(
      applyAgentEvent(reading, { type: "progress", step: 2, total: 3, steps: [...steps] }),
      { type: "tool-use", tool: "Bash", command: "screenshots locale add de --project ./app-store-screenshots.json", path: null },
    );
    expect(turnProgressLabel(writing)).toBe("Running · step 2 of 3");
    expect(turnActivity(writing)).toBe("Changing the project");
    expect(turnActivity({ ...writing, stopped: true })).toBe("Stopping");
    expect(writing.text).toEqual(["I'll add German."]);
    expect(turnOutcome(writing)).toBeNull();
  });
});

describe("turn outcome (mockup 7c)", () => {
  it("names a usage limit and claims an untouched project only when the verdict says so", () => {
    const limit: AgentEvent = { type: "error", code: "usage-limit", message: "limit", resets: "3pm (Europe/Kyiv)" };
    expect(turnOutcome(play(limit, accepted([]), done("failed")))).toEqual({ kind: "limit", resets: "3pm (Europe/Kyiv)", unchanged: true });
    expect(turnOutcome(play(limit, accepted(["hero"]), done("failed")))).toMatchObject({ unchanged: false });
  });

  it("separates rejected, stopped, failed, changed, and unchanged runs", () => {
    const rejected: AgentEvent = { type: "result", status: "rejected", reason: "layouts: Required", changed: false, changedScreens: [], revision: "r1" };
    expect(turnOutcome(play(rejected, done("failed")))).toEqual({ kind: "rejected", reason: "layouts: Required" });

    const stopped = { ...play(accepted(["hero"]), done("cancelled")), stopped: true };
    expect(turnOutcome(stopped)).toEqual({ kind: "stopped", restored: false });
    expect(turnOutcome({ ...stopped, restored: true })).toEqual({ kind: "stopped", restored: true });
    expect(turnOutcome(play(accepted([]), done("cancelled")))).toEqual({ kind: "stopped", restored: true });

    const failed: AgentEvent = { type: "error", code: "not-authorized", message: "Sign in again.", resets: null };
    expect(turnOutcome(play(failed, accepted([]), done("failed")))).toEqual({ kind: "error", message: "Sign in again." });
    expect(turnOutcome(play(accepted(["hero", "save-fast"]), done()))).toEqual({ kind: "changed", count: 2 });
    expect(turnOutcome(play(accepted([]), done()))).toEqual({ kind: "unchanged" });
  });
});

describe("agent notices and picker", () => {
  const codex = agentStatus({ id: "codex", name: "Codex", state: "not-signed-in", authMode: null, models: [], signInCommand: "codex login" });

  it("shows no-agent only when nothing is installed, ignoring agents whose policy forbids probing", () => {
    expect(agentNotice(null, undefined)).toEqual({ kind: "loading" });
    const missing = agentStatus({ installed: false, state: "not-installed", version: null });
    expect(agentNotice([missing, gemini], missing)).toEqual({ kind: "no-agent" });
    expect(agentNotice([agentStatus(), codex, gemini], codex)).toEqual({ kind: "not-signed-in", agent: codex });
    expect(agentNotice([agentStatus(), codex, gemini], agentStatus())).toBeNull();
  });

  it("labels each agent's state and prefers a ready agent", () => {
    expect(agentStateLabel(agentStatus())).toBe("Signed in · subscription · v2.1.296");
    expect(agentStateLabel(agentStatus({ state: "unsupported-version" }))).toBe("Needs v2.1.268 or later");
    expect(agentStateLabel(gemini)).toBe("Unavailable");
    expect(defaultAgentId([codex, agentStatus(), gemini], null)).toBe("claude-code");
    expect(defaultAgentId([codex, agentStatus(), gemini], "codex")).toBe("codex");
    expect(defaultAgentId([gemini], null)).toBeNull();
  });
});

describe("agent policy in the panel", () => {
  const atOwnRisk = { ...policy, level: "at-own-risk", reason: "Terms forbid it.", consequences: "Account ban." } as const;
  const risky = agentStatus({ id: "risky", name: "Risky", policy: atOwnRisk, consented: false });

  it("shows the consent warning before any readiness notice and lets a message through only with consent", () => {
    const signedOut = { ...risky, state: "not-signed-in", authMode: null } as const;
    expect(agentNotice([agentStatus(), risky], risky)).toEqual({ kind: "consent-required", agent: risky });
    expect(agentNotice([agentStatus(), signedOut], signedOut)).toEqual({ kind: "consent-required", agent: signedOut });
    expect(agentCanRun(risky)).toBe(false);

    const consented = { ...risky, consented: true };
    expect(agentNotice([agentStatus(), consented], consented)).toBeNull();
    expect(agentCanRun(consented)).toBe(true);
    expect(agentNotice([agentStatus(), { ...consented, state: "not-signed-in" }], { ...consented, state: "not-signed-in" }))
      .toMatchObject({ kind: "not-signed-in" });
  });

  it("never lets an unavailable agent or an agent without an adapter run, consent or not", () => {
    expect(agentCanRun({ ...gemini, state: "ready" })).toBe(false);
    const noAdapter = { ...risky, state: "no-adapter", installed: null, consented: true } as const;
    expect(agentNotice([agentStatus(), noAdapter], noAdapter)).toEqual({ kind: "no-adapter", agent: noAdapter });
    expect(agentCanRun(noAdapter)).toBe(false);
    expect(agentStateLabel(noAdapter)).toBe("Not supported in the editor yet");
  });

  it("does not select an agent that still needs consent when a supported one exists", () => {
    expect(defaultAgentId([risky, agentStatus()], null)).toBe("claude-code");
    expect(defaultAgentId([{ ...risky, consented: true }, gemini], null)).toBe("risky");
  });
});

describe("changed screens (mockup 7b)", () => {
  it("names each changed screen with its locale and size and lists removed screens last", () => {
    expect(changedScreenRows(sample, ["gone", "save-fast"], DEFAULT_STORE_SPECS)).toEqual([
      { id: "save-fast", name: "Save Fast", detail: expect.stringMatching(/^EN · iPhone/) },
      { id: "gone", name: "Removed screen", detail: null },
    ]);
  });
});
