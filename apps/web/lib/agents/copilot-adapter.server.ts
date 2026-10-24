// SPDX-License-Identifier: Apache-2.0
import { dirname } from "node:path";
import { isRecord } from "@web/lib/json-guards.js";
import {
  failedRun,
  jsonLineNormalizer,
  projectInstructions,
  summary,
  text,
  type CliFailure,
} from "./agent-adapter.server.js";
import type { AgentAdapter, AgentEvent } from "./agent-session.server.js";

// Provisional: wording from GitHub docs and user reports (copilot-cli #2336, #2828, vscode #341833),
// not yet seen in a local run.
const FAILURE: CliFailure = {
  usageLimit: /hit a rate limit|reached your (?:\w+ )?(?:rate|credit|usage) limit/i,
  notAuthorized: /no authentication information found|authentication failed/i,
  resets: /\b(?:try again in|reset on) ([^\n]+?)(?:\.(?:\s|$)| or switch|$)/im,
  messages: {
    "usage-limit": "Your Copilot plan's usage limit is reached",
    "not-authorized": "GitHub Copilot CLI is not signed in. Sign in from Terminal with `copilot`, then `/login`",
    failed: "GitHub Copilot CLI stopped with an error",
  },
  // `--sandbox` only warns on a host it cannot sandbox; such a run went unsandboxed.
  explained: [{
    pattern: /sandbox[^\n]*(?:unavailable|not available|not supported|disabled)/i,
    message: "GitHub Copilot CLI ran without its sandbox on this computer. Review its changes or use Undo run",
  }],
};

function data(event: Record<string, unknown>): Record<string, unknown> {
  return isRecord(event.data) ? event.data : {};
}

function toolEvent(event: Record<string, unknown>): AgentEvent[] {
  const { toolName, arguments: input } = data(event);
  const args = isRecord(input) ? input : {};
  return [{ type: "tool-use", tool: text(toolName) ?? "unknown", command: text(args.command), path: text(args.path) }];
}

/**
 * Copilot prompt mode with `--output-format json`, restricted per the VTL-29 spike. It has no
 * system-prompt flag and no plan tool among the allowed ones, so the instructions lead the prompt
 * on stdin and the run reports no progress.
 */
export const copilotAdapter: AgentAdapter = {
  agentId: "copilot",
  args(request) {
    return [
      "--output-format", "json",
      "--no-ask-user",
      // Without create/edit/apply_patch, web or sub-agent tools; the project changes only through the CLI.
      "--available-tools=bash,view,glob,grep",
      "--allow-tool=shell(screenshots:*)",
      "--deny-tool=shell(screenshots dev)",
      "--deny-tool=shell(screenshots dev:*)",
      // The built-in GitHub MCP server acts as the user's GitHub account.
      "--disable-builtin-mcps",
      "--disallow-temp-dir",
      "--no-remote",
      "--no-remote-export",
      "--no-auto-update",
      "--sandbox",
      // Drops the user's global instructions too; the project guide is named in the prompt instead.
      "--no-custom-instructions",
      // Never `--allow-all*`, `--yolo` or `--trust-folder`.
      ...(request.context.skillPath ? [`--add-dir=${dirname(request.context.skillPath)}`] : []),
      ...(request.attachments[0] ? [`--add-dir=${dirname(request.attachments[0])}`] : []),
      ...(request.model ? [`--model=${request.model}`] : []),
    ];
  },
  input(request) {
    return [
      projectInstructions(request, ""),
      ...(request.attachments.length > 0 ? ["View the attached images with the view tool."] : []),
      "",
      "The user's request:",
      request.message,
    ].join("\n");
  },
  env(request): Record<string, string> {
    // Skills load from directories that contain skill folders, so this is the parent of the skill's own.
    return request.context.skillPath
      ? { COPILOT_SKILLS_DIRS: dirname(dirname(request.context.skillPath)) }
      : {};
  },
  normalizer() {
    let lastMessage: string | null = null;
    let lastError = "";
    let result: Record<string, unknown> | null = null;
    // `done` waits for the exit, because the sandbox warning only arrives on stderr.
    return jsonLineNormalizer(
      (event) => {
        if (result) return [];
        if (event.type === "result") {
          result = event;
          return [];
        }
        if (event.type === "session.error") lastError = text(data(event).message) ?? lastError;
        if (event.type === "tool.execution_start") return toolEvent(event);
        if (event.type !== "assistant.message") return [];
        const content = text(data(event).content);
        if (!content) return [];
        lastMessage = content;
        return [{ type: "text", text: content }];
      },
      (stderr) => {
        const usage = isRecord(result?.usage) ? result.usage : {};
        const durationMs = typeof usage.sessionDurationMs === "number" ? usage.sessionDurationMs : null;
        const sandboxed = !FAILURE.explained?.some(({ pattern }) => pattern.test(stderr));
        if (result?.exitCode === 0 && sandboxed) {
          return [{ type: "done", status: "completed", summary: summary(lastMessage), durationMs }];
        }
        return failedRun(FAILURE, `${lastError}\n${stderr}`, durationMs);
      },
    );
  },
};
