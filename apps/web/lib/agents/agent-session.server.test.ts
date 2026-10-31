// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { access, chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseProject } from "@screenshot-studio/core/model";
import { projectRevision } from "@screenshot-studio/core/storage";
import { createAgentConsentStore, sharedAgentConsentStore } from "./agent-consent.server.js";
import { attachmentRoot } from "./agent-attachment-store.server.js";
import type { AgentAttachment } from "./agent-attachments.js";
import { AGENT_DEFINITIONS, type AgentDefinition } from "./agents.server.js";
import {
  AgentRunError,
  beginEditorWrite,
  cancelAgentRun,
  keepAgentOutcome,
  pendingAgentOutcome,
  startAgentRun,
  undoAgentOutcome,
  type AgentEvent,
  type AgentRun,
} from "./agent-session.server.js";

const PROJECT = {
  meta: { name: "Agents", schemaVersion: 1 },
  fonts: [],
  preferredExportLayoutId: "primary",
  layouts: [{
    id: "primary", name: "Primary", mode: "isolated",
    screens: [{
      id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
      artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#000000" }, elements: [],
    }],
  }],
};
const CHANGED_PROJECT = { ...PROJECT, meta: { ...PROJECT.meta, name: "Agents DE" } };
const NO_OTHER_FILES = { files: [], count: 0 };
const ACCEPTED = {
  type: "result", status: "accepted", reason: null, changed: false, changedScreens: [], revision: expect.any(String),
  otherFiles: NO_OTHER_FILES,
};

// The fake `claude` answers the registry probes like a signed-in subscription and, for `-p`, records
// its argv, cwd, env and stdin before running the scenario. PATH holds only the fake directory.
const SUCCESS_FIXTURE = fileURLToPath(new URL("./fixtures/claude-stream-success.ndjson", import.meta.url));
const CODEX_SUCCESS_FIXTURE = fileURLToPath(new URL("./fixtures/codex-stream-success.ndjson", import.meta.url));
const OPENCODE_SUCCESS_FIXTURE = fileURLToPath(new URL("./fixtures/opencode-stream-success.ndjson", import.meta.url));

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
  await writeFile(join(projectDir, "app-store-screenshots.json"), JSON.stringify(PROJECT));
  await writeFile(join(root, "changed.json"), JSON.stringify(CHANGED_PROJECT));
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

