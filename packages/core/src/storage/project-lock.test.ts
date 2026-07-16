// SPDX-License-Identifier: Apache-2.0
import { spawn, type ChildProcess } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireProjectMutationLock,
  projectMutationLockPath,
  type ProjectLockOptions,
  withProjectMutation,
} from "./project-lock.js";

const temporaryRoots: string[] = [];
const childProcesses = new Set<ChildProcess>();
const childScript = fileURLToPath(new URL("./fixtures/project-lock-child.ts", import.meta.url));

afterEach(async () => {
  for (const child of childProcesses) child.kill("SIGKILL");
  childProcesses.clear();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createProjectPath(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  const projectPath = join(root, "app-store-screenshots.json");
  await writeFile(projectPath, "{}\n", "utf8");
  return projectPath;
}

function shortLockOptions(overrides: ProjectLockOptions = {}): ProjectLockOptions {
  return {
    timeoutMs: 1_000,
    staleAfterMs: 5_000,
    retryDelayMs: 10,
    heartbeatMs: 1_000,
    ...overrides,
  };
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function startLockChild(...arguments_: string[]): ChildProcess {
  const child = spawn(process.execPath, ["--import", "tsx", childScript, ...arguments_], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  childProcesses.add(child);
  child.once("exit", () => childProcesses.delete(child));
  return child;
}

function waitForOutput(child: ChildProcess, expected: string, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for child output ${JSON.stringify(expected)}; stderr: ${stderr}`));
    }, timeoutMs);
    const onStdout = (chunk: Buffer | string) => {
      stdout += chunk.toString();
      if (stdout.includes(expected)) {
        cleanup();
        resolvePromise();
      }
    };
    const onStderr = (chunk: Buffer | string) => { stderr += chunk.toString(); };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(new Error(`Child exited before ${JSON.stringify(expected)}: code=${code} signal=${signal}; stderr: ${stderr}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.off("exit", onExit);
    };
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.once("exit", onExit);
  });
}

function waitForExit(child: ChildProcess, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    let stderr = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for child exit; stderr: ${stderr}`));
    }, timeoutMs);
    const onStderr = (chunk: Buffer | string) => { stderr += chunk.toString(); };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      if (code === 0) resolvePromise();
      else reject(new Error(`Child failed: code=${code} signal=${signal}; stderr: ${stderr}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stderr?.off("data", onStderr);
      child.off("exit", onExit);
    };
    child.stderr?.on("data", onStderr);
    child.once("exit", onExit);
  });
}

