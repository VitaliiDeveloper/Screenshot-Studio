// SPDX-License-Identifier: Apache-2.0
import { isRecord } from "@web/lib/json-guards.js";
import {
  AGENT_DEFINITIONS,
  agentEnv,
  runAgentProbe,
  type AgentChoice,
  type AgentDefinition,
  type AgentPolicy,
  type AgentProbeResult,
} from "./agents.server.js";
import { agentAdapter } from "./agent-adapters.server.js";
import { codexAuthStoreOverride, readCodexAuthStore, type CodexAuthStore } from "./codex-auth-store.server.js";

/** Usage limits are not a registry state: only a real run can observe them (VTL-31). */
export type AgentState =
  | "not-installed"
  | "unsupported-version"
  | "not-signed-in"
  | "wrong-auth-mode"
  | "unavailable"
  /** Listed with its policy, but the editor has no adapter to run it, so its binary is never probed. */
  | "no-adapter"
  | "ready";

export type AgentAuthMode = "subscription" | "api-key";

export interface AgentStatus {
  id: string;
  name: string;
  /** `null` when the policy forbids running the agent, so its binary is never probed. */
  installed: boolean | null;
  version: string | null;
  minVersion: string | null;
  state: AgentState;
  authMode: AgentAuthMode | null;
  policy: AgentPolicy;
  /** Whether stored consent covers the current policy; null unless the level is `at-own-risk`. */
  consented: boolean | null;
  models: AgentChoice[];
  efforts: AgentChoice[];
  defaultEffort: string | null;
  setupUrl: string | null;
  signInCommand: string | null;
}

export interface AgentRegistryOptions {
  /** Source environment; it is always reduced by `agentEnv` before a probe runs. */
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** The store a Codex run will use; read from the probe environment when omitted. */
  codexAuthStore?: CodexAuthStore | null;
}

const DEFAULT_PROBE_TIMEOUT_MS = 5_000;
const STATUS_TTL_MS = 5_000;

type AuthReading = Pick<AgentStatus, "state" | "authMode">;

const READY: AuthReading = { state: "ready", authMode: "subscription" };
const WRONG_AUTH_MODE: AuthReading = { state: "wrong-auth-mode", authMode: "api-key" };
const NOT_SIGNED_IN: AuthReading = { state: "not-signed-in", authMode: null };

export function parseVersion(output: string): string | null {
  return /\d+\.\d+\.\d+/.exec(output)?.[0] ?? null;
}

export function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function isSupportedVersion(version: string, definition: AgentDefinition): boolean {
  return definition.minVersion === undefined || compareVersions(version, definition.minVersion) >= 0;
}

function optionFlags(line: string): string[] {
  return /^\s*(-\S*(?:,\s*-\S*)*)/.exec(line)?.[1]?.split(/,\s*/) ?? [];
}

/**
 * True while `--help` still lists `flag` as an opt-in option: present, without a `--no-` negation,
 * and not described as a default. Wording is heuristic; a missed flip still cannot bill an API key
 * because the agent env carries none, so such a run fails to authenticate instead.
 */
export function isOptInFlag(help: string, flag: string): boolean {
  const lines = help.split("\n");
  const start = lines.findIndex((line) => optionFlags(line).includes(flag));
  const negated = flag.replace(/^--/, "--no-");
  if (start < 0 || lines.some((line) => optionFlags(line).includes(negated))) return false;
  const next = lines.findIndex((line, index) => index > start && optionFlags(line).length > 0);
  const description = lines.slice(start, next < 0 ? undefined : next).join(" ");
  return !/\(default\b|\bdefault (?:for|in|with|when) (?:-p\b|--print|print|non-interactive|headless)/i
    .test(description);
}

// Reads only `loggedIn` and `authMethod`; the JSON also carries email and orgId, which must never leave.
function readClaudeAuth(result: AgentProbeResult): AuthReading {
  if (result.kind !== "exited") return NOT_SIGNED_IN;
  let status: unknown;
  try {
    status = JSON.parse(result.stdout);
  } catch {
    return NOT_SIGNED_IN;
  }
  if (result.code !== 0 || !isRecord(status) || status.loggedIn !== true) return NOT_SIGNED_IN;
  return status.authMethod === "claude.ai" ? READY : WRONG_AUTH_MODE;
}

// The API-key status line includes a masked key, so only the matched mode is returned.
function readCodexAuth(result: AgentProbeResult): AuthReading {
  if (result.kind !== "exited") return NOT_SIGNED_IN;
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.code !== 0 || /not logged in/i.test(output)) return NOT_SIGNED_IN;
  return /logged in using chatgpt/i.test(output) ? READY : WRONG_AUTH_MODE;
}

