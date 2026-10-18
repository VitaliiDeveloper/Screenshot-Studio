// SPDX-License-Identifier: Apache-2.0
import { spawn, type ChildProcess } from "node:child_process";
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { acquireProjectMutationLock, readProjectSnapshot } from "@screenshot-studio/core/storage";
import { ManagedProjectCatalogStore } from "./managed-project-catalog.server.js";
import { resolveManagedProjectStorageConfig } from "./managed-project-config.server.js";
import { acquireManagedProjectLifecycleLock } from "./managed-project-lifecycle-lock.server.js";
import { ManagedProjectLifecycleService } from "./managed-project-lifecycle.server.js";
import { withManagedProjectReadGuard } from "./managed-project-mutation-guard.server.js";
import { ManagedProjectNotFoundError, ManagedProjectRepository } from "./managed-project-repository.server.js";
import { ManagedProjectSourceAdapter, ProjectSessionRegistry } from "@web/lib/session/project-session.server.js";

const roots: string[] = [];
const childProcesses = new Set<ChildProcess>();
const managedPutChild = fileURLToPath(new URL("./fixtures/managed-put-child.ts", import.meta.url));
const WEB_TSCONFIG = fileURLToPath(new URL("../../tsconfig.json", import.meta.url));
const OPERATION_ID = "operation_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const STATUS_SECRET_HASH = "2".repeat(64);

