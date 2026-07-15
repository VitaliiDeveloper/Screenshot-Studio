// SPDX-License-Identifier: Apache-2.0
import { appendFile, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
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
  waitUntilBlocked(): Promise<void>;
  wakeWaiters(): void;
  runHeartbeats(): Promise<void>;
}

function manualEnvironment(identifiers: string[], initialNow = 1_000): ManualLockEnvironment {
  let now = initialNow;
  let generated = 0;
  const waiters: Array<() => void> = [];
  const waitObservers: Array<() => void> = [];
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
        hostInstanceId: () => "test-host-instance",
        processId: () => 42,
        isOwnerAlive: async (owner) => liveness.get(owner.token) ?? true,
        sleep: () => {
          waitObservers.splice(0).forEach((resolve) => resolve());
          return new Promise<void>((resolve) => waiters.push(resolve));
        },
        scheduleHeartbeat: (callback) => {
          heartbeats.add(callback);
          return () => { heartbeats.delete(callback); };
        },
      },
    },
    setNow(value) { now = value; },
    setAlive(token, alive) { liveness.set(token, alive); },
    waitUntilBlocked() {
      return waiters.length > 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => waitObservers.push(resolve));
    },
    wakeWaiters() { waiters.splice(0).forEach((resolve) => resolve()); },
    async runHeartbeats() {
      await Promise.all([...heartbeats].map((heartbeat) => heartbeat()));
    },
  };
}

function ownerFile(lockPath: string, token: string): string {
  return join(lockPath, "owners", `${encodeURIComponent(token)}.json`);
}

async function releasedTokens(lockPath: string): Promise<string[]> {
  const names = await readdir(join(lockPath, "released"));
  return names
    .filter((name) => name.endsWith(".json"))
    .map((name) => decodeURIComponent(name.slice(0, -".json".length)));
}

function decodeLogEntry(line: string): { token: string } {
  const prefix = "SSLOCK1:";
  const encoded = line.slice(line.lastIndexOf(prefix) + prefix.length).trim();
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { token: string };
}

