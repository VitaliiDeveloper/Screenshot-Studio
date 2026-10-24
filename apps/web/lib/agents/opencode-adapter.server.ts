// SPDX-License-Identifier: Apache-2.0
import { isRecord } from "@web/lib/json-guards.js";
import {
  failedRun,
  jsonLineNormalizer,
  progressEvent,
  projectInstructions,
  summary,
  text,
  type CliFailure,
} from "./agent-adapter.server.js";
import { OPENCODE_GO_MODELS } from "./agents.server.js";
import type { AgentAdapter, AgentEvent, AgentStep } from "./agent-session.server.js";

// Provisional: OpenCode documents neither text; patterns follow its provider-auth and Go limit wording.
const FAILURE: CliFailure = {
  usageLimit: /usage limit|rate limit|limit (?:reached|exceeded)/i,
  notAuthorized: /provider ?auth|api key|unauthori[sz]ed|\b401\b|auth login/i,
  resets: /\b(?:resets?|try again) (?:at |in |on )?([^.\n]+)/i,
  messages: {
    "usage-limit": "Your OpenCode Go usage limit is reached",
    "not-authorized": "OpenCode is not connected to OpenCode Go. Sign in from Terminal with `opencode auth login`",
    failed: "OpenCode stopped with an error",
  },
};

// The last matching rule wins, so the bash rules go from broad to narrow.
const PERMISSION = {
  edit: "deny",
  bash: { "*": "deny", "screenshots *": "allow", "screenshots dev*": "deny" },
  webfetch: "deny",
  websearch: "deny",
  external_directory: "deny",
  // Sub-agents are off for every other adapter too.
  task: "deny",
};

function part(event: Record<string, unknown>): Record<string, unknown> {
  return isRecord(event.part) ? event.part : {};
}

function todoProgress(input: Record<string, unknown>): AgentEvent[] {
  if (!Array.isArray(input.todos)) return [];
  return progressEvent(input.todos.filter(isRecord).map((todo): AgentStep => ({
    label: text(todo.content) ?? "",
    status: todo.status === "completed" || todo.status === "in_progress" ? todo.status : "pending",
  })));
}

// Tool parts are printed once finished, so a tool is reported after it ran.
function toolEvents(tool: Record<string, unknown>): AgentEvent[] {
  const name = text(tool.tool) ?? "unknown";
  const state = isRecord(tool.state) ? tool.state : {};
  const input = isRecord(state.input) ? state.input : {};
  if (name === "todowrite") return todoProgress(input);
  return [{ type: "tool-use", tool: name, command: text(input.command), path: text(input.filePath) ?? text(input.path) }];
}

function errorMessage(error: unknown): string | null {
  if (!isRecord(error)) return text(error);
  return text(error.message) ?? (isRecord(error.data) ? text(error.data.message) : null);
}

/** OpenCode 2 `run --format json` on an OpenCode Go model, restricted per the VTL-29 spike. */
export const opencodeAdapter: AgentAdapter = {
  agentId: "opencode",
  args(request) {
    return [
      "run",
      "--format", "json",
      // No `--dir`: the run's cwd is the project folder. Never `--auto`: it approves permission asks.
      "--pure",
      // Never the CLI default model, which may be a Zen model billed per request.
      "--model", request.model ?? OPENCODE_GO_MODELS[0]!.id,
      ...request.attachments.flatMap((file) => ["--file", file]),
    ];
  },
  input(request) {
    // `run` reads piped stdin as the message, which keeps the user's text out of argv and `ps`.
    // The skill lives outside the project, where `external_directory` is denied.
    return [
      projectInstructions(
        { ...request, context: { ...request.context, skillPath: null } },
        "Plan the work as a short todo list with the todowrite tool and keep each item's status current.",
      ),
      "",
      "The user's request:",
      request.message,
    ].join("\n");
  },
  env() {
    return {
      OPENCODE_PERMISSION: JSON.stringify(PERMISSION),
      // Otherwise the user's ~/.claude/CLAUDE.md is loaded when no AGENTS.md is found.
      OPENCODE_DISABLE_CLAUDE_CODE: "1",
    };
  },
  normalizer() {
    let lastMessage: string | null = null;
    // An `error` line precedes a failing exit; the exit stays the end of a run without a final step.
    let lastError = "";
    return jsonLineNormalizer(
      (event) => {
        if (event.type === "error") lastError = errorMessage(event.error) ?? lastError;
        if (event.type === "tool_use") return toolEvents(part(event));
        if (event.type === "step_finish") {
          return part(event).reason === "stop"
            ? [{ type: "done", status: "completed", summary: summary(lastMessage), durationMs: null }]
            : [];
        }
        if (event.type !== "text") return [];
        const value = text(part(event).text);
        if (!value) return [];
        lastMessage = value;
        return [{ type: "text", text: value }];
      },
      (stderr, code) => (code === 0 && !lastError
        ? [{ type: "done", status: "completed", summary: summary(lastMessage), durationMs: null }]
        : failedRun(FAILURE, `${lastError}\n${stderr}`, null)),
    );
  },
};