afterEach(async () => {
  for (const child of childProcesses) child.kill("SIGKILL");
  childProcesses.clear();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function waitForChildOutput(child: ChildProcess, expected: string, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${expected}: ${stderr}`)); }, timeoutMs);
    const onStdout = (chunk: Buffer | string) => {
      stdout += chunk.toString();
      if (stdout.includes(expected)) { cleanup(); resolve(); }
    };
    const onStderr = (chunk: Buffer | string) => { stderr += chunk.toString(); };
    const onExit = (code: number | null) => {
      cleanup();
      if (!stdout.includes(expected)) reject(new Error(`child exited ${code}: ${stderr}`));
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

function projectJson(name = "Managed") {
  return JSON.stringify({
    meta: { name, schemaVersion: 1 }, fonts: [], preferredExportLayoutId: "primary",
    layouts: [{ id: "primary", name: "Primary", mode: "isolated", screens: [{
      id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
      artboard: { width: 660, height: 1434 },
      background: { type: "solid", color: "#000000" }, elements: [],
    }] }],
  });
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "managed-project-delete-"));
  roots.push(root);
  const config = resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: root });
  const repository = new ManagedProjectRepository(config);
  const stage = await repository.createStage();
  await writeFile(join(stage.path, "app-store-screenshots.json"), projectJson());
  await writeFile(join(stage.path, "resource.txt"), "keep until delete");
  const project = await repository.publishStage({ token: stage.token });
  const registry = new ProjectSessionRegistry({
    createSessionId: () => "managed-session",
    managedSource: new ManagedProjectSourceAdapter(repository),
  });
  const session = await registry.openManaged(project.id);
  const projectRevision = (await readProjectSnapshot(project.projectPath)).revision;
  return { config, repository, registry, project, session, projectRevision };
}

function request(input: Awaited<ReturnType<typeof fixture>>) {
  return {
    id: input.project.id,
    expectedLifecycleRevision: input.project.lifecycleRevision,
    expectedProjectRevision: input.projectRevision,
    operationId: OPERATION_ID,
    statusSecretHash: STATUS_SECRET_HASH,
  };
}

describe("ManagedProjectLifecycleService", () => {
  it("permanently deletes a managed project through an internal tombstone and invalidates its session", async () => {
    const input = await fixture();
    const lifecycle = new ManagedProjectLifecycleService(input.config, input.registry);

    await expect(lifecycle.permanentlyDelete(request(input))).resolves.toMatchObject({
      operationId: OPERATION_ID,
      projectId: input.project.id,
      state: "complete",
    });

    await expect(lstat(input.project.projectDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readdir(input.config.tombstonesRoot)).resolves.toEqual([]);
    await expect(new ManagedProjectCatalogStore(input.config).getActive(input.project.id))
      .resolves.toBeUndefined();
    expect(input.registry.peek(input.session.descriptor.sessionId)).toBeUndefined();
    await expect(lstat(join(input.config.root, "trash"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects stale lifecycle and Project revisions before durable admission", async () => {
    for (const overrides of [
      { expectedLifecycleRevision: 2 },
      { expectedProjectRevision: "f".repeat(64) },
    ]) {
      const input = await fixture();
      const lifecycle = new ManagedProjectLifecycleService(input.config, input.registry);

      await expect(lifecycle.permanentlyDelete({ ...request(input), ...overrides }))
        .rejects.toThrow(/revision/i);
      await expect(readFile(input.project.projectPath, "utf8")).resolves.toContain("Managed");
      await expect(new ManagedProjectCatalogStore(input.config).read())
        .resolves.toMatchObject({ entries: [{ id: input.project.id }], deletions: [] });
    }
  });

  it("rejects an existing recovery intent before durable deletion admission", async () => {
    const input = await fixture();
    const intentPath = join(input.config.recoveryRoot, `${input.project.id}.json`);
    const existing = `${JSON.stringify({ version: 1, operation: "publish", id: input.project.id })}\n`;
    await writeFile(intentPath, existing);

    await expect(new ManagedProjectLifecycleService(input.config, input.registry)
      .permanentlyDelete(request(input))).rejects.toThrow(/recovery|intent/i);

    await expect(readFile(intentPath, "utf8")).resolves.toBe(existing);
    await expect(new ManagedProjectCatalogStore(input.config).read())
      .resolves.toMatchObject({ entries: [{ id: input.project.id }], deletions: [] });
  });

  it("drains the project mutation lease before deletion admission", async () => {
    const input = await fixture();
    const projectLock = await acquireProjectMutationLock(input.project.projectPath, {
      timeoutMs: 0, staleAfterMs: 5_000, retryDelayMs: 10, heartbeatMs: 1_000,
    });
    let settled = false;
    const deleting = new ManagedProjectLifecycleService(input.config, input.registry)
      .permanentlyDelete(request(input)).finally(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(settled).toBe(false);
    await projectLock.release();

    await expect(deleting).resolves.toMatchObject({ state: "complete" });
  });

  it("rejects a real child-process write after durable deletion admission", async () => {
    const input = await fixture();
    let reachedReservation!: () => void;
    const reservationReached = new Promise<void>((resolve) => { reachedReservation = resolve; });
    let continueDeletion!: () => void;
    const deletionCanContinue = new Promise<void>((resolve) => { continueDeletion = resolve; });
    const lifecycle = new ManagedProjectLifecycleService(input.config, input.registry, {
      failpoint: async (point) => {
        if (point !== "after-reservation") return;
        reachedReservation();
        await deletionCanContinue;
      },
    });
    const deleting = lifecycle.permanentlyDelete(request(input));
    await reservationReached;
    const child = spawn(process.execPath, [
      "--import", "tsx", managedPutChild, input.config.root, input.project.id, input.projectRevision,
    ], {
      cwd: join(dirname(managedPutChild), "..", "..", ".."),
      env: { ...process.env, TSX_TSCONFIG_PATH: WEB_TSCONFIG },
      stdio: ["ignore", "pipe", "pipe"],
    });
    childProcesses.add(child);
    continueDeletion();
    await waitForChildOutput(child, "status:409\n");
    childProcesses.delete(child);
    await expect(deleting).resolves.toMatchObject({ state: "complete" });
  });

  it("fails before reservation for unsafe project trees and redirected managed roots", async () => {
    const linked = await fixture();
    await symlink(join(linked.config.root, "outside"), join(linked.project.projectDirectory, "escape"));
    await expect(new ManagedProjectLifecycleService(linked.config, linked.registry)
      .permanentlyDelete(request(linked))).rejects.toThrow(/symbolic link/i);
    await expect(new ManagedProjectCatalogStore(linked.config).read())
      .resolves.toMatchObject({ deletions: [] });

    const hardLinked = await fixture();
    await link(hardLinked.project.projectPath, join(hardLinked.project.projectDirectory, "copy.json"));
    await expect(new ManagedProjectLifecycleService(hardLinked.config, hardLinked.registry)
      .permanentlyDelete(request(hardLinked))).rejects.toThrow(/unsafe file/i);
    await expect(new ManagedProjectCatalogStore(hardLinked.config).read())
      .resolves.toMatchObject({ deletions: [] });

    const redirected = await fixture();
    const outside = join(redirected.config.root, "outside-tombstones");
    await mkdir(outside);
    await rm(redirected.config.tombstonesRoot, { recursive: true });
    await symlink(outside, redirected.config.tombstonesRoot);
    await expect(new ManagedProjectLifecycleService(redirected.config, redirected.registry)
      .permanentlyDelete(request(redirected))).rejects.toThrow(/storage boundary/i);
    await expect(readdir(outside)).resolves.toEqual([]);
  });

  it("retains recovery evidence on move errors and reconciles it after restart", async () => {
    const input = await fixture();
    const failing = new ManagedProjectLifecycleService(input.config, input.registry, {
      rename: async (from, to) => {
        if (from.includes(`/projects/${input.project.id}`)
          && to.includes(`/tombstones/${input.project.id}.`)) {
          throw Object.assign(new Error("cross-device move rejected"), { code: "EXDEV" });
        }
        await rename(from, to);
      },
    });

    await expect(failing.permanentlyDelete(request(input))).rejects.toThrow(/cross-device/i);
    await expect(new ManagedProjectCatalogStore(input.config).getDeletionEvidence(OPERATION_ID))
      .resolves.toMatchObject({ state: "reserved" });
    await expect(new ManagedProjectLifecycleService(input.config, input.registry).reconcileAll())
      .resolves.toBeUndefined();
    await expect(new ManagedProjectCatalogStore(input.config).getDeletionEvidence(OPERATION_ID))
      .resolves.toMatchObject({ state: "complete" });
    await expect(lstat(input.project.projectDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readdir(input.config.tombstonesRoot)).resolves.toEqual([]);
    await expect(readdir(input.config.recoveryRoot)).resolves.toEqual([]);
  });

  it("resumes only an exact operation, secret hash, and revision tuple", async () => {
    const input = await fixture();
    const pausing = new ManagedProjectLifecycleService(input.config, input.registry, {
      failpoint: (point) => {
        if (point === "after-reservation") throw new Error("pause after reservation");
      },
    });
    await expect(pausing.permanentlyDelete(request(input))).rejects.toThrow(/pause after reservation/i);
    const resumed = new ManagedProjectLifecycleService(input.config, input.registry);

    await expect(resumed.permanentlyDelete({
      ...request(input), statusSecretHash: "3".repeat(64),
    })).rejects.toThrow(/conflicting deletion operation/i);
    await expect(resumed.permanentlyDelete({
      ...request(input), expectedProjectRevision: "4".repeat(64),
    })).rejects.toThrow(/conflicting deletion operation/i);
    await expect(resumed.permanentlyDelete({
      ...request(input), operationId: "operation_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    })).rejects.toThrow(/conflicting deletion operation/i);
    await expect(resumed.permanentlyDelete(request(input))).resolves.toMatchObject({ state: "complete" });
    await expect(resumed.permanentlyDelete({
      ...request(input), expectedProjectRevision: "4".repeat(64),
    })).rejects.toThrow(/conflicting deletion operation/i);
  });

  it("authorizes operation status by exact operation and secret hash after session invalidation", async () => {
    const input = await fixture();
    const lifecycle = new ManagedProjectLifecycleService(input.config, input.registry, {
      failpoint: (point) => {
        if (point === "after-reservation") throw new Error("lost delete response");
      },
    });
    await expect(lifecycle.permanentlyDelete(request(input))).rejects.toThrow(/lost delete response/i);

    const restarted = new ManagedProjectLifecycleService(input.config, input.registry);
    await expect(restarted.reconcileDeletionOperation({
      operationId: OPERATION_ID,
      statusSecretHash: "3".repeat(64),
    })).resolves.toBeUndefined();
    await expect(restarted.reconcileDeletionOperation({
      operationId: "operation_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      statusSecretHash: STATUS_SECRET_HASH,
    })).resolves.toBeUndefined();
    await expect(restarted.reconcileDeletionOperation({
      operationId: OPERATION_ID,
      statusSecretHash: STATUS_SECRET_HASH,
    })).resolves.toMatchObject({ state: "complete", projectRevision: input.projectRevision });
    expect(input.registry.peek(input.session.descriptor.sessionId)).toBeUndefined();
  });

  it("holds managed reads ahead of deletion admission and rejects reads that start after admission", async () => {
    const input = await fixture();
    let releaseRead!: () => void;
    const readCanFinish = new Promise<void>((resolve) => { releaseRead = resolve; });
    let readStarted!: () => void;
    const readDidStart = new Promise<void>((resolve) => { readStarted = resolve; });
    const reading = withManagedProjectReadGuard(input.session, async (lifecycleLock) => {
      readStarted();
      await readCanFinish;
      await input.repository.open(input.project.id, lifecycleLock);
      return readFile(input.project.projectPath, "utf8");
    }, { config: input.config });
    await readDidStart;

    let reservationReached = false;
    const deleting = new ManagedProjectLifecycleService(input.config, input.registry, {
      failpoint: (point) => { if (point === "after-reservation") reservationReached = true; },
    }).permanentlyDelete(request(input));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(reservationReached).toBe(false);

    releaseRead();
    await expect(reading).resolves.toContain("Managed");
    await expect(deleting).resolves.toMatchObject({ state: "complete" });
    await expect(withManagedProjectReadGuard(input.session, async () => "read", {
      config: input.config,
    })).rejects.toThrow(/lifecycle changed/i);
  });

  it("rejects a lifecycle proof acquired for the same project id under another storage root", async () => {
    const input = await fixture();
    const foreignRoot = await mkdtemp(join(tmpdir(), "managed-project-foreign-lock-"));
    roots.push(foreignRoot);
    const foreignConfig = resolveManagedProjectStorageConfig({
      SCREENSHOT_STUDIO_DATA_ROOT: foreignRoot,
    });
    const foreignLock = await acquireManagedProjectLifecycleLock(foreignConfig, input.project.id);

    await expect(input.repository.open(input.project.id, foreignLock))
      .rejects.toThrow(/matching managed project lifecycle lock/i);
    await foreignLock.release();
    await expect(readFile(input.project.projectPath, "utf8")).resolves.toContain("Managed");
  });

  it("rejects a lifecycle proof acquired from another lock namespace in the same storage root", async () => {
    const input = await fixture();
    const alternateConfig = {
      ...input.config,
      lifecycleLocksRoot: join(input.config.root, "alternate-lifecycle-locks"),
    };
    const alternateLock = await acquireManagedProjectLifecycleLock(alternateConfig, input.project.id);

    await expect(input.repository.open(input.project.id, alternateLock))
      .rejects.toThrow(/matching managed project lifecycle lock/i);
    await alternateLock.release();
    await expect(readFile(input.project.projectPath, "utf8")).resolves.toContain("Managed");
  });

  it("fails closed when the reserved source identity is replaced before recovery", async () => {
    const input = await fixture();
    const lifecycle = new ManagedProjectLifecycleService(input.config, input.registry, {
      failpoint: (point) => {
        if (point === "after-reservation") throw new Error("pause after reservation");
      },
    });
    await expect(lifecycle.permanentlyDelete(request(input))).rejects.toThrow(/pause after reservation/i);
    const original = join(input.config.root, "original-project");
    await rename(input.project.projectDirectory, original);
    await mkdir(input.project.projectDirectory);
    await writeFile(input.project.projectPath, projectJson("Replacement"));

    await expect(new ManagedProjectLifecycleService(input.config, input.registry).reconcileAll())
      .rejects.toThrow(/identity changed/i);
    await expect(readFile(join(original, "resource.txt"), "utf8")).resolves.toBe("keep until delete");
    await expect(readFile(input.project.projectPath, "utf8")).resolves.toContain("Replacement");
  });

  it("fails closed when the tombstone identity is replaced before recovery", async () => {
    const input = await fixture();
    const lifecycle = new ManagedProjectLifecycleService(input.config, input.registry, {
      failpoint: (point) => {
        if (point === "after-catalog-commit") throw new Error("pause after catalog commit");
      },
    });
    await expect(lifecycle.permanentlyDelete(request(input))).rejects.toThrow(/pause after catalog commit/i);
    const [tombstoneName] = await readdir(input.config.tombstonesRoot);
    const tombstone = join(input.config.tombstonesRoot, tombstoneName!);
    const original = join(input.config.root, "original-tombstone");
    await rename(tombstone, original);
    await mkdir(tombstone);
    await writeFile(join(tombstone, "app-store-screenshots.json"), projectJson("Replacement"));

    await expect(new ManagedProjectLifecycleService(input.config, input.registry).reconcileAll())
      .rejects.toThrow(/tombstone no longer matches recovery intent/i);
    await expect(readFile(join(original, "resource.txt"), "utf8")).resolves.toBe("keep until delete");
    await expect(readFile(join(tombstone, "app-store-screenshots.json"), "utf8"))
      .resolves.toContain("Replacement");
    await expect(new ManagedProjectCatalogStore(input.config).getDeletionEvidence(OPERATION_ID))
      .resolves.toMatchObject({ state: "cleanup-pending" });
    await expect(readdir(input.config.recoveryRoot)).resolves.toHaveLength(1);
  });

  it("rejects a forged pending intent and preserves its tombstone", async () => {
    const input = await fixture();
    const lifecycle = new ManagedProjectLifecycleService(input.config, input.registry, {
      failpoint: (point) => {
        if (point === "after-catalog-commit") throw new Error("pause after catalog commit");
      },
    });
    await expect(lifecycle.permanentlyDelete(request(input))).rejects.toThrow(/pause after catalog commit/i);
    const intentPath = join(input.config.recoveryRoot, `${input.project.id}.json`);
    const intent = JSON.parse(await readFile(intentPath, "utf8")) as Record<string, unknown>;
    intent.unknown = true;
    await writeFile(intentPath, `${JSON.stringify(intent, null, 2)}\n`);

    await expect(new ManagedProjectLifecycleService(input.config, input.registry).reconcileAll())
      .rejects.toThrow(/intent properties/i);
    await expect(readdir(input.config.tombstonesRoot)).resolves.toHaveLength(1);
    await expect(new ManagedProjectCatalogStore(input.config).getDeletionEvidence(OPERATION_ID))
      .resolves.toMatchObject({ state: "cleanup-pending" });
  });

  it("reports an orphan delete intent without catalog evidence", async () => {
    const input = await fixture();
    await writeFile(join(input.config.recoveryRoot, `${input.project.id}.json`), `${JSON.stringify({
      version: 1,
      operation: "delete",
      operationId: OPERATION_ID,
      id: input.project.id,
    })}\n`);

    await expect(new ManagedProjectLifecycleService(input.config, input.registry).reconcileAll())
      .rejects.toThrow(/orphan|evidence/i);
    await expect(readFile(input.project.projectPath, "utf8")).resolves.toContain("Managed");
  });

  it("keeps ordinary repository reads fenced while a deletion intent is pending", async () => {
    const input = await fixture();
    const lifecycle = new ManagedProjectLifecycleService(input.config, input.registry, {
      failpoint: (point) => {
        if (point === "after-intent") throw new Error("pause with intent");
      },
    });
    await expect(lifecycle.permanentlyDelete(request(input))).rejects.toThrow(/pause with intent/i);

    await expect(new ManagedProjectRepository(input.config).open(input.project.id))
      .rejects.toBeInstanceOf(ManagedProjectNotFoundError);
  });

  it("runs deletion recovery during ordinary repository initialization", async () => {
    const input = await fixture();
    const lifecycle = new ManagedProjectLifecycleService(input.config, input.registry, {
      failpoint: (point) => {
        if (point === "after-catalog-commit") throw new Error("simulated process exit");
      },
    });
    await expect(lifecycle.permanentlyDelete(request(input))).rejects.toThrow(/process exit/i);

    await expect(new ManagedProjectRepository(input.config).initialize()).resolves.toBeUndefined();
    await expect(new ManagedProjectCatalogStore(input.config).getDeletionEvidence(OPERATION_ID))
      .resolves.toMatchObject({ state: "complete", projectRevision: input.projectRevision });
    await expect(readdir(input.config.tombstonesRoot)).resolves.toEqual([]);
    await expect(readdir(input.config.recoveryRoot)).resolves.toEqual([]);
  });

  it("rejects non-adjacent journal, catalog, and directory states without deleting evidence", async () => {
    const cases = [
      { failpoint: "after-intent" as const, phase: "catalog-removed", evidence: "reserved" },
      { failpoint: "after-catalog-commit" as const, phase: "prepared", evidence: "cleanup-pending" },
      { failpoint: "after-catalog-journal" as const, phase: "tombstone-removed", evidence: "cleanup-pending" },
      { failpoint: "after-catalog-journal" as const, phase: null, evidence: "cleanup-pending" },
    ];
    for (const testCase of cases) {
      const input = await fixture();
      const lifecycle = new ManagedProjectLifecycleService(input.config, input.registry, {
        failpoint: (point) => {
          if (point === testCase.failpoint) throw new Error(`pause at ${point}`);
        },
      });
      await expect(lifecycle.permanentlyDelete(request(input))).rejects.toThrow(/pause at/i);
      const intentPath = join(input.config.recoveryRoot, `${input.project.id}.json`);
      if (testCase.phase === null) {
        await rm(intentPath);
      } else {
        const intent = JSON.parse(await readFile(intentPath, "utf8")) as Record<string, unknown>;
        intent.phase = testCase.phase;
        await writeFile(intentPath, `${JSON.stringify(intent, null, 2)}\n`);
      }
      const directoriesBefore = await readdir(input.config.tombstonesRoot);

      await expect(new ManagedProjectLifecycleService(input.config, input.registry).reconcileAll())
        .rejects.toThrow(/phase|directory state|inconsistent/i);
      await expect(new ManagedProjectCatalogStore(input.config).getDeletionEvidence(OPERATION_ID))
        .resolves.toMatchObject({ state: testCase.evidence });
      await expect(readdir(input.config.tombstonesRoot)).resolves.toEqual(directoriesBefore);
    }
  });

  it.each([
    "after-reservation",
    "after-intent",
    "after-directory-move",
    "after-quarantined-journal",
    "after-catalog-commit",
    "after-catalog-journal",
    "after-session-invalidation",
    "after-tombstone-removal",
    "after-tombstone-journal",
    "after-intent-removal",
  ] as const)("recovers forward after the %s boundary fails", async (failurePoint) => {
    const input = await fixture();
    let injected = false;
    const lifecycle = new ManagedProjectLifecycleService(input.config, input.registry, {
      failpoint: async (point) => {
        if (!injected && point === failurePoint) {
          injected = true;
          throw new Error(`injected ${point} failure`);
        }
      },
    });

    await expect(lifecycle.permanentlyDelete(request(input)))
      .rejects.toThrow(`injected ${failurePoint} failure`);
    const restarted = new ManagedProjectLifecycleService(input.config, input.registry);
    await restarted.reconcileAll();

    await expect(new ManagedProjectCatalogStore(input.config).getDeletionEvidence(OPERATION_ID))
      .resolves.toMatchObject({ state: "complete", projectId: input.project.id });
    await expect(lstat(input.project.projectDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readdir(input.config.tombstonesRoot)).resolves.toEqual([]);
    await expect(readdir(input.config.recoveryRoot)).resolves.toEqual([]);
  });
});
