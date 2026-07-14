// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireProjectMutationLock,
  projectMutationLockPath,
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
  wakeWaiters(): void;
  runHeartbeats(): Promise<void>;
  waiting(): number;
}

function manualEnvironment(identifiers: string[], initialNow = 1_000): ManualLockEnvironment {
  let now = initialNow;
  let generated = 0;
  const waiters: Array<() => void> = [];
  const heartbeats = new Set<() => Promise<void>>();
  return {
    options: {
      timeoutMs: 500,
      staleAfterMs: 200,
      retryDelayMs: 10,
      heartbeatMs: 50,
      dependencies: {
        now: () => now,
        randomId: () => identifiers.shift() ?? `generated-${generated += 1}`,
        sleep: () => new Promise<void>((resolve) => waiters.push(resolve)),
        scheduleHeartbeat: (callback) => {
          heartbeats.add(callback);
          return () => { heartbeats.delete(callback); };
        },
      },
    },
    setNow(value) { now = value; },
    wakeWaiters() { waiters.splice(0).forEach((resolve) => resolve()); },
    async runHeartbeats() {
      await Promise.all([...heartbeats].map((heartbeat) => heartbeat()));
    },
    waiting: () => waiters.length,
  };
}

async function waitForIo(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("condition was not reached");
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

  it("times out within a bounded injected deadline with project-specific retry guidance", async () => {
    const path = await projectPath("project-lock-timeout-");
    let now = 1_000;
    const first = await acquireProjectMutationLock(path, {
      timeoutMs: 100,
      staleAfterMs: 10_000,
      dependencies: { now: () => now, randomId: () => "owner" },
    });

    await expect(acquireProjectMutationLock(path, {
      timeoutMs: 30,
      staleAfterMs: 10_000,
      retryDelayMs: 10,
      dependencies: {
        now: () => now,
        randomId: () => "waiter",
        sleep: async (duration) => { now += duration; },
        scheduleHeartbeat: () => () => undefined,
      },
    })).rejects.toThrow(new RegExp(`Timed out.*${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*retry`, "i"));

    await first.release();
  });

  it("replaces a stale lease once and an old delayed release cannot remove the new owner", async () => {
    const path = await projectPath("project-lock-stale-");
    const environment = manualEnvironment(["old-owner", "stale-quarantine", "new-owner", "third"]);
    const oldOwner = await acquireProjectMutationLock(path, environment.options);
    expect(oldOwner.ownerToken).toBe("old-owner");
    environment.setNow(2_000);

    const newOwner = await acquireProjectMutationLock(path, environment.options);
    expect(newOwner.ownerToken).toBe("new-owner");
    await oldOwner.release();

    await expect(acquireProjectMutationLock(path, {
      ...environment.options,
      timeoutMs: 0,
    })).rejects.toThrow(/Timed out/);

    await newOwner.release();
    const third = await acquireProjectMutationLock(path, environment.options);
    await third.release();
  });

  it("releases its owned lease when the protected operation throws", async () => {
    const path = await projectPath("project-lock-error-");
    const environment = manualEnvironment(["throwing-owner", "next-owner"]);

    await expect(withProjectMutation(path, async () => {
      throw new Error("operation failed");
    }, environment.options)).rejects.toThrow("operation failed");

    const next = await acquireProjectMutationLock(path, environment.options);
    await next.release();
  });

  it("stops heartbeat and release when the owner token no longer matches", async () => {
    const path = await projectPath("project-lock-token-");
    const environment = manualEnvironment(["original-owner"]);
    const lock = await acquireProjectMutationLock(path, environment.options);
    const lockPath = projectMutationLockPath(path);
    await writeFile(join(lockPath, "owner.json"), `${JSON.stringify({ token: "replacement-owner" })}\n`);
    const before = (await stat(lockPath)).mtimeMs;

    environment.setNow(5_000);
    await environment.runHeartbeats();
    expect((await stat(lockPath)).mtimeMs).toBe(before);

    await lock.release();
    await expect(stat(lockPath)).resolves.toBeDefined();
  });
});
