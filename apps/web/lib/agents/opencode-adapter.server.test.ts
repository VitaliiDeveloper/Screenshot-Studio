// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import type { AgentEvent, AgentRunRequest } from "./agent-session.server.js";
import { opencodeAdapter } from "./opencode-adapter.server.js";

// Provisional fixtures: line shapes follow packages/cli/src/run/noninteractive.ts on OpenCode `dev`,
// tool inputs and the final step reason are not yet confirmed by a local run.
async function normalize(fixture: string, exit = { code: 0, stderr: "" }): Promise<AgentEvent[]> {
  const output = await readFile(new URL(`./fixtures/${fixture}`, import.meta.url), "utf8");
  const normalizer = opencodeAdapter.normalizer();
  return [...output.split("\n").flatMap((line) => normalizer.line(line)), ...normalizer.end(exit)];
}

const REQUEST: AgentRunRequest = {
  message: "--auto Add German",
  model: null,
  effort: null,
  context: { agentGuidePath: "/project/AGENTS.md", skillPath: "/app/skills/screenshot-studio/SKILL.md", codexAuthStore: null },
  attachments: [],
};

describe("OpenCode adapter", () => {
  it("always names a Go model and keeps the user's text out of argv", () => {
    const args = opencodeAdapter.args({ ...REQUEST, attachments: ["/tmp/run-1/image-1.png"] });

    expect(args).toEqual([
      "run", "--format", "json", "--pure", "--model", "opencode-go/kimi-k3", "--file", "/tmp/run-1/image-1.png",
    ]);
    expect(opencodeAdapter.args({ ...REQUEST, model: "opencode-go/glm-5.3" })).toContain("opencode-go/glm-5.3");
  });

  it("sends instructions and the request on stdin without the unreachable skill path", () => {
    const input = opencodeAdapter.input!(REQUEST);

    expect(input).toContain("read /project/AGENTS.md completely");
    expect(input).toContain("todowrite");
    expect(input).not.toContain("SKILL.md");
    expect(input.endsWith("The user's request:\n--auto Add German")).toBe(true);
  });

  it("denies edits, web, other folders and sub-agents and allows only the screenshots CLI, last rule winning", () => {
    const env = opencodeAdapter.env!(REQUEST);
    const permission = JSON.parse(env.OPENCODE_PERMISSION!) as Record<string, unknown>;

    expect(permission).toEqual({
      edit: "deny",
      bash: { "*": "deny", "screenshots *": "allow", "screenshots dev*": "deny" },
      webfetch: "deny",
      websearch: "deny",
      external_directory: "deny",
      task: "deny",
    });
    expect(Object.keys(permission.bash as object)).toEqual(["*", "screenshots *", "screenshots dev*"]);
    expect(env.OPENCODE_DISABLE_CLAUDE_CODE).toBe("1");
  });

  it("normalizes text, todos and tools and completes on the final step", async () => {
    expect(await normalize("opencode-stream-success.ndjson")).toEqual([
      {
        type: "progress", step: 2, total: 3,
        steps: [
          { label: "Read project", status: "completed" },
          { label: "Add locale DE", status: "in_progress" },
          { label: "Validate project", status: "pending" },
        ],
      },
      { type: "text", text: "I'll add German to the project." },
      {
        type: "tool-use", tool: "bash", path: null,
        command: "screenshots locale add de --from en --project ./app-store-screenshots.json",
      },
      { type: "text", text: "Added DE to 4 screens." },
      { type: "done", status: "completed", summary: "Added DE to 4 screens.", durationMs: null },
    ]);
  });

  it("ends by exit code when no final step arrives", () => {
    const text = JSON.stringify({ type: "text", part: { type: "text", text: "Done." } });
    const clean = opencodeAdapter.normalizer();
    clean.line(text);
    expect(clean.end({ code: 0, stderr: "" })).toEqual([
      { type: "done", status: "completed", summary: "Done.", durationMs: null },
    ]);

    const errored = opencodeAdapter.normalizer();
    errored.line(JSON.stringify({ type: "error", error: { type: "unknown", message: "Model not found" } }));
    expect(errored.end({ code: 0, stderr: "" })).toEqual([
      { type: "error", code: "failed", message: "OpenCode stopped with an error", resets: null },
      { type: "done", status: "failed", summary: null, durationMs: null },
    ]);
  });

  it("reads the reset time of a Go usage limit", async () => {
    expect((await normalize("opencode-stream-usage-limit.ndjson", { code: 1, stderr: "" }))[0])
      .toMatchObject({ type: "error", code: "usage-limit", resets: "2 hours" });
  });
});
