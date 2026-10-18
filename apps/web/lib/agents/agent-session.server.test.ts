// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_DEFINITIONS, type AgentDefinition } from "./agents.server.js";
import {
  AgentRunError,
  cancelAgentRun,
  startAgentRun,
  type AgentEvent,
  type AgentRun,
} from "./agent-session.server.js";

// The fake `claude` answers the registry probes like a signed-in subscription and, for `-p`, records
// its argv, cwd, env and stdin before running the scenario. PATH holds only the fake directory.
const SUCCESS_FIXTURE = fileURLToPath(new URL("./fixtures/claude-stream-success.ndjson", import.meta.url));

let root: string;
let binDir: string;
let projectDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "agent-session-"));
  binDir = join(root, "bin");
  projectDir = join(root, "project");
  await mkdir(binDir);
  await mkdir(projectDir);
  await writeFile(join(projectDir, "AGENTS.md"), "# Project guide\n");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeFake(name: string, body: string): Promise<void> {
  const path = join(binDir, name);
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
}

function fakeClaude(
  scenario: string,
  auth = `echo '{"loggedIn":true,"authMethod":"claude.ai"}'`,
  version = "echo '2.1.296 (Claude Code)'",
): Promise<void> {
  return writeFake("claude", `case "$1" in
  --version) ${version} ;;
  --help) echo '  --bare    Minimal mode' ;;
  auth) ${auth} ;;
  *)
    printf '%s\\n' "$@" > '${root}/argv'
    pwd -P > '${root}/cwd'
    /usr/bin/env > '${root}/env'
    /bin/cat > '${root}/stdin'
    ${scenario} ;;
esac`);
}

// No `exec`: the orphaned sleep only dies if the whole process group is killed.
function hang(): string {
  return `/bin/sleep 30 & echo $! > '${root}/sleep.pid'; wait`;
}

function start(overrides: Partial<Parameters<typeof startAgentRun>[0]> = {}): Promise<AgentRun> {
  return startAgentRun({
    agentId: "claude-code",
    projectDir,
    message: "--bare Add German",
    model: "sonnet",
    env: { PATH: binDir, ANTHROPIC_API_KEY: "sk-ant-should-be-stripped", HOME: root },
    ...overrides,
  });
}

async function collect(run: AgentRun): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  const reader = run.events.getReader();
  for (let next = await reader.read(); !next.done; next = await reader.read()) events.push(next.value);
  return events;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

async function processGone(pidFile: string): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await exists(pidFile)) {
      try {
        process.kill(Number((await readFile(pidFile, "utf8")).trim()), 0);
      } catch {
        return true;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function rejection(promise: Promise<unknown>): Promise<AgentRunError> {
  const error = await promise.then(() => undefined, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(AgentRunError);
  return error as AgentRunError;
}

describe.skipIf(process.platform === "win32")("agent session runner", () => {
  it("runs in the project folder with a sanitized env, the message on stdin, and streams events", async () => {
    await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`);

    const events = await collect(await start());

    expect(events.map(({ type }) => type)).toEqual(["text", "progress", "tool-use", "tool-use", "done"]);
    expect(events.at(-1)).toMatchObject({ type: "done", status: "completed" });
    expect(await readFile(join(root, "cwd"), "utf8")).toBe(`${await realpath(projectDir)}\n`);
    expect(await readFile(join(root, "stdin"), "utf8")).toBe("--bare Add German");
    const argv = (await readFile(join(root, "argv"), "utf8")).split("\n");
    expect(argv).not.toContain("--bare");
    expect(argv).toEqual(expect.arrayContaining(["-p", "--restricted", "--model", "sonnet"]));
    expect(argv.join("\n")).toContain(join(await realpath(projectDir), "AGENTS.md"));
    const env = await readFile(join(root, "env"), "utf8");
    expect(env).not.toContain("ANTHROPIC_API_KEY");
    expect(env).toContain(`HOME=${root}`);
  });

  it("allows one run per project and kills the whole process tree on cancel", async () => {
    await fakeClaude(hang());
    const run = await start();

    expect(await rejection(start())).toMatchObject({ status: 409, code: "agent-busy" });
    await expect.poll(() => exists(join(root, "sleep.pid")), { timeout: 5_000 }).toBe(true);
    expect(await cancelAgentRun(projectDir)).toBe(true);

    expect(await collect(run)).toEqual([{ type: "done", status: "cancelled", summary: null, durationMs: null }]);
    expect(await processGone(join(root, "sleep.pid"))).toBe(true);
    expect(await cancelAgentRun(projectDir)).toBe(false);
    await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`);
    expect((await collect(await start())).at(-1)).toMatchObject({ status: "completed" });
  }, 20_000);

  it("never launches a run cancelled during its readiness check", async () => {
    await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`, undefined, "/bin/sleep 1; echo '2.1.296 (Claude Code)'");
    const pending = start();

    await expect.poll(() => cancelAgentRun(projectDir), { timeout: 5_000 }).toBe(true);

    expect(await collect(await pending)).toEqual([{ type: "done", status: "cancelled", summary: null, durationMs: null }]);
    expect(await exists(join(root, "argv"))).toBe(false);
    expect(await cancelAgentRun(projectDir)).toBe(false);
  }, 20_000);

  it("stops a run when the event stream is abandoned", async () => {
    await fakeClaude(hang());
    const run = await start();
    await expect.poll(() => exists(join(root, "sleep.pid")), { timeout: 5_000 }).toBe(true);

    await run.events.cancel();

    expect(await processGone(join(root, "sleep.pid"))).toBe(true);
    expect(await cancelAgentRun(projectDir)).toBe(false);
  }, 20_000);

  it("times out a run as a typed error and kills it", async () => {
    await fakeClaude(hang());

    const events = await collect(await start({ timeoutMs: 1_000 }));

    expect(events).toEqual([
      { type: "error", code: "timeout", message: expect.any(String), resets: null },
      { type: "done", status: "failed", summary: null, durationMs: null },
    ]);
    expect(await processGone(join(root, "sleep.pid"))).toBe(true);
  }, 20_000);

  it("never runs unavailable or unconsented at-own-risk agents", async () => {
    const marker = join(root, "spawned");
    await writeFake("gemini", `echo spawned > '${marker}'`);
    await writeFake("risky", `echo spawned > '${marker}'`);
    const risky: AgentDefinition = {
      id: "risky", name: "Risky", binary: "risky", models: [],
      policy: { ...AGENT_DEFINITIONS[0]!.policy, level: "at-own-risk" },
    };

    expect(await rejection(start({ agentId: "gemini-cli", model: null })))
      .toMatchObject({ status: 403, code: "unavailable" });
    expect(await rejection(start({ agentId: "risky", model: null, definitions: [risky] })))
      .toMatchObject({ status: 403, code: "consent-required" });
    expect(await exists(marker)).toBe(false);
  });

  it("refuses agents that are not ready, unknown models, and agents without an adapter", async () => {
    await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`, `echo '{"loggedIn":false}'; exit 1`);

    expect(await rejection(start())).toMatchObject({ status: 409, code: "not-signed-in" });
    expect(await rejection(start({ model: "gpt-4" }))).toMatchObject({ status: 400, code: "unknown-model" });
    expect(await rejection(start({ agentId: "codex", model: null }))).toMatchObject({ status: 409, code: "no-adapter" });
    expect(await exists(join(root, "argv"))).toBe(false);
  });
});
