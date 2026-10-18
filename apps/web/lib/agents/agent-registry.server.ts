// SPDX-License-Identifier: Apache-2.0
import { isRecord } from "@web/lib/json-guards.js";
import {
  AGENT_DEFINITIONS,
  agentEnv,
  runAgentProbe,
  type AgentDefinition,
  type AgentPolicy,
  type AgentProbeResult,
} from "./agents.server.js";

/** Usage limits are not a registry state: only a real run can observe them (VTL-31). */
export type AgentState =
  | "not-installed"
  | "unsupported-version"
  | "not-signed-in"
  | "wrong-auth-mode"
  | "unavailable"
  | "ready";

export type AgentAuthMode = "subscription" | "api-key";

export interface AgentStatus {
  id: string;
  name: string;
  /** `null` when the policy forbids running the agent, so its binary is never probed. */
  installed: boolean | null;
  version: string | null;
  minVersion: string | null;
  maxVersionExclusive: string | null;
  state: AgentState;
  authMode: AgentAuthMode | null;
  policy: AgentPolicy;
  models: string[];
}

export interface AgentRegistryOptions {
  /** Source environment; it is always reduced by `agentEnv` before a probe runs. */
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

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
  return (definition.minVersion === undefined || compareVersions(version, definition.minVersion) >= 0)
    && (definition.maxVersionExclusive === undefined
      || compareVersions(version, definition.maxVersionExclusive) < 0);
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
    maxVersionExclusive: definition.maxVersionExclusive ?? null,
    state: "unavailable",
    authMode: null,
    policy: definition.policy,
    models: [...definition.models],
  };
  if (definition.policy.level === "unavailable") return status;

  const probe = { env: agentEnv(options.env), timeoutMs: options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS };
  const versionResult = await runAgentProbe(definition.binary, ["--version"], probe);
  if (versionResult.kind === "missing") return { ...status, installed: false, state: "not-installed" };

  const version = versionResult.kind === "exited" && versionResult.code === 0
    ? parseVersion(versionResult.stdout)
    : null;
  if (version === null || !isSupportedVersion(version, definition)) {
    return { ...status, installed: true, version, state: "unsupported-version" };
  }
  const authResult = definition.authStatusArgs === undefined
    ? { kind: "failed" as const }
    : await runAgentProbe(definition.binary, definition.authStatusArgs, probe);
  return { ...status, installed: true, version, ...readAuth(definition, authResult) };
}

export function listAgentStatuses(options: AgentRegistryOptions = {}): Promise<AgentStatus[]> {
  return Promise.all(AGENT_DEFINITIONS.map((definition) => detectAgent(definition, options)));
}