function encodeLogEntry(value: object): string {
  return `SSLOCK1:${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}\n`;
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
    await environment.waitUntilBlocked();
    expect(entered).toBe(false);

    await first.release();
    environment.wakeWaiters();
    await second;
    expect(entered).toBe(true);
  });

  it("fails closed when an active owner record is missing from the shared queue journal", async () => {
    const path = await projectPath("project-lock-lost-queue-record-");
    const environment = manualEnvironment(["active-owner", "waiter"]);
    const activeOwner = await acquireProjectMutationLock(path, environment.options);
    const lockPath = projectMutationLockPath(path);
    await writeFile(join(lockPath, "queue.log"), "");

    await expect(acquireProjectMutationLock(path, {
      ...environment.options,
      timeoutMs: 0,
    })).rejects.toThrow(/Timed out/);
    await expect(stat(ownerFile(lockPath, "active-owner"))).resolves.toBeDefined();

    await activeOwner.release();
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

    expect((await releasedTokens(lockPath)).filter((token) => token === "old-owner")).toHaveLength(1);
    await newOwner.release();
    const finalOwner = await acquireProjectMutationLock(path, environment.options);
    expect(finalOwner.ownerToken).toBe("final-owner");
    await finalOwner.release();
  });

  it("creates one release marker when two contenders recover the same stale token", async () => {
    const path = await projectPath("project-lock-stale-race-");
    const environment = manualEnvironment(["old-owner", "second-owner", "third-owner"]);
    const baseFileSystem = createNodeProjectLockFileSystem();
    let recoveryRaceEnabled = false;
    let recoveryAttempts = 0;
    let signalFirstRecovery!: () => void;
    const firstRecovery = new Promise<void>((resolve) => { signalFirstRecovery = resolve; });
    let releaseRecoveryRace!: () => void;
    const recoveryRace = new Promise<void>((resolve) => { releaseRecoveryRace = resolve; });
    const fileSystem: Partial<ProjectLockFileSystem> = {
      publishFileExclusive: async (filePath, contents, mode) => {
        if (recoveryRaceEnabled
          && filePath.endsWith("/released/old-owner.json")
          && recoveryAttempts < 2) {
          recoveryAttempts += 1;
          if (recoveryAttempts === 1) signalFirstRecovery();
          if (recoveryAttempts === 2) releaseRecoveryRace();
          await recoveryRace;
        }
        return baseFileSystem.publishFileExclusive(filePath, contents, mode);
      },
    };
    environment.options.dependencies!.fileSystem = fileSystem;
    const oldOwner = await acquireProjectMutationLock(path, environment.options);
    environment.setAlive("old-owner", false);
    environment.setNow(2_000);
    recoveryRaceEnabled = true;

    const secondPromise = acquireProjectMutationLock(path, environment.options);
    await firstRecovery;
    const thirdPromise = acquireProjectMutationLock(path, environment.options);
    await recoveryRace;
    const secondOwner = await secondPromise;
    await environment.waitUntilBlocked();

    await oldOwner.release();
    expect((await releasedTokens(projectMutationLockPath(path))).filter((token) => token === "old-owner"))
      .toHaveLength(1);
    await secondOwner.release();
    environment.wakeWaiters();
    const thirdOwner = await thirdPromise;
    await thirdOwner.release();
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

  it("treats missing owner metadata as unknown instead of recovering its queue token", async () => {
    const path = await projectPath("project-lock-missing-owner-");
    const environment = manualEnvironment(["missing-owner", "waiter"]);
    const missingOwner = await acquireProjectMutationLock(path, environment.options);
    const lockPath = projectMutationLockPath(path);
    await rm(ownerFile(lockPath, "missing-owner"));
    environment.setAlive("missing-owner", false);
    environment.setNow(2_000);

    await expect(acquireProjectMutationLock(path, {
      ...environment.options,
      timeoutMs: 0,
    })).rejects.toThrow(/Timed out/);
    expect(await releasedTokens(lockPath)).not.toContain("missing-owner");

    await missingOwner.release();
  });

  it("treats the same hostname from another host instance or PID namespace as unknown", async () => {
    const path = await projectPath("project-lock-remote-");
    let now = 1_000;
    const remoteOwner = await acquireProjectMutationLock(path, {
      dependencies: {
        now: () => now,
        randomId: () => "remote-owner",
        hostname: () => "shared-hostname",
        hostInstanceId: () => "remote-pid-namespace",
        processId: () => 2_000_000_000,
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
        hostname: () => "shared-hostname",
        hostInstanceId: () => "local-pid-namespace",
        scheduleHeartbeat: () => () => undefined,
      },
    })).rejects.toThrow(/Timed out/);

    await remoteOwner.release();
  });

  it("cleans up only its unique owner when queue initialization fails beside a live owner", async () => {
    const path = await projectPath("project-lock-init-cleanup-");
    const baseFileSystem = createNodeProjectLockFileSystem();
    const fileSystem: Partial<ProjectLockFileSystem> = {
      appendLine: async (logPath, line) => {
        const entry = decodeLogEntry(line);
        if (logPath.endsWith("queue.log") && entry.token === "failed-owner") {
          const lockPath = projectMutationLockPath(path);
          const replacement = {
            token: "replacement-owner",
            hostname: "test-host",
            hostInstanceId: "test-host-instance",
            pid: 42,
            createdAt: 2_000,
          };
          await baseFileSystem.createFileExclusive(
            ownerFile(lockPath, replacement.token),
            `${JSON.stringify(replacement)}\n`,
            0o600,
          );
          await baseFileSystem.appendLine(
            join(lockPath, "queue.log"),
            encodeLogEntry({ token: replacement.token, createdAt: replacement.createdAt }),
            0o600,
          );
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

  it("publishes one complete no-replace release marker under concurrent claims", async () => {
    const path = await projectPath("project-lock-marker-publish-");
    const fileSystem = createNodeProjectLockFileSystem();
    const directory = join(projectMutationLockPath(path), "released");
    await fileSystem.ensureDirectory(projectMutationLockPath(path), 0o700);
    await fileSystem.ensureDirectory(directory, 0o700);
    const markerPath = join(directory, "owner.json");

    const results = await Promise.all([
      fileSystem.publishFileExclusive(markerPath, '{"token":"owner","releasedAt":1}\n', 0o600),
      fileSystem.publishFileExclusive(markerPath, '{"token":"owner","releasedAt":2}\n', 0o600),
    ]);

    expect(results.sort()).toEqual([false, true]);
    const marker = await fileSystem.readFile(markerPath);
    expect(JSON.parse(marker!.contents)).toMatchObject({ token: "owner" });
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("fails closed when a release marker is empty or malformed", async () => {
    const path = await projectPath("project-lock-corrupt-release-");
    const environment = manualEnvironment(["active-owner", "waiter"]);
    const activeOwner = await acquireProjectMutationLock(path, environment.options);
    const markerPath = join(projectMutationLockPath(path), "released", "active-owner.json");
    await writeFile(markerPath, "");

    await expect(acquireProjectMutationLock(path, {
      ...environment.options,
      timeoutMs: 0,
    })).rejects.toThrow(/Invalid project lock release marker/);

    await rm(markerPath);
    await activeOwner.release();
  });

  it("clears heartbeat state and allows release to retry after a transient marker failure", async () => {
    const path = await projectPath("project-lock-release-retry-");
    const baseFileSystem = createNodeProjectLockFileSystem();
    let failRelease = true;
    let heartbeatCancelled = 0;
    const fileSystem: Partial<ProjectLockFileSystem> = {
      publishFileExclusive: async (filePath, contents, mode) => {
        if (filePath.includes("/released/") && failRelease) {
          failRelease = false;
          throw new Error("transient release failure");
        }
        return baseFileSystem.publishFileExclusive(filePath, contents, mode);
      },
    };
    const lock = await acquireProjectMutationLock(path, {
      dependencies: {
        randomId: () => "retry-owner",
        fileSystem,
        scheduleHeartbeat: () => () => { heartbeatCancelled += 1; },
      },
    });

    await expect(lock.release()).rejects.toThrow("transient release failure");
    expect(heartbeatCancelled).toBe(1);
    await expect(lock.release()).resolves.toBeUndefined();
    expect(await releasedTokens(projectMutationLockPath(path))).toEqual(["retry-owner"]);
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