function readAuth(definition: AgentDefinition, result: AgentProbeResult): AuthReading {
  if (definition.id === "claude-code") return readClaudeAuth(result);
  if (definition.id === "codex") return readCodexAuth(result);
  return NOT_SIGNED_IN;
}

// Codex probes sign-in from the store its runs use; an `ephemeral` store has nothing to share.
async function authProbeArgs(
  definition: AgentDefinition,
  env: NodeJS.ProcessEnv,
  options: AgentRegistryOptions,
): Promise<string[] | null> {
  if (definition.authStatusArgs === undefined) return null;
  if (definition.id !== "codex") return [...definition.authStatusArgs];
  const store = options.codexAuthStore === undefined ? await readCodexAuthStore(env) : options.codexAuthStore;
  return store === null ? null : [...definition.authStatusArgs, ...codexAuthStoreOverride(store)];
}

/** Detects one agent; every probe failure fails closed to a non-ready state instead of throwing. */
export async function detectAgent(
  definition: AgentDefinition,
  options: AgentRegistryOptions = {},
): Promise<AgentStatus> {
  const status: AgentStatus = {
    id: definition.id,
    name: definition.name,
    installed: null,
    version: null,
    minVersion: definition.minVersion ?? null,
    state: "unavailable",
    authMode: null,
    policy: definition.policy,
    consented: null,
    models: [...definition.models],
    efforts: [...definition.efforts],
    defaultEffort: definition.defaultEffort ?? null,
    setupUrl: definition.setupUrl ?? null,
    signInCommand: definition.signInCommand ?? null,
  };
  if (definition.policy.level === "unavailable") return status;
  if (!agentAdapter(definition.id)) return { ...status, state: "no-adapter" };

  const probe = { env: agentEnv(options.env), timeoutMs: options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS };
  const versionResult = await runAgentProbe(definition.binary, ["--version"], probe);
  if (versionResult.kind === "missing") return { ...status, installed: false, state: "not-installed" };

  const version = versionResult.kind === "exited" && versionResult.code === 0
    ? parseVersion(versionResult.stdout)
    : null;
  const unsupported: AgentStatus = { ...status, installed: true, version, state: "unsupported-version" };
  if (version === null || !isSupportedVersion(version, definition)) return unsupported;

  const { optInFlag } = definition;
  const authArgs = await authProbeArgs(definition, probe.env, options);
  const [flagStaysOptIn, authResult] = await Promise.all([
    optInFlag === undefined || runAgentProbe(definition.binary, ["--help"], probe).then((help) => (
      help.kind === "exited" && help.code === 0 && isOptInFlag(help.stdout, optInFlag)
    )),
    authArgs === null ? { kind: "failed" as const } : runAgentProbe(definition.binary, authArgs, probe),
  ]);
  if (!flagStaysOptIn) return unsupported;
  return { ...status, installed: true, version, ...readAuth(definition, authResult) };
}

let statusCache: { key: string; promise: Promise<AgentStatus[]>; expiresAt: number } | undefined;

/**
 * Concurrent and repeated reads within a few seconds share one round of probes, so a polling
 * client cannot respawn the CLIs on every request. Runs re-check with `detectAgent` directly.
 */
export function listAgentStatuses(options: AgentRegistryOptions = {}): Promise<AgentStatus[]> {
  const key = JSON.stringify([agentEnv(options.env), options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS]);
  if (statusCache?.key === key && Date.now() < statusCache.expiresAt) return statusCache.promise;
  const entry = {
    key,
    promise: Promise.all(AGENT_DEFINITIONS.map((definition) => detectAgent(definition, options))),
    expiresAt: Number.POSITIVE_INFINITY,
  };
  const expire = () => {
    entry.expiresAt = Date.now() + STATUS_TTL_MS;
  };
  entry.promise.then(expire, expire);
  statusCache = entry;
  return entry.promise;
}
