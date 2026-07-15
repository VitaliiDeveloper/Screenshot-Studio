// SPDX-License-Identifier: Apache-2.0
import { access, lstat, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  ProjectRevisionConflictError,
  projectMutationLockPath,
  type ProjectFileDependencies,
  type ProjectLockOptions,
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
    const lockWaiters: Array<() => void> = [];
    let lockWaitStarted!: () => void;
    const lockDidWait = new Promise<void>((resolve) => { lockWaitStarted = resolve; });
    let secondEntered!: () => void;
    const secondDidEnter = new Promise<void>((resolve) => { secondEntered = resolve; });
    const lockOptions: ProjectLockOptions = {
      timeoutMs: 500,
      staleAfterMs: 10_000,
      dependencies: {
        sleep: () => {
          lockWaitStarted();
          return new Promise<void>((resolve) => lockWaiters.push(resolve));
        },
        scheduleHeartbeat: () => () => undefined,
      },
    };

    const first = updateProjectFile(projectPath, async (project) => {
      firstEntered();
      await firstMayFinish;
      return {
        project: { ...project, meta: { ...project.meta, name: "First mutation" } },
        value: "first",
      };
    }, lockOptions);
    await firstDidEnter;

    const second = updateProjectFile(aliasPath, (project) => {
      secondEntered();
      return {
        project: {
          ...project,
          screens: project.screens.map((screen, index) => index === 0
            ? { ...screen, background: { type: "solid" as const, color: "#000000" } }
            : screen),
        },
        value: "second",
      };
    }, lockOptions);
    const secondState = await Promise.race([
      lockDidWait.then(() => "waited" as const),
      secondDidEnter.then(() => "entered" as const),
    ]);
    releaseFirst();
    await first;
    lockWaiters.splice(0).forEach((resolve) => resolve());
    const secondResult = await second;

    expect(secondState).toBe("waited");
    expect(secondResult.value).toBe("second");
    expect(secondResult.revision).toMatch(/^[a-f0-9]{64}$/);
    expect((await lstat(aliasPath)).isSymbolicLink()).toBe(true);
    await expect(access(projectMutationLockPath(projectPath))).resolves.toBeUndefined();
    await expect(access(projectMutationLockPath(aliasPath))).rejects.toMatchObject({ code: "ENOENT" });
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