describe("project mutation lock", () => {
  it("uses one hidden sibling directory per project document", async () => {
    const path = await createProjectPath("project-lock-path-");
    const canonicalPath = await realpath(path);

    expect(projectMutationLockPath(path)).toBe(
      join(dirname(canonicalPath), `.${basename(canonicalPath)}.screenshot-studio.lock`),
    );
  });

  it("removes bounded lock metadata after release", async () => {
    const path = await createProjectPath("project-lock-clean-release-");
    const lockPath = projectMutationLockPath(path);
    const lock = await acquireProjectMutationLock(path, shortLockOptions());

    await expect(stat(lockPath)).resolves.toBeDefined();
    await lock.release();
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps a second operation outside until the current owner releases", async () => {
    const path = await createProjectPath("project-lock-exclusive-");
    const first = await acquireProjectMutationLock(path, shortLockOptions());
    let secondEntered = false;

    const second = withProjectMutation(path, async () => {
      secondEntered = true;
    }, shortLockOptions());
    await wait(100);
    expect(secondEntered).toBe(false);

    await first.release();
    await second;
    expect(secondEntered).toBe(true);
  });

  it("coordinates aliases that resolve to the same physical project file", async () => {
    const path = await createProjectPath("project-lock-symlink-");
    const aliasPath = join(dirname(path), "project-alias.json");
    await symlink(path, aliasPath);
    const first = await acquireProjectMutationLock(path, shortLockOptions());

    const aliasAttempt = await acquireProjectMutationLock(
      aliasPath,
      shortLockOptions({ timeoutMs: 0 }),
    ).then(
      (lock) => ({ lock }),
      (error: unknown) => ({ error }),
    );

    if ("lock" in aliasAttempt) await aliasAttempt.lock.release();
    expect(aliasAttempt).toMatchObject({ error: expect.any(Error) });
    await first.release();
  });

  it("reports a bounded acquisition timeout with the library error as its cause", async () => {
    const path = await createProjectPath("project-lock-timeout-");
    const first = await acquireProjectMutationLock(path, shortLockOptions());

    const failure = await acquireProjectMutationLock(path, shortLockOptions({ timeoutMs: 0 }))
      .then(() => undefined, (error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({ cause: expect.any(Error) });
    expect((failure as Error).message).toMatch(/Timed out.*project mutation lock/i);
    expect((failure as Error).message).toContain(path);
    await first.release();
  });

  it("recovers a stale lock directory left by a crashed process", async () => {
    const path = await createProjectPath("project-lock-stale-");
    const lockPath = projectMutationLockPath(path);
    await mkdir(lockPath);
    const staleDate = new Date(Date.now() - 10_000);
    await utimes(lockPath, staleDate, staleDate);

    const lock = await acquireProjectMutationLock(path, shortLockOptions());

    await expect(stat(lockPath)).resolves.toBeDefined();
    await lock.release();
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("releases once when callers clean up concurrently", async () => {
    const path = await createProjectPath("project-lock-idempotent-");
    const lockPath = projectMutationLockPath(path);
    const lock = await acquireProjectMutationLock(path, shortLockOptions());

    await expect(Promise.all([lock.release(), lock.release(), lock.release()])).resolves.toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("releases after an operation throws and preserves a falsy thrown value", async () => {
    const path = await createProjectPath("project-lock-operation-error-");
    let caught = false;

    try {
      await withProjectMutation(path, async () => { throw undefined; }, shortLockOptions());
    } catch (error) {
      caught = true;
      expect(error).toBeUndefined();
    }

    expect(caught).toBe(true);
    const next = await acquireProjectMutationLock(path, shortLockOptions());
    await next.release();
  });

  it.each([
    ["timeoutMs", { timeoutMs: -1 }],
    ["timeoutMs", { timeoutMs: Number.POSITIVE_INFINITY }],
    ["staleAfterMs", { staleAfterMs: 4_999 }],
    ["retryDelayMs", { retryDelayMs: 0 }],
    ["heartbeatMs", { heartbeatMs: 999 }],
    ["heartbeatMs", { staleAfterMs: 5_000, heartbeatMs: 2_501 }],
  ] satisfies Array<[keyof ProjectLockOptions, ProjectLockOptions]>) (
    "rejects an invalid %s before acquiring",
    async (option, invalidOptions) => {
      const path = await createProjectPath(`project-lock-invalid-${option}-`);

      await expect(acquireProjectMutationLock(path, {
        ...shortLockOptions(),
        ...invalidOptions,
      })).rejects.toThrow(new RegExp(option));
      await expect(stat(projectMutationLockPath(path))).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("recovers a lock abandoned by a killed process without overlapping the live owner", async () => {
    const path = await createProjectPath("project-lock-killed-owner-");
    const owner = startLockChild("hold", path);
    await waitForOutput(owner, "acquired\n");
    let contenderEntered = false;

    const contender = withProjectMutation(path, async () => {
      contenderEntered = true;
    }, shortLockOptions({ timeoutMs: 5_000 }));
    await wait(200);
    expect(contenderEntered).toBe(false);

    const ownerExited = new Promise<void>((resolvePromise) => {
      owner.once("exit", () => resolvePromise());
    });
    owner.kill("SIGKILL");
    await ownerExited;
    const staleDate = new Date(Date.now() - 10_000);
    await utimes(projectMutationLockPath(path), staleDate, staleDate);

    await contender;
    expect(contenderEntered).toBe(true);
    await expect(stat(projectMutationLockPath(path))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("serializes read-modify-write transactions across multiple writer processes", async () => {
    const path = await createProjectPath("project-lock-process-writers-");
    await writeFile(path, "0\n", "utf8");
    const writers = Array.from({ length: 4 }, () => {
      const writer = startLockChild("increment", path, "5");
      return waitForExit(writer);
    });

    await Promise.all(writers);

    expect(Number(await readFile(path, "utf8"))).toBe(20);
    await expect(stat(projectMutationLockPath(path))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
