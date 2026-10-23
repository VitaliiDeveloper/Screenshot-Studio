// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import type { AgentEvent, AgentRunRequest } from "./agent-session.server.js";
import { claudeCodeAdapter } from "./claude-code-adapter.server.js";

// Synthetic stream-json fixtures built from the documented Claude Code shapes (VTL-29 spike); the
// exact usage-limit and not-authorized payloads are still unverified against a real run.
async function normalize(fixture: string, exit = { code: 0, stderr: "" }): Promise<AgentEvent[]> {
  const output = await readFile(new URL(`./fixtures/${fixture}`, import.meta.url), "utf8");
  const normalizer = claudeCodeAdapter.normalizer();
  return [...output.split("\n").flatMap((line) => normalizer.line(line)), ...normalizer.end(exit)];
}

const REQUEST: AgentRunRequest = {
  message: "Add German",
  model: "sonnet",
  context: { agentGuidePath: "/project/AGENTS.md", skillPath: "/app/skills/screenshot-studio/SKILL.md", codexAuthStore: null },
  attachments: [],
};

describe("Claude Code adapter", () => {
  it("normalizes text, CLI commands and step progress into one completed run", async () => {
    expect(await normalize("claude-stream-success.ndjson")).toEqual([
      { type: "text", text: "I'll add German to the project." },
      {
        type: "progress", step: 2, total: 3,
        steps: [
          { label: "Read project", status: "completed" },
          { label: "Add locale DE", status: "in_progress" },
          { label: "Validate project", status: "pending" },
        ],
      },
      {
        type: "tool-use", tool: "Bash", path: null,
        command: "screenshots locale add de --from en --project ./app-store-screenshots.json",
      },
      { type: "tool-use", tool: "Read", command: null, path: "/project/AGENTS.md" },
      { type: "done", status: "completed", summary: "Added DE to 4 screens.", durationMs: 100000 },
    ]);
  });

  it("reports usage limits and lost sign-in as typed states", async () => {
    expect(await normalize("claude-stream-usage-limit.ndjson")).toEqual([
      { type: "error", code: "usage-limit", message: expect.any(String), resets: "3pm (Europe/Kyiv)" },
      { type: "done", status: "failed", summary: null, durationMs: 2400 },
    ]);
    expect(await normalize("claude-stream-not-authorized.ndjson")).toEqual([
      { type: "error", code: "not-authorized", message: expect.stringMatching(/sign in/i), resets: null },
      { type: "done", status: "failed", summary: null, durationMs: 300 },
    ]);
  });

  it("classifies failures from stderr or the result but never forwards their text", async () => {
    const normalizer = claudeCodeAdapter.normalizer();
    const crash = normalizer.end({ code: 1, stderr: "Error: EACCES /Users/owner/secret-path token=abc" });
    expect(crash).toEqual([
      { type: "error", code: "failed", message: "Claude Code stopped with an error", resets: null },
      { type: "done", status: "failed", summary: null, durationMs: null },
    ]);
    expect(claudeCodeAdapter.normalizer().end({ code: 1, stderr: "You've hit your weekly limit · resets Mon 9am" }))
      .toMatchObject([{ type: "error", code: "usage-limit", resets: "Mon 9am" }, { type: "done" }]);

    const failedResult = claudeCodeAdapter.normalizer().line(JSON.stringify({
      type: "result", subtype: "error_during_execution", is_error: true, duration_ms: 5,
      result: "EACCES: permission denied, open '/Users/owner/Library/secret.json'",
    }));
    expect(failedResult[0]).toEqual({
      type: "error", code: "failed", message: "Claude Code stopped with an error", resets: null,
    });
    expect(JSON.stringify(failedResult)).not.toContain("/Users/owner");
  });

  it("restricts the CLI and never passes --bare or the user message as argv", () => {
    const args = claudeCodeAdapter.args(REQUEST);

    expect(args).not.toContain("--bare");
    expect(args).not.toContain(REQUEST.message);
    expect(args).toEqual(expect.arrayContaining(["-p", "--restricted", "--permission-prompts", "none"]));
    expect(args.slice(args.indexOf("--permission-mode"), args.indexOf("--permission-mode") + 2))
      .toEqual(["--permission-mode", "dontAsk"]);
    expect(args.slice(args.indexOf("--output-format"), args.indexOf("--output-format") + 2))
      .toEqual(["--output-format", "stream-json"]);
    const disallowed = args.slice(args.indexOf("--disallowedTools") + 1, args.indexOf("--permission-mode"));
    expect(disallowed).toEqual(expect.arrayContaining(["WebSearch", "WebFetch", "mcp__*", "Bash(screenshots dev *)"]));
    expect(JSON.parse(args[args.indexOf("--settings") + 1] ?? "")).toEqual({
      sandbox: { enabled: true, failIfUnavailable: true },
    });
    expect(args[args.indexOf("--append-system-prompt") + 1]).toContain("/project/AGENTS.md");
    expect(args.slice(-4)).toEqual(["--add-dir", "/app/skills/screenshot-studio", "--model", "sonnet"]);
  });

  it("adds the run folder and lists the images in the prompt, not in the user message", () => {
    const args = claudeCodeAdapter.args({ ...REQUEST, attachments: ["/tmp/runs/1/run-a/1.png", "/tmp/runs/1/run-a/2.jpg"] });

    expect(args.filter((_, index) => args[index - 1] === "--add-dir"))
      .toEqual(["/app/skills/screenshot-studio", "/tmp/runs/1/run-a"]);
    const prompt = args[args.indexOf("--append-system-prompt") + 1];
    expect(prompt).toContain("/tmp/runs/1/run-a/1.png\n/tmp/runs/1/run-a/2.jpg");
    expect(args).not.toContain(REQUEST.message);
    expect(claudeCodeAdapter.args(REQUEST).join(" ")).not.toContain("run-a");
  });
});
