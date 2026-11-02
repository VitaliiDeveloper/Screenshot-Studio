// SPDX-License-Identifier: Apache-2.0
import * as fs from "node:fs";
import { mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireStorageLock, StorageLockTimeoutError } from "./storage-lock.server.js";

type Acquire = typeof acquireStorageLock;

let root: string;
let lockPath: string;

const quiet = { stale: 30_000, update: 10_000, retryDelayMs: 5, onCompromised() {} };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "storage-lock-"));
  lockPath = join(root, ".test.lock");
});

afterEach(async () => {
  vi.resetModules();
  await rm(root, { recursive: true, force: true });
});

/**
 * Replays the reported interleaving: a waiter that already saw the lock as stale only removes it
 * once the other waiter holds its fresh lock.
 */
async function raceForStaleLock(first: Acquire, second: Acquire) {
  await mkdir(lockPath);
  const longAgo = new Date(Date.now() - 3_600_000);
  await utimes(lockPath, longAgo, longAgo);

  let openGate = () => {};
  const gate = new Promise<void>((resolve) => { openGate = resolve; });
  let removals = 0;
  const delayedSecondRemoval = {
    ...fs,
    rmdir(path: fs.PathLike, callback: fs.NoParamCallback) {
      removals += 1;
      if (removals === 1) return fs.rmdir(path, callback);
      void gate.then(() => fs.rmdir(path, callback));
    },
  } as unknown as typeof fs;
  const options = { ...quiet, timeoutMs: 0, fs: delayedSecondRemoval };

  const attempts = [first(lockPath, options), second(lockPath, options)];
  for (const attempt of attempts) void attempt.then(openGate, () => {});
  const results = await Promise.allSettled(attempts);
  await Promise.allSettled(results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value()] : []));
  return results;
}

describe("acquireStorageLock", () => {
  it("lets only one same-process waiter break a stale lock", async () => {
    const results = await raceForStaleLock(acquireStorageLock, acquireStorageLock);

    expect(results.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(results.find(({ status }) => status === "rejected"))
      .toMatchObject({ reason: expect.any(StorageLockTimeoutError) });
  });

  it("serializes attempts between separately bundled copies of this module", async () => {
    vi.resetModules();
    const { acquireStorageLock: otherBundleCopy } = await import("./storage-lock.server.js");
    expect(otherBundleCopy).not.toBe(acquireStorageLock);

    const results = await raceForStaleLock(acquireStorageLock, otherBundleCopy);

    expect(results.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
  });

  it("times a waiter out on its own budget while another waiter keeps retrying", async () => {
    const releaseHolder = await acquireStorageLock(lockPath, { ...quiet, timeoutMs: 0 });
    const patient = acquireStorageLock(lockPath, { ...quiet, timeoutMs: 30_000 });

    await expect(acquireStorageLock(lockPath, { ...quiet, timeoutMs: 20 }))
      .rejects.toBeInstanceOf(StorageLockTimeoutError);

    await releaseHolder();
    const releasePatient = await patient;
    await releasePatient();
  });

  it("fails after one attempt when the budget is zero and keeps non-lock errors", async () => {
    const releaseHolder = await acquireStorageLock(lockPath, { ...quiet, timeoutMs: 0 });

    await expect(acquireStorageLock(lockPath, { ...quiet, timeoutMs: 0 }))
      .rejects.toMatchObject({ name: "StorageLockTimeoutError", cause: { code: "ELOCKED" } });
    await releaseHolder();

    await rm(root, { recursive: true, force: true });
    await expect(acquireStorageLock(lockPath, { ...quiet, timeoutMs: 0 }))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
});
