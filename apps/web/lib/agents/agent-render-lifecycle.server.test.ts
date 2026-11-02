// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveManagedProjectStorageConfig } from "@web/lib/managed-projects/managed-project-config.server.js";
import { withManagedProjectLifecycleLock } from "@web/lib/managed-projects/managed-project-lifecycle-lock.server.js";
import { renderInboxRoot } from "./agent-render-inbox.server.js";
import type { RenderHost, RenderJobContext } from "./agent-render-job.server.js";
import { stopAgentRun } from "./agent-run-guard.server.js";
import {
  cancelAgentRun,
  startAgentRun,
  undoAgentOutcome,
  type AgentEvent,
  type AgentRun,
} from "./agent-session.server.js";

// The job itself has its own test; here a stand-in publishes like one, so the test controls its timing.
const job = vi.hoisted(() => ({ run: null as null | ((context: RenderJobContext) => Promise<unknown>) }));
vi.mock("./agent-render-job.server.js", () => ({
  runRenderJob: (_request: unknown, context: RenderJobContext) => job.run!(context),
}));
const launch = vi.hoisted(() => ({ fail: false }));
vi.mock("./agent-run-process.server.js", async (original) => {
  const actual = await original<typeof import("./agent-run-process.server.js")>();
  return {
    ...actual,
    launchRun: (...args: Parameters<typeof actual.launchRun>) => {
      if (launch.fail) throw new Error("spawn failed");
      return actual.launchRun(...args);
    },
  };
});

const inboxFailure = vi.hoisted(() => ({ fail: false, onCreate: null as null | (() => Promise<unknown>) }));
vi.mock("./agent-render-inbox.server.js", async (original) => {
  const actual = await original<typeof import("./agent-render-inbox.server.js")>();
  return {
    ...actual,
    createRenderInbox: async () => {
      if (inboxFailure.fail) throw new Error("no temp folder");
      await inboxFailure.onCreate?.();
      return actual.createRenderInbox();
    },
  };
});

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
const CHANGED = { ...PROJECT, meta: { ...PROJECT.meta, name: "Changed" } };
const SUCCESS_FIXTURE = fileURLToPath(new URL("./fixtures/claude-stream-success.ndjson", import.meta.url));
const REQUEST_ID = "01234567-89ab-4def-8123-456789abcdef";
const EXPORTED = { path: "export/shot.png", change: "added" };

let root: string;
let binDir: string;
let projectDir: string;
const host: RenderHost = { origin: "http://127.0.0.1:1", guard: (operation) => operation() };

/** Asks for one render, waits for the answer, then does `then`. */
function renderThen(then: string): string {
  return `inbox="$SCREENSHOT_STUDIO_RENDER_INBOX"
printf '{"command":"export","flags":{}}' > "$inbox/request-${REQUEST_ID}.json"
while [ ! -e "$inbox/response-${REQUEST_ID}.json" ]; do /bin/sleep 0.02; done
${then}`;
}

async function fakeClaude(scenario: string): Promise<void> {
  const path = join(binDir, "claude");
  await writeFile(path, `#!/bin/sh
case "$1" in
  --version) echo '2.1.296 (Claude Code)' ;;
  --help) echo '  --bare    Minimal mode' ;;
  auth) /usr/bin/env > '${root}/probe-env'; echo '{"loggedIn":true,"authMethod":"claude.ai"}' ;;
  *)
    /usr/bin/env > '${root}/env'
    /bin/cat > /dev/null
    ${scenario} ;;
esac
`);
  await chmod(path, 0o755);
}

function start(overrides: Partial<Parameters<typeof startAgentRun>[0]> = {}): Promise<AgentRun> {
  return startAgentRun({
    agentId: "claude-code",
    projectDir,
    message: "go",
    model: "claude-sonnet-5-5",
    env: { NODE_ENV: "test", PATH: binDir, HOME: root },
    renderHost: host,
    ...overrides,
  });
}

async function collect(run: AgentRun): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  const reader = run.events.getReader();
  for (let next = await reader.read(); !next.done; next = await reader.read()) events.push(next.value);
  return events;
}

const result = (events: AgentEvent[]) => events.find((event) => event.type === "result") as Extract<AgentEvent, { type: "result" }>;
const liveInboxes = async () => readdir(join(renderInboxRoot(), String(process.pid))).catch(() => []);

async function until(condition: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!await condition()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** A job that holds the guard until released, then publishes unless the run cancelled it. */
function heldJob(): { release: () => void; entered: () => boolean; sawCancel: () => boolean | null } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let entered = false;
  let sawCancel: boolean | null = null;
  job.run = (context) => context.guard(async () => {
    context.onGuardHeld?.();
    entered = true;
    await gate;
    sawCancel = context.isCancelled();
    if (!sawCancel) await publish();
    return { ok: true, output: "", exitCode: 0 };
  });
  return { release, entered: () => entered, sawCancel: () => sawCancel };
}

