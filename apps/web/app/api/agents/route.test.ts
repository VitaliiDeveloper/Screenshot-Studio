// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isOptInFlag, type AgentStatus } from "@web/lib/agents/agent-registry.server.js";
import { handleAgentsGet } from "./handler.js";
import { GET } from "./route.js";

// Fake CLIs reproduce the VTL-29 spike outputs and exit codes. PATH holds only the fake directory,
// so the real `claude` and `codex` binaries can never run from these tests.
const EMAIL = "owner@example.com";
const ORG_ID = "org-7f3c-secret";
const MASKED_KEY = "sk-proj-***9QfZ";
const CLAUDE_SUBSCRIPTION = JSON.stringify({
  loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty",
  email: EMAIL, orgId: ORG_ID, orgName: "Example", subscriptionType: "max",
});
// Synthetic: the spike verified the subscription and signed-out shapes only.
const CLAUDE_API_KEY = JSON.stringify({
  loggedIn: true, authMethod: "api_key", apiProvider: "firstParty", email: EMAIL, orgId: ORG_ID,
});
const CLAUDE_SIGNED_OUT = JSON.stringify({ loggedIn: false, authMethod: "none", apiProvider: "firstParty" });
// Synthetic Commander-style help: `--bare` is opt-in, and the next option carries its own default.
const CLAUDE_HELP = [
  "Usage: claude [options] [command] [prompt]",
  "",
  "Options:",
  "  -p, --print                 Print response and exit (useful for pipes).",
  "  --bare                      Minimal mode: skip hooks, LSP, plugin sync and CLAUDE.md",
  "                              auto-discovery. Anthropic auth is strictly ANTHROPIC_API_KEY.",
  "  --model <model>             Model for the current session (default: from settings)",
].join("\n");

const BASE_ENV = {
  NODE_ENV: "test",
  CLAUDE_CONFIG_DIR: "/claude-config",
  CODEX_HOME: "/codex-home",
  ANTHROPIC_API_KEY: "sk-ant-should-be-stripped",
  CODEX_API_KEY: "sk-codex-should-be-stripped",
  OPENAI_API_KEY: "sk-openai-should-be-stripped",
} satisfies NodeJS.ProcessEnv;

let binDir: string;
const originalPath = process.env.PATH;

beforeEach(async () => {
  binDir = await mkdtemp(join(tmpdir(), "agents-route-"));
});

afterEach(async () => {
  process.env.PATH = originalPath;
  vi.restoreAllMocks();
  await rm(binDir, { recursive: true, force: true });
});

async function writeFake(name: string, body: string): Promise<void> {
  const path = join(binDir, name);
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
}

// A leaked API key, a dropped config-location variable, or a Codex probe without the credentials
// store its runs use all turn the fake away from `ready`.
async function fakeClaude({
  version = "echo '2.1.296 (Claude Code)'",
  auth = `echo '${CLAUDE_SUBSCRIPTION}'`,
  help = CLAUDE_HELP,
} = {}): Promise<void> {
  await writeFile(join(binDir, "claude-help.txt"), help);
  return writeFake("claude", `case "$1" in
  --version) ${version} ;;
  --help) /bin/cat '${join(binDir, "claude-help.txt")}' ;;
  auth)
    if [ -n "$ANTHROPIC_API_KEY" ]; then echo '${CLAUDE_API_KEY}'; exit 0; fi
    if [ "$CLAUDE_CONFIG_DIR" != "/claude-config" ]; then echo '${CLAUDE_SIGNED_OUT}'; exit 1; fi
    ${auth} ;;
esac`);
}

function fakeCodex({
  version = "echo 'codex-cli 0.162.1'",
  auth = "echo 'Logged in using ChatGPT' >&2",
} = {}): Promise<void> {
  return writeFake("codex", `case "$1" in
  --version) ${version} ;;
  login)
    if [ -n "$CODEX_API_KEY$OPENAI_API_KEY" ]; then echo 'Logged in using an API key - ${MASKED_KEY}'; exit 0; fi
    if [ "$CODEX_HOME" != "/codex-home" ]; then echo 'Not logged in' >&2; exit 1; fi
    case "$*" in *'cli_auth_credentials_store="file"'*) ;; *) echo 'Not logged in' >&2; exit 1 ;; esac
    ${auth} ;;
esac`);
}

