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
import type { AgentAdapter, AgentEvent, AgentStep } from "./agent-session.server.js";
import { codexAuthStoreOverride } from "./codex-auth-store.server.js";

// Wording from codex-rs: usage limits in protocol/src/error.rs, sign-in loss in
// login/src/auth/manager.rs (refresh-token failures) and HTTP 401s.
const FAILURE: CliFailure = {
  usageLimit: /hit your (?:usage limit|spend cap)|out of credits|quota exceeded/i,
  notAuthorized: /access token could not be refreshed|sign in again|\b401 unauthorized\b|login is required|not logged in/i,
  resets: /\btry again at ([^.\n]+)/i,
  messages: {
    "usage-limit": "Your ChatGPT plan's Codex usage limit is reached",
    "not-authorized": "Codex is not signed in with your ChatGPT subscription. Sign in from Terminal with `codex login`",
    failed: "Codex stopped with an error",
  },
  // UsageNotIncluded: the sign-in works, but the plan has no Codex, so no limit will reset.
  explained: [{
    pattern: /to use codex with your chatgpt plan/i,
    message: "Your ChatGPT plan does not include Codex. Upgrade the plan to use Codex",
  }],
};

// Default-on features whose tools reach past the shell, patch and plan tools: connectors, plugins,
// browsers, computer use, image generation, memories, sub-agents and tool installs.
const DISABLED_FEATURES = [
  "apps", "plugins", "remote_plugin", "browser_use", "browser_use_external", "in_app_browser",
  "computer_use", "image_generation", "memories", "multi_agent", "tool_suggest", "hooks",
  "skill_mcp_dependency_install",
];
// Item types that start when the agent invokes a tool (exec_events.rs).
const TOOL_ITEMS = new Set(["command_execution", "mcp_tool_call", "collab_tool_call", "web_search"]);
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * A TOML basic string, so `-c` never falls back to the raw literal. JSON escapes are TOML escapes,
 * except that TOML rejects a raw U+007F and escaped lone surrogates.
 */
export function tomlString(value: string): string {
  return JSON.stringify(value.replace(LONE_SURROGATE, "\uFFFD")).replaceAll("\u007f", "\\u007F");
}

function itemEvents(event: unknown, item: Record<string, unknown>): AgentEvent[] {
  if (item.type === "todo_list") {
    if (!Array.isArray(item.items)) return [];
    return progressEvent(item.items.filter(isRecord).map((todo): AgentStep => ({
      label: text(todo.text) ?? "",
      status: todo.completed === true ? "completed" : "pending",
    })));
  }
  if (event === "item.started" && TOOL_ITEMS.has(String(item.type))) {
    return [{ type: "tool-use", tool: String(item.type), command: text(item.command), path: null }];
  }
  if (event !== "item.completed") return [];
  if (item.type === "agent_message") {
    const value = text(item.text);
    return value ? [{ type: "text", text: value }] : [];
  }
  // A patch has no started item; it is reported once applied.
  if (item.type !== "file_change" || !Array.isArray(item.changes)) return [];
  return item.changes.filter(isRecord).map((change): AgentEvent => ({
    type: "tool-use", tool: "file_change", command: null, path: text(change.path),
  }));
}

/** Codex `exec --json` (ThreadEvent JSONL) in the workspace-write sandbox of the project folder. */
export const codexAdapter: AgentAdapter = {
  agentId: "codex",
  args(request) {
    return [
      "exec",
      "--json",
      // Writes only to the project folder and temp directories, without network. Never
      // `--dangerously-bypass-approvals-and-sandbox`, and no `--add-dir`: it adds writable roots,
      // while the sandbox already reads the skill.
      "--sandbox", "workspace-write",
      // Drops $CODEX_HOME/config.toml (MCP servers, hooks, project trust) and the execpolicy rules
      // whose `allow` decisions run commands outside the sandbox. Auth still comes from CODEX_HOME.
      "--ignore-user-config",
      "--ignore-rules",
      // Project folders are rarely Git checkouts; the run snapshot and Undo run stand in for Git.
      "--skip-git-repo-check",
      "-c", 'approval_policy="never"',
      "-c", 'web_search="disabled"',
      ...codexAuthStoreOverride(request.context.codexAuthStore ?? "file"),
      "-c", "tools.update_plan.enabled=true",
      ...DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
      "-c", `developer_instructions=${tomlString(projectInstructions(
        request,
        "Plan the work as a short checklist with the update_plan tool and keep each step's status current.",
      ))}`,
      ...(request.model ? ["--model", request.model] : []),
      "-",
    ];
  },
  normalizer() {
    let lastMessage: string | null = null;
    // `error` events also announce retries, so only a turn's end or the exit is terminal.
    let lastError = "";
    return jsonLineNormalizer(
      (event) => {
        if (event.type === "error") lastError = text(event.message) ?? lastError;
        if (event.type === "turn.completed") {
          return [{ type: "done", status: "completed", summary: summary(lastMessage), durationMs: null }];
        }
        if (event.type === "turn.failed") {
          return failedRun(FAILURE, (isRecord(event.error) ? text(event.error.message) : null) ?? lastError, null);
        }
        if (!isRecord(event.item)) return [];
        if (event.type === "item.completed" && event.item.type === "agent_message") {
          lastMessage = text(event.item.text) ?? lastMessage;
        }
        return itemEvents(event.type, event.item);
      },
      (stderr) => failedRun(FAILURE, `${lastError}\n${stderr}`, null),
    );
  },
};
