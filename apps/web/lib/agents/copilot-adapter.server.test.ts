// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import type { AgentEvent, AgentRunRequest } from "./agent-session.server.js";
import { copilotAdapter } from "./copilot-adapter.server.js";

// Provisional fixtures: event names follow a community report on 1.0.83, not a local run.
async function normalize(fixture: string, exit = { code: 0, stderr: "" }): Promise<AgentEvent[]> {
  const output = await readFile(new URL(`./fixtures/${fixture}`, import.meta.url), "utf8");
  const normalizer = copilotAdapter.normalizer();
  return [...output.split("\n").flatMap((line) => normalizer.line(line)), ...normalizer.end(exit)];
}

const REQUEST: AgentRunRequest = {
  message: "--allow-all Add German",
  model: null,
  effort: null,
  context: { agentGuidePath: "/project/AGENTS.md", skillPath: "/app/skills/screenshot-studio/SKILL.md", codexAuthStore: null },
  attachments: [],
};

describe("Copilot adapter", () => {
  it("restricts tools and never passes an approve-all flag or the user's text in argv", () => {
    const args = copilotAdapter.args({ ...REQUEST, attachments: ["/tmp/run-1/image-1.png"] });

    expect(args).toEqual(expect.arrayContaining([
      "--output-format", "json", "--no-ask-user", "--available-tools=bash,view,glob,grep",
      "--allow-tool=shell(screenshots:*)", "--deny-tool=shell(screenshots dev)", "--deny-tool=shell(screenshots dev:*)",
      "--disable-builtin-mcps", "--disallow-temp-dir", "--no-remote", "--no-remote-export", "--no-auto-update",
      "--sandbox", "--no-custom-instructions",
      "--add-dir=/app/skills/screenshot-studio", "--add-dir=/tmp/run-1",
    ]));
    expect(args.some((arg) => /allow-all|yolo|trust-folder|^-p$|^--prompt/.test(arg))).toBe(false);
    expect(args.join(" ")).not.toContain("Add German");
    expect(args.some((arg) => arg.startsWith("--model"))).toBe(false);
    expect(copilotAdapter.args({ ...REQUEST, model: "auto" })).toContain("--model=auto");
  });

  it("sends the project instructions and the request on stdin and points skills at their parent folder", () => {
    const input = copilotAdapter.input!(REQUEST);

    expect(input).toContain("read /project/AGENTS.md completely");
    expect(input).toMatch(/Never run `screenshots dev`/);
    expect(input.endsWith("The user's request:\n--allow-all Add German")).toBe(true);
    expect(copilotAdapter.env!(REQUEST)).toEqual({ COPILOT_SKILLS_DIRS: "/app/skills" });
    expect(copilotAdapter.env!({ ...REQUEST, context: { ...REQUEST.context, skillPath: null } })).toEqual({});
  });

  it("completes on the result with the last message and the session duration", async () => {
    expect(await normalize("copilot-stream-success.ndjson")).toEqual([
      { type: "text", text: "I'll add German to the project." },
      {
        type: "tool-use", tool: "bash", path: null,
        command: "screenshots locale add de --from en --project ./app-store-screenshots.json",
      },
      { type: "text", text: "Added DE to 4 screens." },
      { type: "done", status: "completed", summary: "Added DE to 4 screens.", durationMs: 11278 },
    ]);
  });

  it("fails a run that warned on stderr that it could not sandbox", async () => {
    const events = await normalize("copilot-stream-success.ndjson", {
      code: 0, stderr: "Warning: sandbox is not available on this platform; continuing without it\n",
    });

    expect(events.slice(-2)).toEqual([
      { type: "error", code: "failed", message: expect.stringMatching(/without its sandbox/), resets: null },
      { type: "done", status: "failed", summary: null, durationMs: 11278 },
    ]);
  });

  it("classifies sign-in and limit errors printed only on stderr", () => {
    const signedOut = copilotAdapter.normalizer().end({ code: 1, stderr: "Error: No authentication information found.\n" });
    expect(signedOut[0]).toMatchObject({ code: "not-authorized", message: expect.stringMatching(/sign in/i) });

    const weekly = copilotAdapter.normalizer().end({
      code: 1,
      stderr: "You've reached your weekly rate limit. Please wait for your limit to reset on April 20, 2026 at 2:00 AM or switch to auto model to continue.",
    });
    expect(weekly[0]).toMatchObject({ code: "usage-limit", resets: "April 20, 2026 at 2:00 AM" });
  });

  it("reads the reset time of a rate limit", async () => {
    expect((await normalize("copilot-stream-usage-limit.ndjson", { code: 1, stderr: "" }))[0])
      .toMatchObject({ type: "error", code: "usage-limit", resets: "2 hours" });
  });
});
