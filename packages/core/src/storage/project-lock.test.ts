// SPDX-License-Identifier: Apache-2.0
import { appendFile, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireProjectMutationLock,
  createNodeProjectLockFileSystem,
  projectMutationLockPath,
  type ProjectLockFileSystem,
  type ProjectLockOptions,
  withProjectMutation,
} from "./project-lock.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function projectPath(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return join(root, "app-store-screenshots.json");
}

interface ManualLockEnvironment {
  options: ProjectLockOptions;
  setNow(value: number): void;
  setAlive(token: string, alive: boolean): void;
  wakeWaiters(): void;
  runHeartbeats(): Promise<void>;
  waiting(): number;
}

function manualEnvironment(identifiers: string[], initialNow = 1_000): ManualLockEnvironment {
  let now = initialNow;
  let generated = 0;
  const waiters: Array<() => void> = [];
  const heartbeats = new Set<() => Promise<void>>();
  const liveness = new Map<string, boolean>();
  return {
    options: {
      timeoutMs: 500,
      staleAfterMs: 200,
      retryDelayMs: 10,
      heartbeatMs: 50,
      dependencies: {
        now: () => now,
        randomId: () => identifiers.shift() ?? `generated-${generated += 1}`,
        hostname: () => "test-host",
        processId: () => 42,
        isOwnerAlive: async (owner) => liveness.get(owner.token) ?? true,
        sleep: () => new Promise<void>((resolve) => waiters.push(resolve)),
        scheduleHeartbeat: (callback) => {
          heartbeats.add(callback);
          return () => { heartbeats.delete(callback); };
        },
      },
    },
    setNow(value) { now = value; },
    setAlive(token, alive) { liveness.set(token, alive); },
    wakeWaiters() { waiters.splice(0).forEach((resolve) => resolve()); },
    async runHeartbeats() {
      await Promise.all([...heartbeats].map((heartbeat) => heartbeat()));
    },
    waiting: () => waiters.length,
  };
}

async function waitForIo(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("condition was not reached");
}

function ownerFile(lockPath: string, token: string): string {
  return join(lockPath, "owners", `${encodeURIComponent(token)}.json`);
}

async function releasedTokens(lockPath: string): Promise<string[]> {
  const contents = await readFile(join(lockPath, "released.log"), "utf8");
  return contents.trim().split("\n").map((line) => decodeLogEntry(line).token);
}

function decodeLogEntry(line: string): { token: string } {
  const prefix = "SSLOCK1:";
  const encoded = line.slice(line.lastIndexOf(prefix) + prefix.length).trim();
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { token: string };
}

