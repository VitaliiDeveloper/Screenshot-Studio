// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import type { AgentAdapter, AgentEvent } from "./agent-session.server.js";
import { claudeCodeAdapter } from "./claude-code-adapter.server.js";
import { codexAdapter } from "./codex-adapter.server.js";
import { copilotAdapter } from "./copilot-adapter.server.js";
import { opencodeAdapter } from "./opencode-adapter.server.js";

interface Scenario {
  scenario: string;
  /** Fixture kind, read as each adapter's own `fixtures/<prefix>-<kind>` file. */
  fixture?: "success" | "usage-limit" | "not-authorized";
  lines?: string[];
  exit: { code: number | null; stderr: string };
  check(events: AgentEvent[], adapter: AdapterCase): void;
}

interface AdapterCase {
  adapter: AgentAdapter;
  fixture: (kind: string) => string;
  /** False for a CLI whose allowed tools include no plan tool. */
  progress: boolean;
}

const ADAPTERS: AdapterCase[] = [
  { adapter: claudeCodeAdapter, fixture: (kind) => `claude-stream-${kind}.ndjson`, progress: true },
  { adapter: codexAdapter, fixture: (kind) => `codex-stream-${kind}.ndjson`, progress: true },
  // Provisional: Copilot and OpenCode fixtures are built from docs, source and user reports, not
  // captured from local runs; replace them with real output before relying on these adapters.
  { adapter: copilotAdapter, fixture: (kind) => `copilot-stream-${kind}.ndjson`, progress: false },
  { adapter: opencodeAdapter, fixture: (kind) => `opencode-stream-${kind}.ndjson`, progress: true },
];

const SECRET_STDERR = "Error: EACCES /Users/owner/secret-path token=abc";
const doneEvents = (events: AgentEvent[]) => events.filter(({ type }) => type === "done");

// Every adapter must end every run with exactly one `done`, keep CLI failure text out of the
// stream, and type limits and lost sign-in the same way; tool names and durations stay per CLI.
const SCENARIOS: Scenario[] = [
  {
    scenario: "a successful run streams text, progress and the CLI command, then completes",
    fixture: "success",
    exit: { code: 0, stderr: "" },
    check(events, { progress }) {
      const types = events.map(({ type }) => type);
      expect(types).toEqual(expect.arrayContaining(["text", "tool-use"]));
      expect(types.includes("progress")).toBe(progress);
      expect(events).toContainEqual(expect.objectContaining({
        type: "tool-use", command: expect.stringContaining("screenshots locale add de"),
      }));
      expect(events.some(({ type }) => type === "error")).toBe(false);
      expect(events.at(-1)).toMatchObject({ type: "done", status: "completed", summary: "Added DE to 4 screens." });
    },
  },
  {
    scenario: "a usage limit is a typed error with its reset time",
    fixture: "usage-limit",
    exit: { code: 1, stderr: "" },
    check(events) {
      expect(events).toEqual([
        { type: "error", code: "usage-limit", message: expect.stringMatching(/usage limit/i), resets: expect.any(String) },
        expect.objectContaining({ type: "done", status: "failed", summary: null }),
      ]);
    },
  },
  {
    scenario: "lost sign-in is a typed error that says how to sign in",
    fixture: "not-authorized",
    exit: { code: 1, stderr: "" },
    check(events) {
      expect(events).toEqual([
        { type: "error", code: "not-authorized", message: expect.stringMatching(/sign in/i), resets: null },
        expect.objectContaining({ type: "done", status: "failed", summary: null }),
      ]);
    },
  },
  {
    scenario: "an exit before the end of the run fails without forwarding stderr",
    exit: { code: 1, stderr: SECRET_STDERR },
    check(events) {
      expect(events).toEqual([
        { type: "error", code: "failed", message: expect.any(String), resets: null },
        { type: "done", status: "failed", summary: null, durationMs: null },
      ]);
      expect(JSON.stringify(events)).not.toContain("/Users/owner");
    },
  },
  {
    scenario: "malformed lines are skipped and do not end the run",
    lines: ["not a json line", "{", "[]", "null", "42", '"text"'],
    exit: { code: null, stderr: "" },
    check(events) {
      expect(events).toEqual([
        expect.objectContaining({ type: "error", code: "failed" }),
        expect.objectContaining({ type: "done", status: "failed" }),
      ]);
    },
  },
  {
    scenario: "output and exit after the end of the run are ignored",
    fixture: "success",
    lines: ["{}"],
    exit: { code: 1, stderr: "late failure" },
    check(events) {
      expect(doneEvents(events)).toEqual([expect.objectContaining({ status: "completed" })]);
      expect(events.some(({ type }) => type === "error")).toBe(false);
    },
  },
];

describe.each(ADAPTERS)("$adapter.agentId adapter contract", (adapterCase) => {
  const { adapter, fixture } = adapterCase;
  it.each(SCENARIOS)("$scenario", async ({ fixture: kind, lines = [], exit, check }) => {
    const output = kind ? await readFile(new URL(`./fixtures/${fixture(kind)}`, import.meta.url), "utf8") : "";
    const normalizer = adapter.normalizer();
    const events = [...[...output.split("\n"), ...lines].flatMap((line) => normalizer.line(line)), ...normalizer.end(exit)];

    check(events, adapterCase);
    expect(doneEvents(events)).toHaveLength(1);
  });
});
