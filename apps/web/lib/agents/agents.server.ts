// SPDX-License-Identifier: Apache-2.0
import { spawn, type ChildProcess } from "node:child_process";
import { errorCode } from "@screenshot-studio/core/storage";

/** VTL-51 policy levels: `at-own-risk` needs stored consent, `unavailable` never runs. */
export type AgentPolicyLevel = "supported" | "at-own-risk" | "unavailable";

export interface AgentPolicy {
  level: AgentPolicyLevel;
  reason: string;
  consequences: string;
  sourceUrl: string;
  /** ISO date on which the policy was last verified against `sourceUrl`. */
  checkedAt: string;
}

export interface AgentDefinition {
  id: string;
  name: string;
  binary: string;
  /** Lowest verified version; detection reports `unsupported-version` below it. */
  minVersion?: string;
  /**
   * A flag that `--help` must still list as opt-in. Claude Code docs announce that a future release
   * makes `-p` default to `--bare`, which ignores the subscription; detection reports
   * `unsupported-version` once help shows the flag as a default, adds `--no-bare`, or drops it.
   */
  optInFlag?: string;
  /** Arguments of the CLI's own auth-status command; it never reads credential files itself. */
  authStatusArgs?: readonly string[];
  /** Model aliases the CLI accepts; empty means the CLI's own default model. */
  models: readonly string[];
  policy: AgentPolicy;
}

// Static by design (VTL-30/VTL-51): no remote config. Sources and dates follow the VTL-29 spike.
export const AGENT_DEFINITIONS: readonly AgentDefinition[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    binary: "claude",
    minVersion: "2.1.268",
    optInFlag: "--bare",
    authStatusArgs: ["auth", "status"],
    // Family aliases always resolve to the CLI's current model, so no model version is pinned here.
    models: ["sonnet", "opus", "haiku"],
    policy: {
      level: "supported",
      reason: "Runs the official Claude Code CLI that you installed and signed in to with your own Claude subscription.",
      consequences: "Runs count toward your Claude plan's usage limits.",
      sourceUrl: "https://code.claude.com/docs/en/legal-and-compliance",
      checkedAt: "2026-10-15",
    },
  },
  {
    id: "codex",
    name: "Codex",
    binary: "codex",
    minVersion: "0.162.1",
    authStatusArgs: ["login", "status"],
    // Codex has no stable model aliases and no model-list command; models were withdrawn before.
    models: [],
    policy: {
      level: "supported",
      reason: "Runs the official Codex CLI that you installed and signed in to with ChatGPT; local open-source apps may use it.",
      consequences: "Runs count toward your ChatGPT plan's Codex usage limits.",
      sourceUrl: "https://learn.chatgpt.com/codex/app-server",
      checkedAt: "2026-10-15",
    },
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    binary: "gemini",
    models: [],
    policy: {
      level: "unavailable",
      reason: "Since 18 June 2026 Gemini CLI no longer serves individual subscriptions (free, Google AI Pro, Ultra).",
      consequences: "Screenshot Studio cannot start Gemini CLI.",
      sourceUrl: "https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli",
      checkedAt: "2026-10-15",
    },
  },
];

const PASSTHROUGH_ENV = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TEMP", "TMP", "LANG", "LANGUAGE", "TERM", "TZ",
  "CLAUDE_CONFIG_DIR", "CODEX_HOME",
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR",
  "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA",
  "HOMEDRIVE", "HOMEPATH",
]);
const PASSTHROUGH_PREFIXES = ["LC_", "XDG_"];

/**
 * The only environment an agent CLI ever sees. An allowlist, because any API key or provider switch
 * (`ANTHROPIC_API_KEY`, `CODEX_API_KEY`, `CLAUDE_CODE_USE_BEDROCK`, ...) silently moves the CLI off
 * the user's subscription, and the server environment may hold unrelated secrets.
 */
export function agentEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([name, value]) => {
    const key = name.toUpperCase();
    return value !== undefined
      && (PASSTHROUGH_ENV.has(key) || PASSTHROUGH_PREFIXES.some((prefix) => key.startsWith(prefix)));
  })) as NodeJS.ProcessEnv;
}

export interface AgentSpawnOptions {
  env: NodeJS.ProcessEnv;
  cwd?: string;
  /** Written to stdin, so user text never becomes an argv token the CLI could parse as a flag. */
  input?: string;
}

/** Spawns an agent CLI without a shell, as its own process group so the whole tree can be killed. */
export function spawnAgentProcess(
  binary: string,
  args: readonly string[],
  options: AgentSpawnOptions,
): ChildProcess {
  // shortcut: no shell, so Windows npm `.cmd` shims are not resolved and read as not-installed;
  // add a PATHEXT resolver when Windows agent runs are supported.
  const child = spawn(binary, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  // A CLI that exits before reading stdin raises EPIPE here; its exit is reported by the child.
  child.stdin?.on("error", () => undefined).end(options.input);
  return child;
}

/** Kills the child and everything it started; a tree that already exited is not an error. */
export function killProcessTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
      .on("error", () => child.kill("SIGKILL"));
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    // macOS reports EPERM, not ESRCH, for a group whose only member is an unreaped zombie.
    if (errorCode(error) !== "ESRCH" && errorCode(error) !== "EPERM") throw error;
  }
}

export type AgentProbeResult =
  | { kind: "missing" }
  | { kind: "timeout" }
  | { kind: "failed" }
  | { kind: "exited"; code: number | null; stdout: string; stderr: string };

const PROBE_OUTPUT_LIMIT = 64 * 1024;

/** Runs a short status command; resolves on timeout without waiting for orphaned output pipes. */
export function runAgentProbe(
  binary: string,
  args: readonly string[],
  options: AgentSpawnOptions & { timeoutMs: number },
): Promise<AgentProbeResult> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnAgentProcess(binary, args, options);
    } catch {
      resolve({ kind: "failed" });
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(0, PROBE_OUTPUT_LIMIT);
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(0, PROBE_OUTPUT_LIMIT);
    });
    const timer = setTimeout(() => {
      killProcessTree(child);
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve({ kind: "timeout" });
    }, options.timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve(errorCode(error) === "ENOENT" ? { kind: "missing" } : { kind: "failed" });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ kind: "exited", code, stdout, stderr });
    });
  });
}