describe("project mutation lock", () => {
  it("keeps a second operation outside while the current owner heartbeat is live", async () => {
    const path = await projectPath("project-lock-live-");
    const environment = manualEnvironment(["owner-one", "owner-two"]);
    const first = await acquireProjectMutationLock(path, environment.options);
    environment.setNow(1_150);
    await environment.runHeartbeats();
    environment.setNow(1_300);

    let entered = false;
    const second = withProjectMutation(path, async () => { entered = true; }, environment.options);
    await waitForIo(() => environment.waiting() > 0);
    expect(entered).toBe(false);

    await first.release();
    environment.wakeWaiters();
    await second;
    expect(entered).toBe(true);
  });

  it("uses only the remaining deadline and never evaluates ownership after it expires", async () => {
    const path = await projectPath("project-lock-timeout-");
    let now = 1_000;
    const first = await acquireProjectMutationLock(path, {
      timeoutMs: 100,
      staleAfterMs: 10_000,
      dependencies: {
        now: () => now,
        randomId: () => "owner",
        scheduleHeartbeat: () => () => undefined,
      },
    });
    const sleeps: number[] = [];

    await expect(acquireProjectMutationLock(path, {
      timeoutMs: 25,
      staleAfterMs: 10_000,
      retryDelayMs: 10,
      dependencies: {
        now: () => now,
        randomId: () => "waiter",
        sleep: async (duration) => { sleeps.push(duration); now += duration; },
        scheduleHeartbeat: () => () => undefined,
      },
    })).rejects.toThrow(new RegExp(`Timed out.*${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*retry`, "i"));

    expect(sleeps).toEqual([10, 10, 5]);
    await first.release();
  });

  it("recovers only a stale dead token and delayed release cannot affect the replacement", async () => {
    const path = await projectPath("project-lock-stale-");
    const environment = manualEnvironment(["old-owner", "new-owner", "blocked-owner", "final-owner"]);
    const oldOwner = await acquireProjectMutationLock(path, environment.options);
    environment.setAlive("old-owner", false);
    environment.setNow(2_000);

    const newOwner = await acquireProjectMutationLock(path, environment.options);
    expect(newOwner.ownerToken).toBe("new-owner");
    await oldOwner.release();

    const lockPath = projectMutationLockPath(path);
    await expect(stat(ownerFile(lockPath, "new-owner"))).resolves.toBeDefined();
    await expect(acquireProjectMutationLock(path, {
      ...environment.options,
      timeoutMs: 0,
    })).rejects.toThrow(/Timed out/);
    await expect(stat(ownerFile(lockPath, "new-owner"))).resolves.toBeDefined();

    expect((await releasedTokens(lockPath)).filter((token) => token === "old-owner")).toHaveLength(2);
    await newOwner.release();
    const finalOwner = await acquireProjectMutationLock(path, environment.options);
    expect(finalOwner.ownerToken).toBe("final-owner");
    await finalOwner.release();
  });

  it("does not recover an old heartbeat while the same-host owner is still alive", async () => {
    const path = await projectPath("project-lock-stale-alive-");
    const environment = manualEnvironment(["live-owner", "waiter"]);
    const liveOwner = await acquireProjectMutationLock(path, environment.options);
    environment.setNow(2_000);

    await expect(acquireProjectMutationLock(path, {
      ...environment.options,
      timeoutMs: 0,
    })).rejects.toThrow(/Timed out/);

    await liveOwner.release();
  });

  it("treats a stale owner from another host as live when liveness is unknown", async () => {
    const path = await projectPath("project-lock-remote-");
    let now = 1_000;
    const remoteOwner = await acquireProjectMutationLock(path, {
      dependencies: {
        now: () => now,
        randomId: () => "remote-owner",
        hostname: () => "remote-host",
        processId: () => 91,
        scheduleHeartbeat: () => () => undefined,
      },
    });
    now = 100_000;

    await expect(acquireProjectMutationLock(path, {
      timeoutMs: 0,
      staleAfterMs: 10,
      dependencies: {
        now: () => now,
        randomId: () => "local-waiter",
        hostname,
        scheduleHeartbeat: () => () => undefined,
      },
    })).rejects.toThrow(/Timed out/);

    await remoteOwner.release();
  });

  it("cleans up only its unique owner when queue initialization fails beside a live owner", async () => {
    const path = await projectPath("project-lock-init-cleanup-");
    const baseFileSystem = createNodeProjectLockFileSystem();
    let replacement: Awaited<ReturnType<typeof acquireProjectMutationLock>> | undefined;
    const fileSystem: Partial<ProjectLockFileSystem> = {
      appendLine: async (logPath, line) => {
        const entry = decodeLogEntry(line);
        if (logPath.endsWith("queue.log") && entry.token === "failed-owner") {
          replacement = await acquireProjectMutationLock(path, {
            dependencies: {
              randomId: () => "replacement-owner",
              fileSystem,
              scheduleHeartbeat: () => () => undefined,
            },
          });
          throw new Error("queue append failed");
        }
        await baseFileSystem.appendLine(logPath, line, 0o600);
      },
    };

    await expect(acquireProjectMutationLock(path, {
      dependencies: {
        randomId: () => "failed-owner",
        fileSystem,
        scheduleHeartbeat: () => () => undefined,
      },
    })).rejects.toThrow("queue append failed");

    const owners = await readdir(join(projectMutationLockPath(path), "owners"));
    expect(owners).toEqual(["replacement-owner.json"]);
    await replacement!.release();
  });

  it("releases its token once when release is called repeatedly", async () => {
    const path = await projectPath("project-lock-idempotent-");
    const lock = await acquireProjectMutationLock(path, {
      dependencies: {
        randomId: () => "owner",
        scheduleHeartbeat: () => () => undefined,
      },
    });

    await Promise.all([lock.release(), lock.release()]);
    expect(await releasedTokens(projectMutationLockPath(path))).toEqual(["owner"]);
  });

  it("resynchronizes after a crashed append leaves a partial queue tail", async () => {
    const path = await projectPath("project-lock-partial-log-");
    const first = await acquireProjectMutationLock(path, {
      dependencies: {
        randomId: () => "first-owner",
        scheduleHeartbeat: () => () => undefined,
      },
    });
    await first.release();
    const lockPath = projectMutationLockPath(path);
    await appendFile(join(lockPath, "queue.log"), "SSLOCK1:eyJ0b2tlbiI6ImNyYXNoZWQ");

    const second = await acquireProjectMutationLock(path, {
      dependencies: {
        randomId: () => "second-owner",
        scheduleHeartbeat: () => () => undefined,
      },
    });

    expect(second.ownerToken).toBe("second-owner");
    await second.release();
  });

  it("releases its token and preserves a falsy thrown operation value", async () => {
    const path = await projectPath("project-lock-falsy-error-");
    let caught = false;

    try {
      await withProjectMutation(path, async () => { throw undefined; }, {
        dependencies: {
          randomId: () => "throwing-owner",
          scheduleHeartbeat: () => () => undefined,
        },
      });
    } catch (error) {
      caught = true;
      expect(error).toBeUndefined();
    }

    expect(caught).toBe(true);
    const next = await acquireProjectMutationLock(path, {
      dependencies: {
        randomId: () => "next-owner",
        scheduleHeartbeat: () => () => undefined,
      },
    });
    await next.release();
  });

  it("refreshes only its unique owner file during heartbeat", async () => {
    const path = await projectPath("project-lock-heartbeat-");
    const environment = manualEnvironment(["owner"]);
    const lock = await acquireProjectMutationLock(path, environment.options);
    const lockPath = projectMutationLockPath(path);
    const lockMtime = (await stat(lockPath)).mtimeMs;

    environment.setNow(5_000);
    await environment.runHeartbeats();

    expect((await stat(ownerFile(lockPath, "owner"))).mtimeMs).toBe(5_000);
    expect((await stat(lockPath)).mtimeMs).toBe(lockMtime);
    await lock.release();
  });
});
