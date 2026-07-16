// SPDX-License-Identifier: Apache-2.0
import { access, lstat, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  ProjectRevisionConflictError,
  projectMutationLockPath,
  type ProjectFileDependencies,
} from "@screenshot-studio/core/storage";
import type { Project } from "@screenshot-studio/core/model";
import {
  DEFAULT_PROJECT_FILENAME,
  loadProjectFile,
  loadProjectSnapshot,
  resolveProjectPath,
  updateProjectFile,
  writeProjectFile,
} from "./project-io.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "screenshot-studio-project-io-"));
  temporaryRoots.push(directory);
  return directory;
}

function sampleProject(): Project {
  return {
    meta: { name: "CLI Project", schemaVersion: 1 },
    mode: "isolated",
    platforms: ["apple"],
    locales: ["en"],
    fonts: [],
    screens: [
      {
        id: "hero",
        name: "Hero",
        platform: "apple",
        device: "iphone",
        locale: "en",
        direction: "ltr",
        artboard: { width: 1320, height: 2868 },
        background: { type: "solid", color: "#101827" },
        elements: [],
      },
    ],
  };
}

describe("project IO", () => {
  it("resolves the canonical project filename by default", () => {
    expect(DEFAULT_PROJECT_FILENAME).toBe("app-store-screenshots.json");
    expect(resolveProjectPath({})).toBe(resolve(DEFAULT_PROJECT_FILENAME));
  });

  it("loads a strict project JSON file", async () => {
    const dir = await temporaryDirectory();
    const projectPath = join(dir, "app-store-screenshots.json");
    const project = sampleProject();
    await writeFile(projectPath, JSON.stringify(project), "utf8");

    await expect(loadProjectFile(projectPath)).resolves.toEqual(project);
  });

  it("writes pretty project JSON with a trailing newline", async () => {
    const dir = await temporaryDirectory();
    const projectPath = join(dir, "app-store-screenshots.json");

    await writeProjectFile(projectPath, sampleProject());

    const text = await readFile(projectPath, "utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(text).toContain('  "screens": [');
    await expect(loadProjectFile(projectPath)).resolves.toEqual(sampleProject());
  });

  it("writes through a symlink alias without replacing the symlink", async () => {
    const dir = await temporaryDirectory();
    const projectPath = join(dir, "app-store-screenshots.json");
    const aliasPath = join(dir, "project-alias.json");
    await writeFile(projectPath, JSON.stringify(sampleProject()), "utf8");
    await symlink(projectPath, aliasPath);
    const renamed = sampleProject();
    renamed.meta.name = "Written through alias";

    await writeProjectFile(aliasPath, renamed);

    expect((await lstat(aliasPath)).isSymbolicLink()).toBe(true);
    expect(JSON.parse(await readFile(projectPath, "utf8"))).toMatchObject({
      meta: { name: "Written through alias" },
    });
  });

  it("does not erase a regular project atomically replaced after writeProjectFile observes it", async () => {
    const dir = await temporaryDirectory();
    const projectPath = join(dir, "app-store-screenshots.json");
    const competitorStage = join(dir, ".cli-winner.tmp");
    await writeProjectFile(projectPath, sampleProject());
    const cliWinner = sampleProject();
    cliWinner.meta.name = "Concurrent CLI winner";
    const cliBytes = `${JSON.stringify(cliWinner, null, 2)}\n`;
    await writeFile(competitorStage, cliBytes);
    const editorLoser = sampleProject();
    editorLoser.meta.name = "Observed writer loser";

    await expect(writeProjectFile(projectPath, editorLoser, {
      beforeDestinationRevalidation: async () => {
        await rename(competitorStage, projectPath);
      },
    } as ProjectFileDependencies)).rejects.toBeInstanceOf(ProjectRevisionConflictError);

    expect(await readFile(projectPath, "utf8")).toBe(cliBytes);
  });

  it("does not replace a dangling symlink introduced after missing-file classification", async () => {
    const dir = await temporaryDirectory();
    const projectPath = join(dir, "app-store-screenshots.json");
    const missingTarget = join(dir, "missing-target.json");

    await expect(writeProjectFile(projectPath, sampleProject(), {
      beforeCreatePublication: async () => {
        await symlink(missingTarget, projectPath);
      },
    } as ProjectFileDependencies)).rejects.toMatchObject({ code: "EEXIST" });

    expect((await lstat(projectPath)).isSymbolicLink()).toBe(true);
    await expect(readFile(projectPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recovers a committed create after stage cleanup fails and keeps it mutable", async () => {
    const dir = await temporaryDirectory();
    const projectPath = join(dir, "app-store-screenshots.json");
    const stagePath = join(
      dir,
      ".app-store-screenshots.json.90957ba2-ce0f-4873-b075-c64b47353393.tmp",
    );
    const intentPath = join(
      dir,
      ".app-store-screenshots.json.90957ba2-ce0f-4873-b075-c64b47353393.create-intent.json",
    );
    const remove = async () => { throw new Error("stage cleanup failed"); };

    await writeProjectFile(projectPath, sampleProject(), {
      randomId: () => "90957ba2-ce0f-4873-b075-c64b47353393",
      remove,
    });

    await expect(lstat(intentPath)).resolves.toBeDefined();
    await expect(loadProjectFile(projectPath)).resolves.toEqual(sampleProject());
    await expect(lstat(stagePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(intentPath)).rejects.toMatchObject({ code: "ENOENT" });
    const updated = sampleProject();
    updated.meta.name = "Recovered and mutable";
    await writeProjectFile(projectPath, updated);
    await expect(loadProjectFile(projectPath)).resolves.toEqual(updated);
  });

  it("loads a project together with its exact persisted revision", async () => {
    const dir = await temporaryDirectory();
    const projectPath = join(dir, "app-store-screenshots.json");
    await writeProjectFile(projectPath, sampleProject());

    const snapshot = await loadProjectSnapshot(projectPath);
    expect(snapshot.project).toEqual(sampleProject());
    expect(snapshot.revision).toMatch(/^[a-f0-9]{64}$/);
  });

  it("runs registered rollbacks in reverse order after the updater fails", async () => {
    const dir = await temporaryDirectory();
    const projectPath = join(dir, "app-store-screenshots.json");
    await writeProjectFile(projectPath, sampleProject());
    const primary = new Error("updater failed");
    const order: string[] = [];

    await expect(updateProjectFile(projectPath, (_project, transaction) => {
      transaction.onRollback(() => { order.push("first"); });
      transaction.onRollback(async () => {
        await Promise.resolve();
        order.push("second");
      });
      throw primary;
    })).rejects.toBe(primary);

    expect(order).toEqual(["second", "first"]);
  });

  it("retains a falsy primary and every rollback failure in execution order", async () => {
    const dir = await temporaryDirectory();
    const projectPath = join(dir, "app-store-screenshots.json");
    await writeProjectFile(projectPath, sampleProject());
    const firstCleanup = new Error("first cleanup failed");
    const secondCleanup = new Error("second cleanup failed");
    const order: string[] = [];

    const caught = await updateProjectFile(projectPath, (_project, transaction) => {
      transaction.onRollback(() => {
        order.push("first");
        throw firstCleanup;
      });
      transaction.onRollback(() => {
        order.push("second");
        throw secondCleanup;
      });
      throw undefined;
    }).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([
      undefined,
      secondCleanup,
      firstCleanup,
    ]);
    expect(order).toEqual(["second", "first"]);
  });

  it("never runs registered rollback after a successful update", async () => {
    const dir = await temporaryDirectory();
    const projectPath = join(dir, "app-store-screenshots.json");
    await writeProjectFile(projectPath, sampleProject());
    let rollbackCalls = 0;

    const result = await updateProjectFile(projectPath, (project, transaction) => {
      transaction.onRollback(() => { rollbackCalls += 1; });
      return {
        project: { ...project, meta: { ...project.meta, name: "Successful update" } },
        value: "success",
      };
    });

    expect(result.value).toBe("success");
    expect(rollbackCalls).toBe(0);
    expect((await loadProjectFile(projectPath)).meta.name).toBe("Successful update");
  });

  it("treats the identical project object as a no-op without rewriting exact bytes", async () => {
    const dir = await temporaryDirectory();
    const projectPath = join(dir, "app-store-screenshots.json");
    const exactBytes = `${JSON.stringify(sampleProject())}  \n`;
    await writeFile(projectPath, exactBytes, "utf8");
    const before = await loadProjectSnapshot(projectPath);
    let updaterProject: Project | undefined;
    let writerCalled = false;

    const result = await updateProjectFile(projectPath, (project) => {
      updaterProject = project;
      return { project, value: "no-op" };
    }, {}, {
      beforeDestinationRevalidation: async () => {
        writerCalled = true;
        throw new Error("writer must not run for identity no-op");
      },
    } as ProjectFileDependencies);

    expect(writerCalled).toBe(false);
    expect(result.project).toBe(updaterProject);
    expect(result.revision).toBe(before.revision);
    expect(result.value).toBe("no-op");
    expect(await readFile(projectPath, "utf8")).toBe(exactBytes);
  });

  it("completes write-failure rollback before a queued mutation enters", async () => {
    const dir = await temporaryDirectory();
    const projectPath = join(dir, "app-store-screenshots.json");
    await writeProjectFile(projectPath, sampleProject());
    const writeFailure = new Error("project write failed");
    let releaseRollback!: () => void;
    const rollbackMayFinish = new Promise<void>((resolve) => { releaseRollback = resolve; });
    let rollbackEntered!: () => void;
    const rollbackDidEnter = new Promise<void>((resolve) => { rollbackEntered = resolve; });
    const events: string[] = [];

    const first = updateProjectFile(projectPath, (project, transaction) => {
      transaction.onRollback(async () => {
        events.push("rollback-started");
        rollbackEntered();
        await rollbackMayFinish;
        events.push("rollback-finished");
      });
      return {
        project: { ...project, meta: { ...project.meta, name: "Must roll back" } },
        value: "first",
      };
    }, {}, {
      beforeDestinationRevalidation: async () => { throw writeFailure; },
    } as ProjectFileDependencies);
    const firstSettled = first.then(
      () => ({ status: "fulfilled" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    const rollbackState = await Promise.race([
      rollbackDidEnter.then(() => "entered" as const),
      firstSettled.then(() => "first-settled" as const),
    ]);
    expect(rollbackState).toBe("entered");

    let secondEntered = false;
    const second = updateProjectFile(projectPath, (project) => {
      events.push("second-entered");
      secondEntered = true;
      return {
        project: { ...project, meta: { ...project.meta, name: "Queued update" } },
        value: "second",
      };
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(secondEntered).toBe(false);
    expect(events).toEqual(["rollback-started"]);
    releaseRollback();
    await expect(firstSettled).resolves.toEqual({ status: "rejected", error: writeFailure });
    await second;

    expect(events).toEqual(["rollback-started", "rollback-finished", "second-entered"]);
    expect((await loadProjectFile(projectPath)).meta.name).toBe("Queued update");
  });

  it("serializes concurrent read-modify-write operations without losing either change", async () => {
    const dir = await temporaryDirectory();
    const projectPath = join(dir, "app-store-screenshots.json");
    const aliasPath = join(dir, "project-alias.json");
    await writeProjectFile(projectPath, sampleProject());
    await symlink(projectPath, aliasPath);

    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstEntered!: () => void;
    const firstDidEnter = new Promise<void>((resolve) => { firstEntered = resolve; });

    const first = updateProjectFile(projectPath, async (project) => {
      firstEntered();
      await firstMayFinish;
      return {
        project: { ...project, meta: { ...project.meta, name: "First mutation" } },
        value: "first",
      };
    });
    await firstDidEnter;

    let secondEntered = false;
    const second = updateProjectFile(aliasPath, (project) => {
      secondEntered = true;
      return {
        project: {
          ...project,
          screens: project.screens.map((screen, index) => index === 0
            ? { ...screen, background: { type: "solid" as const, color: "#000000" } }
            : screen),
        },
        value: "second",
      };
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(secondEntered).toBe(false);

    releaseFirst();
    await first;
    const secondResult = await second;

    expect(secondResult.value).toBe("second");
    expect(secondResult.revision).toMatch(/^[a-f0-9]{64}$/);
    expect((await lstat(aliasPath)).isSymbolicLink()).toBe(true);
    expect(projectMutationLockPath(aliasPath)).toBe(projectMutationLockPath(projectPath));
    await expect(access(projectMutationLockPath(projectPath))).rejects.toMatchObject({ code: "ENOENT" });
    const final = await loadProjectFile(projectPath);
    expect(final.meta.name).toBe("First mutation");
    expect(final.screens[0]!.background).toEqual({ type: "solid", color: "#000000" });
  });

  it("does not erase an atomic writer that lands after updateProjectFile reads", async () => {
    const dir = await temporaryDirectory();
    const projectPath = join(dir, "app-store-screenshots.json");
    const competitorStage = join(dir, ".uncoordinated-cli.tmp");
    await writeProjectFile(projectPath, sampleProject());
    const cliWinner = sampleProject();
    cliWinner.meta.name = "Uncoordinated CLI winner";
    const cliBytes = `${JSON.stringify(cliWinner, null, 2)}\n`;
    await writeFile(competitorStage, cliBytes);

    await expect(updateProjectFile(projectPath, (current) => ({
      project: { ...current, meta: { ...current.meta, name: "Coordinated loser" } },
      value: undefined,
    }), {}, {
      beforeDestinationRevalidation: async () => {
        await rename(competitorStage, projectPath);
      },
    } as ProjectFileDependencies)).rejects.toBeInstanceOf(ProjectRevisionConflictError);

    expect(await readFile(projectPath, "utf8")).toBe(cliBytes);
  });
});
