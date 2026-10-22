// SPDX-License-Identifier: Apache-2.0
import { dirname } from "node:path";
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
import type { AgentAdapter, AgentEvent, AgentStep } from "./agent-session.server.js";

const FAILURE: CliFailure = {
  usageLimit: /(?:hit|reached) your [\w ]*limit|spend limit|usage limit/i,
  notAuthorized: /not logged in|please run \/login|invalid api key|oauth token (?:has )?expired|authentication[_ ](?:error|failed)/i,
  resets: /\bresets? (?:at )?([^\n·]+)/i,
  messages: {
    "usage-limit": "Your Claude subscription usage limit is reached",
    "not-authorized": "Claude Code is not signed in with your subscription. Sign in from Terminal with `claude`",
    failed: "Claude Code stopped with an error",
  },
};

function todoProgress(input: Record<string, unknown>): AgentEvent[] {
  if (!Array.isArray(input.todos)) return [];
  return progressEvent(input.todos.filter(isRecord).map((todo): AgentStep => ({
    label: text(todo.content) ?? "",
    status: todo.status === "completed" || todo.status === "in_progress" ? todo.status : "pending",
  })));
}

function assistantEvents(message: unknown): AgentEvent[] {
  if (!isRecord(message) || !Array.isArray(message.content)) return [];
  return message.content.filter(isRecord).flatMap((block): AgentEvent[] => {
    const value = text(block.text);
    if (block.type === "text") return value ? [{ type: "text", text: value }] : [];
    if (block.type !== "tool_use" || !isRecord(block.input)) return [];
    const tool = text(block.name) ?? "unknown";
    if (tool === "TodoWrite") return todoProgress(block.input);
    return [{
      type: "tool-use",
      tool,
      command: tool === "Bash" ? text(block.input.command) : null,
      path: text(block.input.file_path) ?? text(block.input.path),
    }];
  });
}

function resultEvents(result: Record<string, unknown>): AgentEvent[] {
  const durationMs = typeof result.duration_ms === "number" ? result.duration_ms : null;
  if (result.is_error !== true && result.subtype === "success") {
    return [{ type: "done", status: "completed", summary: summary(text(result.result)), durationMs }];
  }
  return failedRun(FAILURE, text(result.result) ?? "", durationMs);
}

/** Claude Code `-p --output-format stream-json`, restricted per the VTL-29 spike. */
export const claudeCodeAdapter: AgentAdapter = {
  agentId: "claude-code",
  args(request) {
    return [
      "-p",
      "--output-format", "stream-json",
      // Never `--bare`: it ignores the subscription login. `--restricted` drops user/project
      // settings, hooks and MCP, and keeps shell and web tools off unless named in `--tools`.
      "--restricted",
      "--tools", "Bash,Read,Glob,Grep,TodoWrite",
      "--allowedTools", "Bash(screenshots *)", "Read", "Glob", "Grep", "TodoWrite",
      "--disallowedTools", "Bash(screenshots dev *)", "WebSearch", "WebFetch", "mcp__*",
      "--permission-mode", "dontAsk",
      "--permission-prompts", "none",
      "--settings", JSON.stringify({ sandbox: { enabled: true, failIfUnavailable: true } }),
      "--append-system-prompt", projectInstructions(
        request,
        "Plan the work as a short todo list with TodoWrite and keep each item's status current.",
      ),
      // The skill lives outside the project; restricted file tools only read added directories.
      ...(request.context.skillPath ? ["--add-dir", dirname(request.context.skillPath)] : []),
      ...(request.model ? ["--model", request.model] : []),
    ];
  },
  normalizer() {
    return jsonLineNormalizer(
      (message) => {
        if (message.type === "assistant") return assistantEvents(message.message);
        return message.type === "result" ? resultEvents(message) : [];
      },
      (stderr) => failedRun(FAILURE, stderr, null),
    );
  },
};
