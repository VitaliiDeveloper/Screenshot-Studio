// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import type { AgentEvent, AgentRunRequest } from "./agent-session.server.js";
import { codexAdapter, tomlString } from "./codex-adapter.server.js";

// Fixtures follow ThreadEvent in codex-rs/exec/src/exec_events.rs at tag rust-v0.163.0; error texts
// come from codex-rs/protocol/src/error.rs and codex-rs/login/src/auth/manager.rs at that tag.
async function normalize(fixture: string, exit = { code: 0, stderr: "" }): Promise<AgentEvent[]> {
  const output = await readFile(new URL(`./fixtures/${fixture}`, import.meta.url), "utf8");
  const normalizer = codexAdapter.normalizer();
  return [...output.split("\n").flatMap((line) => normalizer.line(line)), ...normalizer.end(exit)];
}

const REQUEST: AgentRunRequest = {
  message: "Add German",
  model: null,
  effort: null,
  context: { agentGuidePath: "/project/AGENTS.md", bundledGuidePath: null, skillPath: "/app/skills/screenshot-studio/SKILL.md", codexAuthStore: "keyring" },
  attachments: [],
};

describe("Codex adapter", () => {
  it("normalizes messages, commands and the plan into one completed run", async () => {
    const steps = (done: number) => ["Read project", "Add locale DE", "Validate project"].map((label, index) => ({
      label, status: index < done ? "completed" : "pending",
    }));
    expect(await normalize("codex-stream-success.ndjson")).toEqual([
      { type: "progress", step: 2, total: 3, steps: steps(1) },
      { type: "text", text: "I'll add German to the project." },
      {
        type: "tool-use", tool: "command_execution", path: null,
        command: "/bin/zsh -lc 'screenshots locale add de --from en --project ./app-store-screenshots.json'",
      },
      { type: "progress", step: 3, total: 3, steps: steps(2) },
      { type: "text", text: "Added DE to 4 screens." },
      { type: "progress", step: 3, total: 3, steps: steps(2) },
      { type: "done", status: "completed", summary: "Added DE to 4 screens.", durationMs: null },
    ]);
  });

  it("reports direct file edits by path", () => {
    expect(codexAdapter.normalizer().line(JSON.stringify({
      type: "item.completed",
      item: { id: "item_9", type: "file_change", changes: [{ path: "/project/app-store-screenshots.json", kind: "update" }], status: "completed" },
    }))).toEqual([{ type: "tool-use", tool: "file_change", command: null, path: "/project/app-store-screenshots.json" }]);
  });

  it("reads the reset time of a usage limit and classifies a failed turn or exit by the last error", async () => {
    expect((await normalize("codex-stream-usage-limit.ndjson"))[0])
      .toMatchObject({ type: "error", code: "usage-limit", resets: "3:15 PM" });

    const quota = JSON.stringify({ type: "error", message: "Quota exceeded. Check your plan and billing details." });
    const failed = [
      { type: "error", code: "usage-limit", message: expect.any(String), resets: null },
      { type: "done", status: "failed", summary: null, durationMs: null },
    ];
    const turnFailed = codexAdapter.normalizer();
    turnFailed.line(quota);
    expect(turnFailed.line(JSON.stringify({ type: "turn.failed" }))).toEqual(failed);
    const exited = codexAdapter.normalizer();
    exited.line(quota);
    expect(exited.end({ code: 1, stderr: "" })).toEqual(failed);
    expect(codexAdapter.normalizer().end({ code: 1, stderr: "Error: ChatGPT login is required" }))
      .toMatchObject([{ type: "error", code: "not-authorized" }, { type: "done", status: "failed" }]);
  });

  it("reports a plan without Codex as a failure that names the plan, not a usage limit", () => {
    expect(codexAdapter.normalizer().line(JSON.stringify({
      type: "turn.failed",
      error: { message: "To use Codex with your ChatGPT plan, upgrade to Plus: https://chatgpt.com/explore/plus." },
    }))).toEqual([
      { type: "error", code: "failed", message: expect.stringMatching(/plan does not include Codex/), resets: null },
      { type: "done", status: "failed", summary: null, durationMs: null },
    ]);
    expect(codexAdapter.normalizer().end({
      code: 1, stderr: "You\u2019ve hit your usage limit. Upgrade to Plus to continue using Codex (https://chatgpt.com/explore/plus), or try again later.",
    })[0]).toMatchObject({ code: "usage-limit" });
  });

  it("escapes the instructions as a TOML basic string", () => {
    expect(tomlString("a\u007fb\uD800c\uDC00d\uD83D\uDE00\n\""))
      .toBe('"a\\u007Fb\uFFFDc\uFFFDd\uD83D\uDE00\\n\\""');
  });

  it("keeps the sandbox and approvals non-interactive and reads the message from stdin", () => {
    const args = codexAdapter.args(REQUEST);
    const value = (flag: string) => args[args.indexOf(flag) + 1];
    const overrides = args.filter((_, index) => args[index - 1] === "-c");

    expect(args.slice(0, 2)).toEqual(["exec", "--json"]);
    expect(value("--sandbox")).toBe("workspace-write");
    expect(args).toEqual(expect.arrayContaining(["--ignore-user-config", "--ignore-rules", "--skip-git-repo-check"]));
    expect(args.join(" ")).not.toMatch(/dangerously|danger-full-access|--add-dir|--yolo/);
    expect(args).not.toContain(REQUEST.message);
    expect(overrides).toEqual(expect.arrayContaining([
      'approval_policy="never"', 'web_search="disabled"', 'cli_auth_credentials_store="keyring"',
    ]));
    expect(args.filter((_, index) => args[index - 1] === "--disable"))
      .toEqual(expect.arrayContaining(["apps", "plugins", "browser_use", "computer_use", "multi_agent", "hooks"]));
    const instructions = overrides.find((override) => override.startsWith("developer_instructions="));
    expect(JSON.parse(instructions!.slice("developer_instructions=".length))).toContain("/project/AGENTS.md");
    expect(args.at(-1)).toBe("-");
  });

  it("attaches each image with its own --image flag and keeps the stdin marker last", () => {
    const files = ["/tmp/runs/1/run-a/1.png", "/tmp/runs/1/run-a/2.webp"];
    const args = codexAdapter.args({ ...REQUEST, attachments: files });

    expect(args.filter((_, index) => args[index - 1] === "--image")).toEqual(files);
    expect(args.at(-1)).toBe("-");
    expect(args[args.lastIndexOf("--image") + 2]).toMatch(/^--/);
    expect(args).not.toContain("--add-dir");
    // `--image` shows the pixels but not the path that `asset import` needs.
    const instructions = args.find((arg) => arg.startsWith("developer_instructions="))!;
    expect(JSON.parse(instructions.slice("developer_instructions=".length)))
      .toContain(`${files.join("\n")}\nThey are reference context.`);
    expect(codexAdapter.args(REQUEST)).not.toContain("--image");
    expect(codexAdapter.args(REQUEST).join(" ")).not.toContain("asset import");
  });
});