function fakeCodex(scenario: string): Promise<void> {
  return writeFake("codex", `case "$1" in
  --version) echo 'codex-cli 0.163.0' ;;
  login)
    printf '%s\\n' "$@" > '${root}/login-argv'
    echo 'Logged in using ChatGPT' >&2 ;;
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
    model: "claude-sonnet-5-5",
    env: { NODE_ENV: "test", PATH: binDir, ANTHROPIC_API_KEY: "sk-ant-should-be-stripped", HOME: root },
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

    const events = await collect(await start({ effort: "max" }));

    expect(events.map(({ type }) => type)).toEqual(["text", "progress", "tool-use", "tool-use", "result", "done"]);
    expect(events.at(-2)).toEqual(ACCEPTED);
    expect(events.at(-1)).toMatchObject({ type: "done", status: "completed" });
    expect(await pendingAgentOutcome(projectDir)).toBeNull();
    expect(await readFile(join(root, "cwd"), "utf8")).toBe(`${await realpath(projectDir)}\n`);
    expect(await readFile(join(root, "stdin"), "utf8")).toBe("--bare Add German");
    const argv = (await readFile(join(root, "argv"), "utf8")).split("\n");
    expect(argv).not.toContain("--bare");
    expect(argv).toEqual(expect.arrayContaining(["-p", "--restricted", "--model", "claude-sonnet-5-5", "--effort", "max"]));
    expect(argv.join("\n")).toContain(join(await realpath(projectDir), "AGENTS.md"));
    const env = await readFile(join(root, "env"), "utf8");
    expect(env).not.toContain("ANTHROPIC_API_KEY");
    expect(env).toContain(`HOME=${root}`);
  });

  it("points an editor-created project without AGENTS.md at the bundled guide", async () => {
    await rm(join(projectDir, "AGENTS.md"));
    await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`);

    await collect(await start());

    const bundledGuide = fileURLToPath(new URL("../../../../packages/cli/src/project-agent-guide.md", import.meta.url));
    const argv = (await readFile(join(root, "argv"), "utf8")).split("\n");
    expect(argv.join("\n")).toContain(`read ${bundledGuide} completely`);
    expect(argv.filter((_, index) => argv[index - 1] === "--add-dir")).toContain(dirname(bundledGuide));
  });

  it("runs Codex through the same runner, so an invalid result is rolled back", async () => {
    const projectFile = join(projectDir, "app-store-screenshots.json");
    await fakeCodex(`printf '{"meta":' > app-store-screenshots.json; /bin/cat '${CODEX_SUCCESS_FIXTURE}'`);

    const events = await collect(await start({
      agentId: "codex",
      model: null,
      env: { NODE_ENV: "test", PATH: binDir, HOME: root, CODEX_API_KEY: "sk-codex-stripped", OPENAI_API_KEY: "sk-openai-stripped" },
    }));

    expect(events.slice(-2)).toEqual([
      expect.objectContaining({ type: "result", status: "rejected", revision: projectRevision(await readFile(projectFile)) }),
      { type: "done", status: "failed", summary: "Added DE to 4 screens.", durationMs: null },
    ]);
    expect(JSON.parse(await readFile(projectFile, "utf8"))).toEqual(parseProject(PROJECT));
    expect(await readFile(join(root, "cwd"), "utf8")).toBe(`${await realpath(projectDir)}\n`);
    expect(await readFile(join(root, "stdin"), "utf8")).toBe("--bare Add German");
    const argv = (await readFile(join(root, "argv"), "utf8")).split("\n");
    expect(argv.slice(0, 4)).toEqual(["exec", "--json", "--sandbox", "workspace-write"]);
    expect(argv.at(-2)).toBe("-");
    expect(await readFile(join(root, "env"), "utf8")).not.toMatch(/CODEX_API_KEY|OPENAI_API_KEY/);
  });

  it("gives an adapter its own env over the sanitized one and its own stdin", async () => {
    await writeFake("opencode", `case "$1" in
  --version) echo '2.1.4' ;;
  *)
    /usr/bin/env > '${root}/env'
    /bin/cat > '${root}/stdin'
    /bin/cat '${OPENCODE_SUCCESS_FIXTURE}' ;;
esac`);

    const events = await collect(await start({
      agentId: "opencode",
      model: null,
      env: { NODE_ENV: "test", PATH: binDir, HOME: root, OPENCODE_CONFIG_CONTENT: '{"permission":"allow"}' },
    }));

    expect(events.at(-1)).toMatchObject({ type: "done", status: "completed" });
    const env = await readFile(join(root, "env"), "utf8");
    expect(env).toContain('OPENCODE_PERMISSION={"edit":"deny"');
    expect(env).not.toContain("OPENCODE_CONFIG_CONTENT");
    const stdin = await readFile(join(root, "stdin"), "utf8");
    expect(stdin).toContain(join(await realpath(projectDir), "AGENTS.md"));
    expect(stdin.endsWith("The user's request:\n--bare Add German")).toBe(true);
  });

  it("probes Codex sign-in and runs Codex with the same credentials store", async () => {
    const codexHome = join(root, "codex-home");
    const store = 'cli_auth_credentials_store="keyring"';
    await mkdir(codexHome);
    await writeFile(join(codexHome, "config.toml"), 'cli_auth_credentials_store = "keyring"\n');
    await fakeCodex(`/bin/cat '${CODEX_SUCCESS_FIXTURE}'`);
    const env = { NODE_ENV: "test", PATH: binDir, HOME: root, CODEX_HOME: codexHome } as const;

    expect((await collect(await start({ agentId: "codex", model: null, env }))).at(-1)).toMatchObject({ status: "completed" });
    expect((await readFile(join(root, "login-argv"), "utf8")).split("\n")).toContain(store);
    expect((await readFile(join(root, "argv"), "utf8")).split("\n")).toContain(store);

    await writeFile(join(codexHome, "config.toml"), 'cli_auth_credentials_store = "ephemeral"\n');
    await rm(join(root, "login-argv"));
    await rm(join(root, "argv"));
    expect(await rejection(start({ agentId: "codex", model: null, env }))).toMatchObject({ status: 409, code: "not-signed-in" });
    expect(await exists(join(root, "login-argv"))).toBe(false);
    expect(await exists(join(root, "argv"))).toBe(false);
  });

  it("allows one run per project and kills the whole process tree on cancel", async () => {
    await fakeClaude(hang());
    const run = await start();

    expect(await rejection(start())).toMatchObject({ status: 409, code: "agent-busy" });
    await expect.poll(() => exists(join(root, "sleep.pid")), { timeout: 5_000 }).toBe(true);
    expect(await cancelAgentRun(projectDir)).toBe(true);

    expect(await collect(run)).toEqual([ACCEPTED, { type: "done", status: "cancelled", summary: null, durationMs: null }]);
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
    // The slot frees only once the post-run verdict is in, which is asynchronous.
    await expect.poll(() => cancelAgentRun(projectDir), { timeout: 5_000 }).toBe(false);
  }, 20_000);

  it("times out a run as a typed error and kills it", async () => {
    await fakeClaude(hang());

    const events = await collect(await start({ timeoutMs: 1_000 }));

    expect(events).toEqual([
      { type: "error", code: "timeout", message: expect.any(String), resets: null },
      ACCEPTED,
      { type: "done", status: "failed", summary: null, durationMs: null },
    ]);
    expect(await processGone(join(root, "sleep.pid"))).toBe(true);
  }, 20_000);

  it("rolls an invalid project back to the pre-run snapshot and rejects the result", async () => {
    const projectFile = join(projectDir, "app-store-screenshots.json");
    await fakeClaude(`printf '{"meta":' > app-store-screenshots.json; /bin/cat '${SUCCESS_FIXTURE}'`);

    const events = await collect(await start());

    expect(events.slice(-2)).toEqual([
      {
        type: "result", status: "rejected", reason: expect.stringMatching(/JSON|token|parse/i),
        changed: false, changedScreens: [], revision: projectRevision(await readFile(projectFile)), otherFiles: NO_OTHER_FILES,
      },
      { type: "done", status: "failed", summary: expect.any(String), durationMs: 100000 },
    ]);
    // The snapshot is restored as a normalized document (defaults applied), like any CLI write.
    expect(JSON.parse(await readFile(projectFile, "utf8"))).toEqual(parseProject(PROJECT));
    expect(await pendingAgentOutcome(projectDir)).toBeNull();
  });

  it("restores a project file the agent deleted", async () => {
    await fakeClaude(`/bin/rm app-store-screenshots.json; /bin/cat '${SUCCESS_FIXTURE}'`);

    const events = await collect(await start());

    expect(events.at(-2)).toMatchObject({ type: "result", status: "rejected", reason: expect.stringMatching(/removed/) });
    expect(events.at(-1)).toMatchObject({ type: "done", status: "failed" });
    expect(JSON.parse(await readFile(join(projectDir, "app-store-screenshots.json"), "utf8"))).toEqual(parseProject(PROJECT));
  });

  it("reports the files a run changed outside the project file, guides first, and Undo run leaves them", async () => {
    await mkdir(join(projectDir, "themes"));
    await mkdir(join(projectDir, "templates"));
    await writeFile(join(projectDir, "themes", "brand.json"), "{}");
    await writeFile(join(projectDir, "templates", "old.json"), "{}");
    await fakeCodex([
      `echo '# Rewritten' >> AGENTS.md`,
      `printf '{"id":"brand"}' > themes/brand.json`,
      "/bin/rm templates/old.json",
      "/bin/mkdir -p assets/imported && echo png > assets/imported/new.png",
      // A killed CLI's temp file and stale lock, and Finder's metadata, are not the agent's changes.
      // The lock is backdated past its stale window, or the verdict would wait for it.
      "echo tmp > .app-store-screenshots.json.abc123.tmp",
      "/bin/mkdir .app-store-screenshots.json.screenshot-studio.lock",
      "/usr/bin/touch -t 200001010000 .app-store-screenshots.json.screenshot-studio.lock",
      "echo finder > .DS_Store",
      `/bin/cp '${root}/changed.json' app-store-screenshots.json`,
      `/bin/cat '${CODEX_SUCCESS_FIXTURE}'`,
    ].join("; "));

    const events = await collect(await start({ agentId: "codex", model: null }));

    const otherFiles = {
      files: [
        { path: "AGENTS.md", change: "modified" },
        { path: "assets/imported/new.png", change: "added" },
        { path: "templates/old.json", change: "removed" },
        { path: "themes/brand.json", change: "modified" },
      ],
      count: 4,
    };
    expect(events.at(-2)).toEqual({ ...ACCEPTED, changed: true, otherFiles });
    expect(await pendingAgentOutcome(projectDir)).toMatchObject({ otherFiles });
    await undoAgentOutcome(projectDir);
    expect(JSON.parse(await readFile(join(projectDir, "app-store-screenshots.json"), "utf8"))).toEqual(parseProject(PROJECT));
    expect(await readFile(join(projectDir, "AGENTS.md"), "utf8")).toContain("# Rewritten");
    expect(await exists(join(projectDir, "assets", "imported", "new.png"))).toBe(true);
  });

  it("reports other files when the project file is unchanged, without following links or listing them all", async () => {
    await fakeClaude([
      "/bin/ln -s / linked",
      "/bin/mkdir many && for i in $(/usr/bin/seq 1 60); do echo x > many/$i.txt; done",
      `/bin/cat '${SUCCESS_FIXTURE}'`,
    ].join("; "));

    const result = (await collect(await start())).at(-2);

    expect(result).toMatchObject({ type: "result", status: "accepted", changed: false });
    const { otherFiles } = result as Extract<AgentEvent, { type: "result" }>;
    expect(otherFiles?.count).toBe(61);
    expect(otherFiles?.files).toHaveLength(50);
    expect(otherFiles?.files.find(({ path }) => path === "linked")).toEqual({ path: "linked", change: "added" });
    expect(otherFiles?.files.every(({ path }) => !path.startsWith("linked/"))).toBe(true);
    expect(await pendingAgentOutcome(projectDir)).toBeNull();
  });

  // Thousands of files take seconds to create on some file systems.
  it("reports a folder too large to compare instead of a partial list", { timeout: 30_000 }, async () => {
    await mkdir(join(projectDir, "bulk"));
    // Batched, so the test never hits the open-file limit.
    for (let batch = 0; batch < 5_000; batch += 200) {
      await Promise.all(Array.from({ length: 200 }, (_, index) => writeFile(join(projectDir, "bulk", `${batch + index}`), "")));
    }
    await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`);

    expect((await collect(await start())).at(-2)).toMatchObject({ type: "result", status: "accepted", otherFiles: null });
  });

  it("keeps a pending outcome for an accepted change until it is kept or undone", async () => {
    const projectFile = join(projectDir, "app-store-screenshots.json");
    await fakeClaude(`/bin/cp '${root}/changed.json' app-store-screenshots.json; /bin/cat '${SUCCESS_FIXTURE}'`);

    const events = await collect(await start());
    expect(events.at(-2)).toEqual({ ...ACCEPTED, changed: true, changedScreens: [] });
    const outcome = await pendingAgentOutcome(projectDir);
    expect(outcome).toMatchObject({ revision: (events.at(-2) as { revision: string }).revision, changedScreens: [] });

    expect(await undoAgentOutcome(projectDir)).toEqual(outcome);
    expect(JSON.parse(await readFile(projectFile, "utf8"))).toEqual(parseProject(PROJECT));
    expect(await pendingAgentOutcome(projectDir)).toBeNull();
    expect(await rejection(undoAgentOutcome(projectDir))).toMatchObject({ status: 404, code: "no-outcome" });

    await collect(await start());
    expect(await keepAgentOutcome(projectDir)).toBe(true);
    expect(await pendingAgentOutcome(projectDir)).toBeNull();
    expect(JSON.parse(await readFile(projectFile, "utf8"))).toEqual(CHANGED_PROJECT);
    expect(await keepAgentOutcome(projectDir)).toBe(false);
  });

  it("leaves an image the run imported on disk when the run is undone or stopped", async () => {
    const projectFile = join(projectDir, "app-store-screenshots.json");
    const imported = join(projectDir, "assets", "imported", "1.png");
    const importAndChange = `/bin/mkdir -p assets/imported; echo png > assets/imported/1.png; /bin/cp '${root}/changed.json' app-store-screenshots.json`;

    await fakeClaude(`${importAndChange}; /bin/cat '${SUCCESS_FIXTURE}'`);
    await collect(await start());
    await undoAgentOutcome(projectDir);
    expect(JSON.parse(await readFile(projectFile, "utf8"))).toEqual(parseProject(PROJECT));
    expect(await exists(imported)).toBe(true);

    await rm(imported);
    await fakeClaude(`${importAndChange}; ${hang()}`);
    const run = await start();
    await expect.poll(() => exists(join(root, "sleep.pid")), { timeout: 5_000 }).toBe(true);
    expect(await cancelAgentRun(projectDir)).toBe(true);
    await collect(run);
    // The editor's Stop is a cancel followed by Undo run.
    await undoAgentOutcome(projectDir);
    expect(JSON.parse(await readFile(projectFile, "utf8"))).toEqual(parseProject(PROJECT));
    expect(await exists(imported)).toBe(true);
  }, 20_000);

  it("names the changed screens and refuses undo once the editor wrote past the run", async () => {
    const projectFile = join(projectDir, "app-store-screenshots.json");
    const renamed = { ...PROJECT, layouts: [{ ...PROJECT.layouts[0], screens: [{ ...PROJECT.layouts[0]!.screens[0], name: "Hero DE" }] }] };
    await writeFile(join(root, "changed.json"), JSON.stringify(renamed));
    await fakeClaude(`/bin/cp '${root}/changed.json' app-store-screenshots.json; /bin/cat '${SUCCESS_FIXTURE}'`);

    const events = await collect(await start());
    expect(events.at(-2)).toMatchObject({ status: "accepted", changed: true, changedScreens: ["hero"] });

    await writeFile(projectFile, JSON.stringify(CHANGED_PROJECT));
    expect(await rejection(undoAgentOutcome(projectDir))).toMatchObject({ status: 409, code: "project-changed" });
    expect(JSON.parse(await readFile(projectFile, "utf8"))).toEqual(CHANGED_PROJECT);
  });

  it("rolls back a critic run that changed the project and keeps the reviewed run's undo", async () => {
    const projectFile = join(projectDir, "app-store-screenshots.json");
    await fakeClaude(`/bin/cp '${root}/changed.json' app-store-screenshots.json; /bin/cat '${SUCCESS_FIXTURE}'`);
    await collect(await start());
    const outcome = await pendingAgentOutcome(projectDir);
    expect(outcome).not.toBeNull();

    await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`);
    const unchanged = await collect(await start({ mode: "critic" }));
    expect(unchanged.at(-2)).toEqual(ACCEPTED);
    expect(await pendingAgentOutcome(projectDir)).toEqual(outcome);

    await writeFile(join(root, "critic.json"), JSON.stringify({ ...CHANGED_PROJECT, meta: { ...CHANGED_PROJECT.meta, name: "Critic" } }));
    await fakeClaude(`/bin/cp '${root}/critic.json' app-store-screenshots.json; /bin/cat '${SUCCESS_FIXTURE}'`);
    const changed = await collect(await start({ mode: "critic" }));
    expect(changed.at(-2)).toMatchObject({ type: "result", status: "rejected", changed: false, reason: expect.stringContaining("read-only") });
    expect(changed.at(-1)).toMatchObject({ type: "done", status: "failed" });
    expect(JSON.parse(await readFile(projectFile, "utf8"))).toEqual(parseProject(CHANGED_PROJECT));
    const kept = await pendingAgentOutcome(projectDir);
    expect(kept).toEqual({ ...outcome, revision: (changed.at(-2) as { revision: string }).revision });

    expect(await undoAgentOutcome(projectDir)).toEqual(kept);
    expect(JSON.parse(await readFile(projectFile, "utf8"))).toEqual(parseProject(PROJECT));
  });

  it("refuses editor writes during a run, and a new run supersedes a pending undo", async () => {
    await fakeClaude(`/bin/cp '${root}/changed.json' app-store-screenshots.json; /bin/cat '${SUCCESS_FIXTURE}'`);
    await collect(await start());
    expect(await pendingAgentOutcome(projectDir)).not.toBeNull();

    await fakeClaude(hang());
    const run = await start();
    expect(await beginEditorWrite(projectDir)).toBeNull();
    expect(await pendingAgentOutcome(projectDir)).toBeNull();
    expect(await rejection(undoAgentOutcome(projectDir))).toMatchObject({ status: 404, code: "no-outcome" });

    await expect.poll(() => exists(join(root, "sleep.pid")), { timeout: 5_000 }).toBe(true);
    await cancelAgentRun(projectDir);
    await collect(run);
    const release = await beginEditorWrite(projectDir);
    expect(release).not.toBeNull();
    release!();
  }, 20_000);

  it("takes its snapshot only after an editor write already in flight has landed", async () => {
    const projectFile = join(projectDir, "app-store-screenshots.json");
    await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`);
    const releaseWrite = (await beginEditorWrite(projectDir))!;
    const slotReserved = async () => {
      const probe = await beginEditorWrite(projectDir);
      probe?.();
      return probe === null;
    };

    const pending = start();
    await expect.poll(slotReserved, { timeout: 5_000 }).toBe(true);
    // Readiness probes are done well within this; the run must still be waiting for the write.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await exists(join(root, "argv"))).toBe(false);

    await writeFile(projectFile, JSON.stringify(CHANGED_PROJECT));
    releaseWrite();
    const events = await collect(await pending);

    // Unchanged by the agent relative to its snapshot, so the snapshot holds the editor's write.
    expect(events.at(-2)).toEqual(ACCEPTED);
    expect(await exists(join(root, "argv"))).toBe(true);
    expect(JSON.parse(await readFile(projectFile, "utf8"))).toEqual(CHANGED_PROJECT);
  }, 20_000);

  it("gives up as project-busy when an editor write does not finish, and frees the slot", async () => {
    await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`);
    const releaseWrite = (await beginEditorWrite(projectDir))!;

    expect(await rejection(start({ drainTimeoutMs: 100 }))).toMatchObject({ status: 409, code: "project-busy" });
    expect(await exists(join(root, "argv"))).toBe(false);

    releaseWrite();
    expect((await collect(await start())).at(-1)).toMatchObject({ type: "done", status: "completed" });
  }, 20_000);

  it("refuses to start when the project cannot be snapshotted", async () => {
    await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`);
    await writeFile(join(projectDir, "app-store-screenshots.json"), "{");

    expect(await rejection(start())).toMatchObject({ status: 409, code: "project-invalid" });
    expect(await exists(join(root, "argv"))).toBe(false);
  });

  it("never runs an unavailable agent, even with a stored consent record for it", async () => {
    const marker = join(root, "spawned");
    await writeFake("gemini", `echo spawned > '${marker}'`);
    const consent = createAgentConsentStore(join(root, "data"));
    const gemini = AGENT_DEFINITIONS.find(({ id }) => id === "gemini-cli")!;
    await mkdir(join(root, "data"));
    await writeFile(join(root, "data", "agent-consents.json"), JSON.stringify({
      version: 1,
      consents: { "gemini-cli": { policyCheckedAt: gemini.policy.checkedAt, grantedAt: "2026-10-16T00:00:00.000Z" } },
    }));

    expect(await consent.isGranted(gemini)).toBe(true);
    expect(await rejection(start({ agentId: "gemini-cli", model: null, consent })))
      .toMatchObject({ status: 403, code: "unavailable" });
    expect(await exists(marker)).toBe(false);
  });

  describe("at-own-risk agents", () => {
    // The fake `claude` stands in for an at-own-risk agent, so a granted run exercises the real adapter.
    const base = AGENT_DEFINITIONS.find(({ id }) => id === "claude-code")!;
    const risky: AgentDefinition = { ...base, policy: { ...base.policy, level: "at-own-risk" } };
    let consent: ReturnType<typeof createAgentConsentStore>;
    const startRisky = () => start({ definitions: [risky], consent });

    beforeEach(async () => {
      consent = createAgentConsentStore(join(root, "data"));
      await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`);
    });

    it("refuses without consent, runs after consent, and refuses again after revoke", async () => {
      expect(await rejection(startRisky())).toMatchObject({ status: 403, code: "consent-required" });
      expect(await exists(join(root, "argv"))).toBe(false);

      await consent.grant(risky);
      expect((await collect(await startRisky())).at(-1)).toMatchObject({ type: "done", status: "completed" });
      expect(await exists(join(root, "argv"))).toBe(true);
      await rm(join(root, "argv"));

      await consent.revoke(risky.id);
      expect(await rejection(startRisky())).toMatchObject({ status: 403, code: "consent-required" });
      expect(await exists(join(root, "argv"))).toBe(false);
    });

    it("honors a revoke that arrives while the readiness probe is still running", async () => {
      await consent.grant(risky);
      // The probe's `--version` is slow, so consent is revoked after the first check and before launch.
      await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`, undefined, "/bin/sleep 0.4; echo '2.1.296 (Claude Code)'");
      const pending = startRisky();
      await new Promise((resolve) => setTimeout(resolve, 150));
      await consent.revoke(risky.id);

      expect(await rejection(pending)).toMatchObject({ status: 403, code: "consent-required" });
      expect(await exists(join(root, "argv"))).toBe(false);
      expect(await rejection(startRisky())).toMatchObject({ status: 403, code: "consent-required" });
    });

    it("reads consent from the app data root when no store is injected", async () => {
      const originalRoot = process.env.SCREENSHOT_STUDIO_DATA_ROOT;
      process.env.SCREENSHOT_STUDIO_DATA_ROOT = join(root, "app-data");
      try {
        const shared = sharedAgentConsentStore();
        expect(await rejection(start({ definitions: [risky] }))).toMatchObject({ status: 403, code: "consent-required" });
        await shared.grant(risky);
        expect((await collect(await start({ definitions: [risky] }))).at(-1)).toMatchObject({ type: "done", status: "completed" });
      } finally {
        if (originalRoot === undefined) delete process.env.SCREENSHOT_STUDIO_DATA_ROOT;
        else process.env.SCREENSHOT_STUDIO_DATA_ROOT = originalRoot;
      }
    });

    it("asks again once the policy was re-verified after the consent", async () => {
      await consent.grant({ ...risky, policy: { ...risky.policy, checkedAt: "2026-09-01" } });

      expect(await rejection(startRisky())).toMatchObject({ status: 403, code: "consent-required" });
      expect(await exists(join(root, "argv"))).toBe(false);
    });

    it("refuses consent that is unreadable, and consent for another agent", async () => {
      await mkdir(join(root, "data"));
      await writeFile(join(root, "data", "agent-consents.json"), "{not json");
      expect(await rejection(startRisky())).toMatchObject({ status: 403, code: "consent-required" });

      await consent.grant({ ...risky, id: "other" });
      expect(await rejection(startRisky())).toMatchObject({ status: 403, code: "consent-required" });
    });

    it("checks consent before the missing adapter, so a refusal never reveals more than the policy", async () => {
      const adapterless: AgentDefinition = { ...risky, id: "adapterless", binary: "adapterless" };
      expect(await rejection(start({ agentId: "adapterless", model: null, definitions: [adapterless], consent })))
        .toMatchObject({ status: 403, code: "consent-required" });
      await consent.grant(adapterless);
      expect(await rejection(start({ agentId: "adapterless", model: null, definitions: [adapterless], consent })))
        .toMatchObject({ status: 409, code: "no-adapter" });
    });
  });

  it("refuses agents that are not ready, unknown models and efforts, and agents without an adapter", async () => {
    await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`, `echo '{"loggedIn":false}'; exit 1`);

    expect(await rejection(start())).toMatchObject({ status: 409, code: "not-signed-in" });
    expect(await rejection(start({ model: "gpt-4" }))).toMatchObject({ status: 400, code: "unknown-model" });
    expect(await rejection(start({ agentId: "codex", model: "gpt-5.5" }))).toMatchObject({ status: 400, code: "unknown-model" });
    expect(await rejection(start({ model: "sonnet" }))).toMatchObject({ status: 400, code: "unknown-model" });
    expect(await rejection(start({ effort: "ultra" }))).toMatchObject({ status: 400, code: "unknown-effort" });
    expect(await rejection(start({ agentId: "codex", model: null, effort: "high" })))
      .toMatchObject({ status: 400, code: "unknown-effort" });
    const adapterless: AgentDefinition = { ...AGENT_DEFINITIONS[0]!, id: "adapterless", binary: "adapterless" };
    expect(await rejection(start({ agentId: "adapterless", model: null, definitions: [adapterless] })))
      .toMatchObject({ status: 409, code: "no-adapter" });
    expect(await exists(join(root, "argv"))).toBe(false);
  });

  describe("image attachments", () => {
    const PNG: AgentAttachment = { type: "png", bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]) };
    const JPEG: AgentAttachment = { type: "jpeg", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]) };
    const folders = () => readdir(join(attachmentRoot(), String(process.pid))).catch(() => []);

    async function runFolder(): Promise<string> {
      const argv = (await readFile(join(root, "argv"), "utf8")).split("\n");
      const dir = argv.filter((_, index) => argv[index - 1] === "--add-dir").find((value) => basename(value).startsWith("run-"));
      expect(dir).toBeDefined();
      return dir!;
    }

    it("gives the CLI a private folder outside the project and removes it when Stop ends the run", async () => {
      await fakeClaude(hang());
      const run = await start({ attachments: [PNG, JPEG] });
      await expect.poll(() => exists(join(root, "sleep.pid")), { timeout: 5_000 }).toBe(true);

      const dir = await runFolder();
      expect((await readdir(dir)).sort()).toEqual(["1.png", "2.jpg"]);
      expect([...await readFile(join(dir, "1.png"))]).toEqual([...PNG.bytes]);
      expect((await stat(dir)).mode & 0o777).toBe(0o700);
      expect(relative(await realpath(projectDir), dir).startsWith("..")).toBe(true);
      expect((await readdir(projectDir)).sort()).toEqual(["AGENTS.md", "app-store-screenshots.json"]);
      expect(await readFile(join(root, "argv"), "utf8")).toContain(`${join(dir, "1.png")}\n${join(dir, "2.jpg")}`);

      expect(await cancelAgentRun(projectDir)).toBe(true);
      await collect(run);
      await expect.poll(() => exists(dir), { timeout: 5_000 }).toBe(false);
    }, 20_000);

    it.each([
      ["accepted", `/bin/cat '${SUCCESS_FIXTURE}'`],
      ["rejected", `printf '{"meta":' > app-store-screenshots.json; /bin/cat '${SUCCESS_FIXTURE}'`],
      ["failed", "echo boom >&2; exit 1"],
    ])("removes the run folder after a %s run", async (_outcome, scenario) => {
      await fakeClaude(scenario);

      await collect(await start({ attachments: [PNG] }));

      await expect.poll(async () => exists(await runFolder()), { timeout: 5_000 }).toBe(false);
    });

    it("removes the run folder when the run times out or its stream is abandoned", async () => {
      await fakeClaude(hang());
      await collect(await start({ attachments: [PNG], timeoutMs: 1_000 }));
      await expect.poll(async () => exists(await runFolder()), { timeout: 5_000 }).toBe(false);

      await rm(join(root, "sleep.pid"));
      const run = await start({ attachments: [JPEG] });
      await expect.poll(() => exists(join(root, "sleep.pid")), { timeout: 5_000 }).toBe(true);
      const dir = await runFolder();
      await run.events.cancel();
      await expect.poll(() => exists(dir), { timeout: 5_000 }).toBe(false);
      await expect.poll(() => cancelAgentRun(projectDir), { timeout: 5_000 }).toBe(false);
    }, 20_000);

    it("keeps one run's folder apart from another's", async () => {
      await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`);
      await collect(await start({ attachments: [PNG] }));
      const first = await runFolder();
      await collect(await start({ attachments: [PNG] }));

      expect(await runFolder()).not.toBe(first);
    });

    it("writes nothing for a request the gate refuses", async () => {
      await fakeClaude(hang());
      const before = await folders();

      expect(await rejection(start({ agentId: "gemini-cli", model: null, attachments: [PNG] }))).toMatchObject({ code: "unavailable" });
      expect(await rejection(start({ model: "no-such-model", attachments: [PNG] }))).toMatchObject({ code: "unknown-model" });
      expect(await folders()).toEqual(before);
      const run = await start({ attachments: [PNG] });
      expect(await rejection(start({ attachments: [PNG] }))).toMatchObject({ code: "agent-busy" });

      await expect.poll(() => exists(join(root, "sleep.pid")), { timeout: 5_000 }).toBe(true);
      expect((await folders()).length).toBe(before.length + 1);
      await cancelAgentRun(projectDir);
      await collect(run);
    }, 20_000);

    it("does not touch the attachment folder for a text-only run, or for one stopped before launch", async () => {
      await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`);
      const before = await folders();

      await collect(await start());
      expect(await folders()).toEqual(before);

      await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`, undefined, "/bin/sleep 1; echo '2.1.296 (Claude Code)'");
      await rm(join(root, "argv"), { force: true });
      const pending = start({ attachments: [PNG] });
      await expect.poll(() => cancelAgentRun(projectDir), { timeout: 5_000 }).toBe(true);
      expect(await collect(await pending)).toEqual([{ type: "done", status: "cancelled", summary: null, durationMs: null }]);
      expect(await exists(join(root, "argv"))).toBe(false);
      expect(await folders()).toEqual(before);
    }, 20_000);

    it("never launches when Stop lands after the last readiness check, and keeps the pending Undo", async () => {
      await fakeClaude(`/bin/cp '${root}/changed.json' app-store-screenshots.json; /bin/cat '${SUCCESS_FIXTURE}'`);
      await collect(await start());
      expect(await pendingAgentOutcome(projectDir)).not.toBeNull();
      await rm(join(root, "argv"));

      // The consent re-check right before the snapshot is the last await a Stop can slip into.
      let checks = 0;
      const consent = {
        isGranted: async () => {
          checks += 1;
          if (checks === 2) await cancelAgentRun(projectDir);
          return true;
        },
        grant: async () => undefined,
        revoke: async () => undefined,
      };
      const definitions = AGENT_DEFINITIONS.map((definition) => (
        definition.id === "claude-code" ? { ...definition, policy: { ...definition.policy, level: "at-own-risk" as const } } : definition
      ));
      const before = await folders();

      const events = await collect(await start({ attachments: [PNG], definitions, consent }));

      expect(events).toEqual([{ type: "done", status: "cancelled", summary: null, durationMs: null }]);
      expect(await exists(join(root, "argv"))).toBe(false);
      expect(await folders()).toEqual(before);
      expect(await pendingAgentOutcome(projectDir)).not.toBeNull();
    }, 20_000);

    it("passes Codex one --image per file", async () => {
      await fakeCodex(`/bin/cat '${CODEX_SUCCESS_FIXTURE}'`);

      await collect(await start({
        agentId: "codex",
        model: null,
        attachments: [PNG, JPEG],
        env: { NODE_ENV: "test", PATH: binDir, HOME: root },
      }));

      const argv = (await readFile(join(root, "argv"), "utf8")).split("\n");
      const images = argv.filter((_, index) => argv[index - 1] === "--image");
      expect(images.map((file) => basename(file))).toEqual(["1.png", "2.jpg"]);
      expect(argv.at(-2)).toBe("-");
      await expect.poll(() => exists(images[0]!), { timeout: 5_000 }).toBe(false);
    });
  });
});