async function publish(): Promise<void> {
  await mkdir(join(projectDir, "export"), { recursive: true });
  await writeFile(join(projectDir, "export", "shot.png"), "png");
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "render-lifecycle-")));
  binDir = join(root, "bin");
  projectDir = join(root, "project");
  await mkdir(binDir);
  await mkdir(projectDir);
  await writeFile(join(projectDir, "app-store-screenshots.json"), JSON.stringify(PROJECT));
  await writeFile(join(root, "changed.json"), JSON.stringify(CHANGED));
  job.run = async () => {
    await publish();
    return { ok: true, output: "Exported", exitCode: 0 };
  };
  launch.fail = false;
  inboxFailure.fail = false;
  inboxFailure.onCreate = null;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("a run's render broker", () => {
  it("gives only the run the inbox: not the probes, and not a run without a host", async () => {
    await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`);
    await collect(await start());
    const inbox = /SCREENSHOT_STUDIO_RENDER_INBOX=(.+)/.exec(await readFile(join(root, "env"), "utf8"))?.[1];
    expect(inbox).toContain("screenshot-studio-render");
    expect(inbox!.startsWith(projectDir)).toBe(false);
    expect(await readFile(join(root, "probe-env"), "utf8")).not.toContain("SCREENSHOT_STUDIO_RENDER_INBOX");

    await collect(await start({ renderHost: undefined }));
    expect(await readFile(join(root, "env"), "utf8")).not.toContain("SCREENSHOT_STUDIO_RENDER_INBOX");
  });

  it("does not take the inbox path from the server's own environment", async () => {
    await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`);
    await collect(await start({
      renderHost: undefined,
      env: { NODE_ENV: "test", PATH: binDir, HOME: root, SCREENSHOT_STUDIO_RENDER_INBOX: "/planted" },
    }));
    expect(await readFile(join(root, "env"), "utf8")).not.toContain("/planted");
  });

  it("still runs without the variable when the inbox cannot be created", async () => {
    inboxFailure.fail = true;
    await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`);
    const events = await collect(await start());
    expect(events.at(-1)).toMatchObject({ type: "done", status: "completed" });
    expect(await readFile(join(root, "env"), "utf8")).not.toContain("SCREENSHOT_STUDIO_RENDER_INBOX");
  });

  describe("removes the inbox", () => {
    it("when the run succeeds", async () => {
      await fakeClaude(renderThen(`/bin/cat '${SUCCESS_FIXTURE}'`));
      await collect(await start());
      expect(await liveInboxes()).toEqual([]);
    });

    it("when Stop arrives after the inbox exists and before the launch", async () => {
      await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`);
      inboxFailure.onCreate = () => cancelAgentRun(projectDir);
      const events = await collect(await start());
      expect(events).toEqual([expect.objectContaining({ type: "done", status: "cancelled" })]);
      expect(existsSync(join(root, "env"))).toBe(false);
      expect(await liveInboxes()).toEqual([]);
    });

    it("when the agent fails", async () => {
      await fakeClaude("exit 1");
      const events = await collect(await start());
      expect(events.at(-1)).toMatchObject({ type: "done", status: "failed" });
      expect(await liveInboxes()).toEqual([]);
    });

    it("when the run times out", async () => {
      heldJob().release();
      await fakeClaude("/bin/sleep 30");
      const events = await collect(await start({ timeoutMs: 100 }));
      expect(events.at(-1)).toMatchObject({ type: "done", status: "failed" });
      expect(await liveInboxes()).toEqual([]);
    });

    it("when the project is rejected", async () => {
      await fakeClaude(`echo '{"broken":' > app-store-screenshots.json; /bin/cat '${SUCCESS_FIXTURE}'`);
      const events = await collect(await start());
      expect(result(events).status).toBe("rejected");
      expect(await liveInboxes()).toEqual([]);
    });

    it("when the run cannot launch", async () => {
      await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`);
      launch.fail = true;
      await expect(start()).rejects.toThrow("spawn failed");
      expect(await liveInboxes()).toEqual([]);
    });
  });

  describe("broker output in the run's verdict", () => {
    it("is listed as another file of an accepted run, and the project does not count as changed", async () => {
      await fakeClaude(renderThen(`/bin/cat '${SUCCESS_FIXTURE}'`));
      const { changed, status, otherFiles } = result(await collect(await start()));
      expect({ changed, status }).toEqual({ changed: false, status: "accepted" });
      expect(otherFiles).toEqual({ files: [EXPORTED], count: 1 });
    });

    it("stays when a rejected verdict restores the project", async () => {
      await fakeClaude(renderThen(`echo '{"broken":' > app-store-screenshots.json; /bin/cat '${SUCCESS_FIXTURE}'`));
      const { status, otherFiles } = result(await collect(await start()));
      expect(status).toBe("rejected");
      expect(otherFiles).toEqual({ files: [EXPORTED], count: 1 });
      expect(existsSync(join(projectDir, "export", "shot.png"))).toBe(true);
    });

    it("stays after Undo run", async () => {
      await fakeClaude(renderThen(`/bin/cp '${root}/changed.json' app-store-screenshots.json; /bin/cat '${SUCCESS_FIXTURE}'`));
      const { changed, otherFiles } = result(await collect(await start()));
      expect(changed).toBe(true);
      expect(otherFiles).toEqual({ files: [EXPORTED], count: 1 });
      await undoAgentOutcome(projectDir);
      expect(JSON.parse(await readFile(join(projectDir, "app-store-screenshots.json"), "utf8")).meta.name).toBe("Agents");
      expect(existsSync(join(projectDir, "export", "shot.png"))).toBe(true);
    });

    it("leaves a critic run accepted, because only the project file is read-only for it", async () => {
      await fakeClaude(renderThen(`/bin/cat '${SUCCESS_FIXTURE}'`));
      const { status, otherFiles } = result(await collect(await start({ mode: "critic" })));
      expect(status).toBe("accepted");
      expect(otherFiles).toEqual({ files: [EXPORTED], count: 1 });
    });
  });

  describe("a job in flight", () => {
    it("is cancelled and awaited before the verdict, so nothing publishes after it", async () => {
      const held = heldJob();
      await fakeClaude(renderThen(`/bin/cat '${SUCCESS_FIXTURE}'`));
      const events = collect(await start());
      await until(held.entered);
      let settled = false;
      void events.then(() => { settled = true; });
      await cancelAgentRun(projectDir);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(settled).toBe(false);
      held.release();
      const { otherFiles } = result(await events);
      expect(held.sawCancel()).toBe(true);
      expect(otherFiles).toEqual({ files: [], count: 0 });
      expect(existsSync(join(projectDir, "export"))).toBe(false);
    });

    it("holds stopAgentRun until it ends", async () => {
      const held = heldJob();
      await fakeClaude(renderThen(`/bin/cat '${SUCCESS_FIXTURE}'`));
      const run = await start();
      const events = collect(run);
      await until(held.entered);
      await expect(stopAgentRun(join(projectDir, "app-store-screenshots.json"), 100)).resolves.toBe(false);
      held.release();
      await expect(stopAgentRun(join(projectDir, "app-store-screenshots.json"))).resolves.toBe(true);
      expect(held.sawCancel()).toBe(true);
      await events;
    });

    it("holds Undo until it ends, so an export cannot land after the restore", async () => {
      await fakeClaude(`/bin/cp '${root}/changed.json' app-store-screenshots.json; /bin/cat '${SUCCESS_FIXTURE}'`);
      await collect(await start());
      const held = heldJob();
      await fakeClaude(renderThen(`/bin/cat '${SUCCESS_FIXTURE}'`));
      const events = collect(await start({ mode: "critic" }));
      await until(held.entered);
      await expect(undoAgentOutcome(projectDir)).rejects.toMatchObject({ code: "agent-busy" });
      held.release();
      await cancelAgentRun(projectDir);
      await events;
      await expect(undoAgentOutcome(projectDir)).resolves.toBeTruthy();
    });

    it("does not stall a delete that holds the real lifecycle lock while it stops the run", async () => {
      const config = resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: join(root, "data") });
      const projectId = `project_${"a".repeat(32)}`;
      const published = vi.fn();
      job.run = (context) => context.guard(async () => {
        context.onGuardHeld?.();
        if (!context.isCancelled()) published();
        return { ok: true, output: "", exitCode: 0 };
      });
      let requested!: () => void;
      const requestSeen = new Promise<void>((resolve) => { requested = resolve; });
      let stoppedInTime: boolean | undefined;
      const deleting = withManagedProjectLifecycleLock(config, projectId, async () => {
        await fakeClaude(renderThen(`/bin/cat '${SUCCESS_FIXTURE}'`));
        const run = await start({
          renderHost: {
            origin: host.origin,
            guard: (operation) => {
              requested();
              return withManagedProjectLifecycleLock(config, projectId, operation);
            },
          },
        });
        const events = collect(run);
        await requestSeen;
        // Within the budget stopAgentRun has for a delete, and well under the lock's 30 s wait.
        stoppedInTime = await stopAgentRun(join(projectDir, "app-store-screenshots.json"), 10_000);
        await events;
      });
      await deleting;
      expect(stoppedInTime).toBe(true);
      await until(() => liveInboxes().then((entries) => entries.length === 0));
      expect(published).not.toHaveBeenCalled();
    }, 30_000);
  });
});
