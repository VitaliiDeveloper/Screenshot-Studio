// SPDX-License-Identifier: Apache-2.0
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, stat, symlink, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolveManagedProjectStorageConfig } from "@web/lib/managed-project-config.server.js";
import {
  acquireManagedProjectLifecycleLock,
  managedProjectLifecycleLockPath,
} from "@web/lib/managed-project-lifecycle-lock.server.js";

const roots: string[] = [];
const children = new Set<ChildProcess>();
const WEB_TSCONFIG = fileURLToPath(new URL("../tsconfig.json", import.meta.url));
const PROJECT_ID = "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SECOND_PROJECT_ID = "project_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function shortOptions() {
  return { timeoutMs: 0, staleAfterMs: 5_000, retryDelayMs: 10, heartbeatMs: 1_000 };
}

function waitForOutput(child: ChildProcess, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += String(chunk);
      if (output.includes(expected)) resolve();
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!output.includes(expected)) reject(new Error(`child exited ${code}: ${output}`));
    });
  });
}

afterEach(async () => {
  for (const child of children) child.kill("SIGKILL");
  children.clear();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("managed project lifecycle lock", () => {
  it("rejects traversal ids and serializes one project lifecycle", async () => {
    const root = await mkdtemp(join(tmpdir(), "managed-lifecycle-lock-"));
    roots.push(root);
    const config = resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: root });
    await mkdir(config.lifecycleLocksRoot, { recursive: true });

    await expect(acquireManagedProjectLifecycleLock(config, "../escape", shortOptions()))
      .rejects.toThrow(/project id/i);
    const first = await acquireManagedProjectLifecycleLock(config, PROJECT_ID, shortOptions());
    await expect(acquireManagedProjectLifecycleLock(config, PROJECT_ID, shortOptions()))
      .rejects.toThrow(/lifecycle lock/i);
    await first.release();
    await expect(stat(managedProjectLifecycleLockPath(config, PROJECT_ID)))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps lifecycle leases for different projects isolated in one process", async () => {
    const root = await mkdtemp(join(tmpdir(), "managed-lifecycle-isolation-"));
    roots.push(root);
    const config = resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: root });
    await mkdir(config.lifecycleLocksRoot, { recursive: true });

    const first = await acquireManagedProjectLifecycleLock(config, PROJECT_ID);
    const second = await acquireManagedProjectLifecycleLock(config, SECOND_PROJECT_ID);

    await expect(first.release()).resolves.toBeUndefined();
    await expect(second.release()).resolves.toBeUndefined();
    await expect(stat(managedProjectLifecycleLockPath(config, PROJECT_ID)))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(managedProjectLifecycleLockPath(config, SECOND_PROJECT_ID)))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a contender owned by another process and recovers its stale lease", async () => {
    const root = await mkdtemp(join(tmpdir(), "managed-lifecycle-child-"));
    roots.push(root);
    const config = resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: root });
    await mkdir(config.lifecycleLocksRoot, { recursive: true });
    const fixture = fileURLToPath(new URL("./fixtures/managed-lifecycle-lock-child.ts", import.meta.url));
    const child = spawn(process.execPath, ["--import", "tsx", fixture, root, PROJECT_ID], {
      env: { ...process.env, TSX_TSCONFIG_PATH: WEB_TSCONFIG },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(child);
    await waitForOutput(child, "acquired\n");

    await expect(acquireManagedProjectLifecycleLock(config, PROJECT_ID, shortOptions()))
      .rejects.toThrow(/lifecycle lock/i);
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGKILL");
    await exited;
    children.delete(child);
    const stale = new Date(Date.now() - 10_000);
    await utimes(managedProjectLifecycleLockPath(config, PROJECT_ID), stale, stale);

    const recovered = await acquireManagedProjectLifecycleLock(config, PROJECT_ID, shortOptions());
    await recovered.release();
  });

  it("rejects a lifecycle-lock root redirected through a static symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "managed-lifecycle-symlink-"));
    roots.push(root);
    const config = resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: root });
    const outside = join(root, "outside-locks");
    await mkdir(outside);
    await symlink(outside, config.lifecycleLocksRoot);

    await expect(acquireManagedProjectLifecycleLock(config, PROJECT_ID, shortOptions()))
      .rejects.toThrow(/storage boundary/i);
    await expect(stat(join(outside, `${PROJECT_ID}.lock`))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a symlinked configured root before creating lifecycle state in its target", async () => {
    const container = await mkdtemp(join(tmpdir(), "managed-lifecycle-root-symlink-"));
    roots.push(container);
    const outside = join(container, "outside");
    const declared = join(container, "declared");
    await mkdir(outside);
    await symlink(outside, declared);
    const config = resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: declared });

    await expect(acquireManagedProjectLifecycleLock(config, PROJECT_ID, shortOptions()))
      .rejects.toThrow(/storage root/i);
    await expect(readdir(outside)).resolves.toEqual([]);
  });
});
