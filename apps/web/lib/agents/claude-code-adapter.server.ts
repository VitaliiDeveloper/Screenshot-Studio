// SPDX-License-Identifier: Apache-2.0
import { dirname } from "node:path";
import { isRecord } from "@web/lib/json-guards.js";
import type {
  AgentAdapter,
  AgentErrorCode,
  AgentEvent,
  AgentRunRequest,
  AgentStep,
} from "./agent-session.server.js";

const SUMMARY_LIMIT = 2_000;
const USAGE_LIMIT = /(?:hit|reached) your [\w ]*limit|spend limit|usage limit/i;
const NOT_AUTHORIZED = /not logged in|please run \/login|invalid api key|oauth token (?:has )?expired|authentication[_ ](?:error|failed)/i;
const RESETS = /\bresets? (?:at )?([^\n·]+)/i;

function systemPrompt({ context }: AgentRunRequest): string {
  return [
    "You are editing the Screenshot Studio project in the current working directory.",
    context.agentGuidePath
      ? `Before changing anything, read ${context.agentGuidePath} completely and follow it; it is the authoritative workflow and schema contract.`
      : "Read app-store-screenshots.json before changing anything; it is a strict schema.",
    context.skillPath ? `The Screenshot Studio skill is at ${context.skillPath}.` : "",
    "Change the project only through the `screenshots` CLI with `--project ./app-store-screenshots.json`. Never run `screenshots dev`.",
    "Plan the work as a short todo list with TodoWrite and keep each item's status current.",
  ].filter(Boolean).join("\n");
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

type CliErrorCode = Exclude<AgentErrorCode, "timeout">;

function failure(message: string): { code: CliErrorCode; resets: string | null } {
  if (USAGE_LIMIT.test(message)) return { code: "usage-limit", resets: RESETS.exec(message)?.[1]?.trim() ?? null };
  if (NOT_AUTHORIZED.test(message)) return { code: "not-authorized", resets: null };
  return { code: "failed", resets: null };
}

const ERROR_MESSAGES: Record<CliErrorCode, string> = {
  "usage-limit": "Your Claude subscription usage limit is reached",
  "not-authorized": "Claude Code is not signed in with your subscription. Sign in from Terminal with `claude`",
  failed: "Claude Code stopped with an error",
};

function errorEvent(code: CliErrorCode, resets: string | null, detail?: string | null): AgentEvent {
  return {
    type: "error",
    code,
    message: code === "failed" && detail ? detail.slice(0, SUMMARY_LIMIT) : ERROR_MESSAGES[code],
    resets,
  };
}

function progressEvent(input: Record<string, unknown>): AgentEvent[] {
  if (!Array.isArray(input.todos)) return [];
  const steps: AgentStep[] = input.todos.filter(isRecord).map((todo) => ({
    label: text(todo.content) ?? "",
    status: todo.status === "completed" || todo.status === "in_progress" ? todo.status : "pending",
  }));
  if (steps.length === 0) return [];
  const current = steps.findIndex((step) => step.status === "in_progress");
  const completed = steps.filter((step) => step.status === "completed").length;
  const step = current >= 0 ? current + 1 : Math.min(completed + 1, steps.length);
  return [{ type: "progress", step, total: steps.length, steps }];
}

function assistantEvents(message: unknown): AgentEvent[] {
  if (!isRecord(message) || !Array.isArray(message.content)) return [];
  return message.content.filter(isRecord).flatMap((block): AgentEvent[] => {
    const value = text(block.text);
    if (block.type === "text") return value ? [{ type: "text", text: value }] : [];
    if (block.type !== "tool_use" || !isRecord(block.input)) return [];
    const tool = text(block.name) ?? "unknown";
    if (tool === "TodoWrite") return progressEvent(block.input);
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
  const summary = text(result.result);
  if (result.is_error !== true && result.subtype === "success") {
    return [{ type: "done", status: "completed", summary: summary?.slice(0, SUMMARY_LIMIT) ?? null, durationMs }];
  }
  const { code, resets } = failure(summary ?? "");
  return [errorEvent(code, resets, summary), { type: "done", status: "failed", summary: null, durationMs }];
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
      "--append-system-prompt", systemPrompt(request),
      // The skill lives outside the project; restricted file tools only read added directories.
      ...(request.context.skillPath ? ["--add-dir", dirname(request.context.skillPath)] : []),
      ...(request.model ? ["--model", request.model] : []),
    ];
  },
  normalizer() {
    let finished = false;
    return {
      line(line) {
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch {
          return [];
        }
        if (!isRecord(message) || finished) return [];
        if (message.type === "assistant") return assistantEvents(message.message);
        if (message.type !== "result") return [];
        finished = true;
        return resultEvents(message);
      },
      // stderr is only classified, never forwarded: it may hold paths, tokens or account details.
      end({ stderr }) {
        if (finished) return [];
        const { code, resets } = failure(stderr);
        return [errorEvent(code, resets), { type: "done", status: "failed", summary: null, durationMs: null }];
      },
    };
  },
};