// The registry caches by sanitized env, and every test has its own fake PATH, so tests never share it.
async function detect(timeoutMs = 5_000): Promise<{ agents: Record<string, AgentStatus>; text: string }> {
  const response = await handleAgentsGet({ env: { ...BASE_ENV, PATH: binDir }, timeoutMs });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const text = await response.text();
  for (const secret of [EMAIL, ORG_ID, MASKED_KEY, "should-be-stripped"]) expect(text).not.toContain(secret);
  const { agents } = JSON.parse(text) as { agents: AgentStatus[] };
  return { agents: Object.fromEntries(agents.map((agent) => [agent.id, agent])), text };
}

async function processGone(pidFile: string): Promise<boolean> {
  const pid = Number((await readFile(pidFile, "utf8")).trim());
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

describe.skipIf(process.platform === "win32")("/api/agents", () => {
  it("reports subscription sign-ins as ready with their policy and never exposes identity or keys", async () => {
    await fakeClaude();
    await fakeCodex();
    const consoleCalls = (["log", "info", "warn", "error", "debug"] as const)
      .map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));

    const { agents } = await detect();

    expect(Object.keys(agents)).toEqual(["claude-code", "codex", "gemini-cli"]);
    expect(agents["claude-code"]).toEqual({
      id: "claude-code", name: "Claude Code", installed: true, version: "2.1.296",
      minVersion: "2.1.268", state: "ready", authMode: "subscription",
      policy: expect.objectContaining({ level: "supported", sourceUrl: expect.stringMatching(/^https:/) }),
      models: ["sonnet", "opus", "haiku"],
      setupUrl: "https://code.claude.com/docs/en/setup", signInCommand: "claude",
    });
    expect(agents.codex).toMatchObject({
      installed: true, version: "0.162.1", minVersion: "0.162.1", state: "ready", authMode: "subscription",
      policy: { level: "supported", checkedAt: "2026-10-15" }, models: [],
    });
    expect(agents["gemini-cli"]).toMatchObject({
      installed: null, version: null, state: "unavailable", authMode: null,
      policy: { level: "unavailable", reason: expect.stringMatching(/individual subscriptions/) },
    });
    expect(JSON.stringify(consoleCalls.map((call) => call.mock.calls))).not.toMatch(/example\.com|org-7f3c/);
  });

  it("reports absent CLIs as not installed instead of failing", async () => {
    const { agents } = await detect();

    expect(agents["claude-code"]).toMatchObject({ installed: false, version: null, state: "not-installed" });
    expect(agents.codex).toMatchObject({ installed: false, version: null, state: "not-installed" });
  });

  it("fails closed below the minimum version or on an unreadable version and names the requirement", async () => {
    await fakeClaude({ version: "echo '2.1.267 (Claude Code)'" });
    await fakeCodex({ version: "echo 'codex-cli'" });

    const { agents } = await detect();

    expect(agents["claude-code"]).toMatchObject({
      installed: true, version: "2.1.267", minVersion: "2.1.268", state: "unsupported-version",
    });
    expect(agents.codex).toMatchObject({ installed: true, version: null, minVersion: "0.162.1", state: "unsupported-version" });
  });

  it("fails closed once a release makes --bare the default, whatever its version", async () => {
    await fakeClaude({
      version: "echo '2.3.0 (Claude Code)'",
      help: `${CLAUDE_HELP}\n  --no-bare                   Use the subscription login in print mode.`,
    });
    await fakeCodex();

    const { agents } = await detect();

    expect(agents["claude-code"]).toMatchObject({ version: "2.3.0", state: "unsupported-version", authMode: null });
    expect(agents.codex).toMatchObject({ state: "ready" });
  });

  it("never reports API-key sign-ins as ready", async () => {
    await fakeClaude({ auth: `echo '${CLAUDE_API_KEY}'` });
    await fakeCodex({ auth: `echo 'Logged in using an API key - ${MASKED_KEY}'` });

    const { agents } = await detect();

    expect(agents["claude-code"]).toMatchObject({ state: "wrong-auth-mode", authMode: "api-key" });
    expect(agents.codex).toMatchObject({ state: "wrong-auth-mode", authMode: "api-key" });
  });

  it("reports signed-out CLIs as not signed in", async () => {
    await fakeClaude({ auth: `echo '${CLAUDE_SIGNED_OUT}'; exit 1` });
    await fakeCodex({ auth: "echo 'Not logged in' >&2; exit 1" });

    const { agents } = await detect();

    expect(agents["claude-code"]).toMatchObject({ installed: true, state: "not-signed-in", authMode: null });
    expect(agents.codex).toMatchObject({ installed: true, state: "not-signed-in", authMode: null });
  });

  it("reports unreadable auth status as not signed in without echoing it", async () => {
    await fakeClaude({ auth: `echo 'Error: ${EMAIL} {'; exit 0` });
    await fakeCodex({ auth: "echo 'Logged in' >&2; exit 2" });

    const { agents } = await detect();

    expect(agents["claude-code"]).toMatchObject({ state: "not-signed-in" });
    expect(agents.codex).toMatchObject({ state: "not-signed-in" });
  });

  it("kills a hung CLI with its child processes at the probe timeout", async () => {
    const claudePid = join(binDir, "claude.pid");
    const codexPid = join(binDir, "codex.pid");
    // No `exec`: the orphaned sleep keeps the output pipe open unless the whole tree is killed.
    await fakeClaude({ version: `/bin/sleep 30 & echo $! > '${claudePid}'; wait` });
    await fakeCodex({ auth: `/bin/sleep 30 & echo $! > '${codexPid}'; wait` });

    const started = Date.now();
    const { agents } = await detect(1_500);

    expect(Date.now() - started).toBeLessThan(10_000);
    expect(agents["claude-code"]).toMatchObject({ installed: true, version: null, state: "unsupported-version" });
    expect(agents.codex).toMatchObject({ installed: true, version: "0.162.1", state: "not-signed-in" });
    expect(await processGone(claudePid)).toBe(true);
    expect(await processGone(codexPid)).toBe(true);
  }, 15_000);

  it("shares one round of probes between concurrent and repeated reads", async () => {
    const count = join(binDir, "claude.count");
    await fakeClaude({ version: `echo x >> '${count}'; echo '2.1.296 (Claude Code)'` });
    await fakeCodex();

    await Promise.all([detect(), detect()]);
    await detect();
    expect((await readFile(count, "utf8")).split("\n").filter(Boolean)).toHaveLength(1);

    await detect(4_000);
    expect((await readFile(count, "utf8")).split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("serves GET from the process environment for loopback hosts only", async () => {
    process.env.PATH = binDir;
    const marker = join(binDir, "spawned");
    await writeFake("claude", `echo spawned > '${marker}'`);

    const rebound = await GET(new Request("http://localhost:3000/api/agents", {
      headers: { host: "rebound.example:3000" },
    }));
    expect(rebound.status).toBe(403);
    expect(await access(marker).then(() => true, () => false)).toBe(false);

    await rm(join(binDir, "claude"));
    const response = await GET(new Request("http://localhost:3000/api/agents", {
      headers: { host: "localhost:3000" },
    }));
    expect(response.status).toBe(200);
    const { agents } = await response.json() as { agents: AgentStatus[] };
    expect(agents.map(({ id, state }) => [id, state])).toEqual([
      ["claude-code", "not-installed"], ["codex", "not-installed"], ["gemini-cli", "unavailable"],
    ]);
  });
});

describe("isOptInFlag", () => {
  const withBare = (description: string) => CLAUDE_HELP.replace(
    / {2}--bare .*\n.*\n/,
    `  --bare                      ${description}\n`,
  );

  it("accepts --bare while help lists it as an opt-in option", () => {
    expect(isOptInFlag(CLAUDE_HELP, "--bare")).toBe(true);
  });

  it("rejects help that drops --bare, negates it, or calls it a default", () => {
    expect(isOptInFlag(CLAUDE_HELP.replace(/ {2}--bare .*\n.*\n/, ""), "--bare")).toBe(false);
    expect(isOptInFlag(`${CLAUDE_HELP}\n  --no-bare  Keep the subscription login`, "--bare")).toBe(false);
    expect(isOptInFlag(withBare("Minimal mode (default: true)"), "--bare")).toBe(false);
    expect(isOptInFlag(withBare("Minimal mode. Default for -p since 2.3."), "--bare")).toBe(false);
  });
});
