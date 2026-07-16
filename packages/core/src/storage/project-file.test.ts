// SPDX-License-Identifier: Apache-2.0
import { constants } from "node:fs";
import { link, lstat, mkdtemp, open, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../model/index.js";
import {
  ProjectRevisionConflictError,
  projectRevision,
  readIdentifiedProjectSnapshot,
  readProjectSnapshot,
  serializeProject,
  writeProjectAtomic,
  type IdentifiedProjectSnapshot,
  type ProjectFileDependencies,
  type ProjectSnapshot,
} from "./project-file.js";
import * as projectFileModule from "./project-file.js";
import { resolveExistingProjectPath } from "./project-path.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function project(name = "Snapshot"): Project {
  return {
    meta: { name, schemaVersion: 1 },
    mode: "isolated",
    platforms: ["apple"],
    locales: ["en"],
    fonts: [],
    screens: [{
      id: "hero",
      name: "Hero",
      platform: "apple",
      device: "iphone",
      locale: "en",
      direction: "ltr",
      artboard: { width: 1320, height: 2868 },
      background: { type: "solid", color: "#FFFFFF" },
      elements: [],
    }],
  };
}

async function workspace(prefix: string): Promise<{ directory: string; projectPath: string }> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(directory);
  return { directory, projectPath: join(directory, "app-store-screenshots.json") };
}

async function capturedRejection(promise: Promise<unknown>): Promise<{ rejected: boolean; reason: unknown }> {
  try {
    await promise;
    return { rejected: false, reason: undefined };
  } catch (reason) {
    return { rejected: true, reason };
  }
}

function creationStagePath(directory: string, token: string): string {
  return join(directory, `.app-store-screenshots.json.${token}.tmp`);
}

function creationIntentPath(directory: string, token: string): string {
  return join(directory, `.app-store-screenshots.json.${token}.create-intent.json`);
}

async function writeCreationIntent(
  projectPath: string,
  stagePath: string,
  token: string,
  bytes: string,
  overrides: { revision?: string; inode?: string } = {},
): Promise<string> {
  const stageStats = await stat(stagePath, { bigint: true });
  const intentPath = creationIntentPath(dirname(projectPath), token);
  const intent = {
    version: 1,
    token,
    projectFile: basename(projectPath),
    stageFile: basename(stagePath),
    revision: overrides.revision ?? projectRevision(bytes),
    identity: {
      device: stageStats.dev.toString(),
      inode: overrides.inode ?? stageStats.ino.toString(),
    },
  };
  await writeFile(intentPath, `${JSON.stringify(intent)}\n`);
  return intentPath;
}

type ConditionalProjectWriter = (
  projectPath: string,
  nextProject: Project,
  expected: IdentifiedProjectSnapshot,
  dependencies?: ProjectFileDependencies,
) => Promise<ProjectSnapshot>;

type ProjectCreator = (
  projectPath: string,
  nextProject: Project,
  dependencies?: ProjectFileDependencies,
) => Promise<ProjectSnapshot>;

function conditionalProjectWriter(): ConditionalProjectWriter {
  const writer = (projectFileModule as unknown as {
    writeProjectConditionalAtomic?: ConditionalProjectWriter;
  }).writeProjectConditionalAtomic;
  expect(writer).toBeTypeOf("function");
  return writer!;
}

function projectCreator(): ProjectCreator {
  const creator = (projectFileModule as unknown as {
    createProjectAtomic?: ProjectCreator;
  }).createProjectAtomic;
  expect(creator).toBeTypeOf("function");
  return creator!;
}

describe("project-file", () => {
  it("serializes deterministically and hashes the exact persisted bytes", () => {
    const bytes = `${JSON.stringify(project(), null, 2)}\n`;
    expect(serializeProject(project())).toBe(bytes);
    expect(projectRevision(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(projectRevision(new TextEncoder().encode(bytes))).toBe(projectRevision(bytes));
  });

  it("reads, parses, and hashes one exact project snapshot", async () => {
    const { projectPath } = await workspace("project-snapshot-read-");
    const bytes = `${JSON.stringify(project("Exact bytes"), null, 2)}\n`;
    await writeFile(projectPath, bytes);

    await expect(readProjectSnapshot(projectPath)).resolves.toEqual({
      project: project("Exact bytes"),
      revision: createHash("sha256").update(bytes).digest("hex"),
    });
  });

  it("returns the stable device and inode inspected from the same opened snapshot handle", async () => {
    const { projectPath } = await workspace("project-snapshot-identity-");
    await writeFile(projectPath, serializeProject(project("Identified")));

    const snapshot = await readIdentifiedProjectSnapshot(projectPath);
    const fileStats = await stat(projectPath, { bigint: true });

    expect(snapshot).toMatchObject({
      project: project("Identified"),
      identity: { device: fileStats.dev, inode: fileStats.ino },
    });
    expect(typeof snapshot.identity.device).toBe("bigint");
    expect(typeof snapshot.identity.inode).toBe("bigint");
  });

  it("preserves an undefined rejection from the opened snapshot handle", async () => {
    const { projectPath } = await workspace("project-snapshot-undefined-error-");
    await writeFile(projectPath, serializeProject(project("Observed")));

    const outcome = await capturedRejection(readIdentifiedProjectSnapshot(projectPath, {
      openSnapshot: async (path, flags) => {
        const handle = await open(path, flags);
        return {
          stat: handle.stat.bind(handle),
          readFile: async () => { throw undefined; },
          close: handle.close.bind(handle),
        };
      },
    }));

    expect(outcome).toEqual({ rejected: true, reason: undefined });
  });

  it("hashes the original bytes when UTF-8 decoding replaces invalid string data", async () => {
    const { projectPath } = await workspace("project-snapshot-raw-bytes-");
    const bytes = Buffer.from(serializeProject(project("Raw X bytes")));
    const invalidByteIndex = bytes.indexOf("X");
    bytes[invalidByteIndex] = 0xff;
    await writeFile(projectPath, bytes);

    await expect(readProjectSnapshot(projectPath)).resolves.toEqual({
      project: project("Raw � bytes"),
      revision: createHash("sha256").update(bytes).digest("hex"),
    });
  });

  it("does not follow a symlink swapped in after canonical path resolution", async () => {
    const { directory, projectPath } = await workspace("project-snapshot-symlink-swap-");
    const outsidePath = join(directory, "outside.json");
    const displacedPath = join(directory, "displaced.json");
    const outsideBytes = serializeProject(project("Outside sentinel"));
    await writeFile(projectPath, serializeProject(project("Observed")));
    await writeFile(outsidePath, outsideBytes);
    const canonicalPath = await resolveExistingProjectPath(projectPath);
    await expect(readIdentifiedProjectSnapshot(canonicalPath, {
      beforeSnapshotOpen: async () => {
        await rename(projectPath, displacedPath);
        await symlink(outsidePath, projectPath);
      },
    })).rejects.toThrow(/symbolic link|no.follow/i);

    expect(await readFile(outsidePath, "utf8")).toBe(outsideBytes);
  });

  it("rejects a named-path rebound after recovery before reading snapshot bytes", async () => {
    const { directory, projectPath } = await workspace("project-snapshot-post-recovery-swap-");
    const displacedPath = join(directory, "displaced.json");
    const outsidePath = join(directory, "outside.json");
    const outsideBytes = serializeProject(project("Outside sentinel"));
    await writeFile(projectPath, serializeProject(project("Observed")));
    await writeFile(outsidePath, outsideBytes);
    let statCalls = 0;
    let readAttempted = false;

    await expect(readIdentifiedProjectSnapshot(projectPath, {
      openSnapshot: async (path, flags) => {
        const handle = await open(path, flags);
        return {
          stat: async (options) => {
            statCalls += 1;
            if (statCalls === 2) {
              await rename(projectPath, displacedPath);
              await symlink(outsidePath, projectPath);
            }
            return handle.stat(options);
          },
          readFile: async () => {
            readAttempted = true;
            return handle.readFile();
          },
          close: handle.close.bind(handle),
        };
      },
    })).rejects.toThrow(/changed|symbolic link/i);

    expect(readAttempted).toBe(false);
    expect(await readFile(outsidePath, "utf8")).toBe(outsideBytes);
  });

  it("rejects an atomic replacement after the observed snapshot and preserves the newer bytes", async () => {
    const { directory, projectPath } = await workspace("project-conditional-atomic-swap-");
    const competitorStage = join(directory, ".competitor.tmp");
    const beforeBytes = serializeProject(project("Observed"));
    const competitorBytes = serializeProject(project("CLI winner"));
    await writeFile(projectPath, beforeBytes);
    await writeFile(competitorStage, competitorBytes);
    const observed = await readIdentifiedProjectSnapshot(projectPath);

    await expect(conditionalProjectWriter()(projectPath, project("Editor loser"), observed, {
      beforeDestinationRevalidation: async () => {
        await rename(competitorStage, projectPath);
      },
    } as ProjectFileDependencies)).rejects.toMatchObject({
      name: "ProjectRevisionConflictError",
      expected: projectRevision(beforeBytes),
      actual: projectRevision(competitorBytes),
    });

    expect(await readFile(projectPath, "utf8")).toBe(competitorBytes);
    expect(await readdir(directory)).toEqual(["app-store-screenshots.json"]);
  });

  it("rejects an in-place byte change after the observed snapshot and preserves the newer bytes", async () => {
    const { directory, projectPath } = await workspace("project-conditional-in-place-");
    const beforeBytes = serializeProject(project("Observed"));
    const competitorBytes = serializeProject(project("In-place winner"));
    await writeFile(projectPath, beforeBytes);
    const observed = await readIdentifiedProjectSnapshot(projectPath);

    await expect(conditionalProjectWriter()(projectPath, project("Editor loser"), observed, {
      beforeDestinationRevalidation: async () => {
        await writeFile(projectPath, competitorBytes);
      },
    } as ProjectFileDependencies)).rejects.toBeInstanceOf(ProjectRevisionConflictError);

    expect(await readFile(projectPath, "utf8")).toBe(competitorBytes);
    expect(await readdir(directory)).toEqual(["app-store-screenshots.json"]);
  });

  it("rejects a symlink introduced before conditional replacement without following it", async () => {
    const { directory, projectPath } = await workspace("project-conditional-symlink-");
    const displacedPath = join(directory, "displaced.json");
    const outsidePath = join(directory, "outside.json");
    const outsideBytes = serializeProject(project("Outside sentinel"));
    await writeFile(projectPath, serializeProject(project("Observed")));
    await writeFile(outsidePath, outsideBytes);
    const observed = await readIdentifiedProjectSnapshot(projectPath);

    await expect(conditionalProjectWriter()(projectPath, project("Editor loser"), observed, {
      beforeDestinationRevalidation: async () => {
        await rename(projectPath, displacedPath);
        await symlink(outsidePath, projectPath);
      },
    } as ProjectFileDependencies)).rejects.toThrow(/symbolic link|no.follow/i);

    expect((await lstat(projectPath)).isSymbolicLink()).toBe(true);
    expect(await readFile(outsidePath, "utf8")).toBe(outsideBytes);
    expect((await readdir(directory)).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });

  it("uses no-replace publication when a dangling symlink appears before project creation", async () => {
    const { directory, projectPath } = await workspace("project-create-dangling-symlink-");
    const danglingTarget = join(directory, "missing-target.json");

    await expect(projectCreator()(projectPath, project("Creator"), {
      beforeCreatePublication: async () => {
        await symlink(danglingTarget, projectPath);
      },
    } as ProjectFileDependencies)).rejects.toMatchObject({ code: "EEXIST" });

    expect((await lstat(projectPath)).isSymbolicLink()).toBe(true);
    await expect(readFile(projectPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(directory)).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });

  it("preserves and rejects a same-inode UUID stage lookalike without an ownership intent", async () => {
    const { directory, projectPath } = await workspace("project-create-stage-lookalike-");
    const token = "2f791b2a-430c-49e1-a021-9a0b68da10f4";
    const stagePath = creationStagePath(directory, token);
    const bytes = serializeProject(project("User hard link"));
    await writeFile(projectPath, bytes);
    await link(projectPath, stagePath);
    expect((await stat(projectPath)).nlink).toBe(2);

    await expect(readIdentifiedProjectSnapshot(projectPath)).rejects.toThrow(/hard links/i);

    expect(await readFile(stagePath, "utf8")).toBe(bytes);
    expect((await stat(projectPath)).nlink).toBe(2);
  });

  it("recovers a genuine crash state only when its durable intent matches", async () => {
    const { directory, projectPath } = await workspace("project-create-crash-recovery-");
    const token = "e7f9f78a-42e8-4914-9910-4161d7f99c78";
    const stagePath = creationStagePath(directory, token);
    const bytes = serializeProject(project("Crash survivor"));
    await writeFile(projectPath, bytes);
    await link(projectPath, stagePath);
    const intentPath = await writeCreationIntent(projectPath, stagePath, token, bytes);

    await expect(readIdentifiedProjectSnapshot(projectPath)).resolves.toMatchObject({
      project: { meta: { name: "Crash survivor" } },
    });

    await expect(lstat(stagePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(intentPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(projectPath)).nlink).toBe(1);
  });

  it("fails closed and preserves a crash stage when its intent is malformed", async () => {
    const { directory, projectPath } = await workspace("project-create-malformed-intent-");
    const token = "9549a1f0-b311-4833-99b0-a884e841feee";
    const stagePath = creationStagePath(directory, token);
    const intentPath = creationIntentPath(directory, token);
    const bytes = serializeProject(project("Malformed intent"));
    await writeFile(projectPath, bytes);
    await link(projectPath, stagePath);
    await writeFile(intentPath, "{not-json\n");

    await expect(readIdentifiedProjectSnapshot(projectPath)).rejects.toThrow(/hard links/i);

    expect(await readFile(stagePath, "utf8")).toBe(bytes);
    expect(await readFile(intentPath, "utf8")).toBe("{not-json\n");
  });

  it("fails closed and preserves a crash stage when its intent revision mismatches", async () => {
    const { directory, projectPath } = await workspace("project-create-mismatched-intent-");
    const token = "9e817a9a-0ed7-43ca-9c4f-19779247ea49";
    const stagePath = creationStagePath(directory, token);
    const bytes = serializeProject(project("Mismatched intent"));
    await writeFile(projectPath, bytes);
    await link(projectPath, stagePath);
    const intentPath = await writeCreationIntent(projectPath, stagePath, token, bytes, {
      revision: "0".repeat(64),
    });

    await expect(readIdentifiedProjectSnapshot(projectPath)).rejects.toThrow(/hard links/i);

    expect(await readFile(stagePath, "utf8")).toBe(bytes);
    await expect(lstat(intentPath)).resolves.toBeDefined();
  });

  it("fails closed and preserves a crash stage when its intent identity mismatches", async () => {
    const { directory, projectPath } = await workspace("project-create-mismatched-identity-");
    const token = "6a58a32b-a347-40c8-bf2e-8b7306cf99c1";
    const stagePath = creationStagePath(directory, token);
    const bytes = serializeProject(project("Mismatched identity"));
    await writeFile(projectPath, bytes);
    await link(projectPath, stagePath);
    const intentPath = await writeCreationIntent(projectPath, stagePath, token, bytes, {
      inode: "0",
    });

    await expect(readIdentifiedProjectSnapshot(projectPath)).rejects.toThrow(/hard links/i);

    expect(await readFile(stagePath, "utf8")).toBe(bytes);
    await expect(lstat(intentPath)).resolves.toBeDefined();
  });

  it("removes a stale matching intent after the published stage was already unlinked", async () => {
    const { directory, projectPath } = await workspace("project-create-stale-intent-");
    const token = "eb29661b-7ea6-49f6-956e-e77594384d42";
    const stagePath = creationStagePath(directory, token);
    const intentPath = creationIntentPath(directory, token);
    const remove = async (path: string) => {
      if (path === intentPath) throw new Error("intent cleanup failed");
      await rm(path, { force: true });
    };

    await projectCreator()(projectPath, project("Published"), {
      randomId: () => token,
      remove,
    });

    await expect(lstat(stagePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(intentPath)).resolves.toBeDefined();
    expect((await stat(projectPath)).nlink).toBe(1);

    await expect(readProjectSnapshot(projectPath)).resolves.toMatchObject({
      project: { meta: { name: "Published" } },
    });

    await expect(lstat(intentPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not delete an unowned replacement swapped into the intent namespace", async () => {
    const { directory, projectPath } = await workspace("project-create-intent-namespace-swap-");
    const token = "2cf51c7b-b69d-4fc9-8a10-29fe42b54056";
    const stagePath = creationStagePath(directory, token);
    const intentPath = creationIntentPath(directory, token);
    const displacedIntent = join(directory, "displaced-intent.json");

    await expect(projectCreator()(projectPath, project("Rejected"), {
      randomId: () => token,
      beforeCreatePublication: async () => {
        await rename(intentPath, displacedIntent);
        await writeFile(intentPath, "user sentinel");
      },
    })).rejects.toThrow(/intent|publication file/i);

    expect(await readFile(intentPath, "utf8")).toBe("user sentinel");
    await expect(lstat(displacedIntent)).resolves.toBeDefined();
    await expect(lstat(stagePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(projectPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports success when stage cleanup fails after no-replace publication commits", async () => {
    const { directory, projectPath } = await workspace("project-create-cleanup-failure-");
    const stagePath = join(
      directory,
      ".app-store-screenshots.json.8acfe6fb-f2d3-40de-804e-4b116bf6c0ab.tmp",
    );
    const intentPath = creationIntentPath(
      directory,
      "8acfe6fb-f2d3-40de-804e-4b116bf6c0ab",
    );
    const remove = vi.fn(async () => { throw new Error("stage cleanup failed"); });

    await expect(projectCreator()(projectPath, project("Committed"), {
      randomId: () => "8acfe6fb-f2d3-40de-804e-4b116bf6c0ab",
      remove,
    })).resolves.toMatchObject({ project: { meta: { name: "Committed" } } });

    const destinationBytes = await readFile(projectPath, "utf8");
    expect(JSON.parse(destinationBytes)).toMatchObject({ meta: { name: "Committed" } });
    expect(await readFile(stagePath, "utf8")).toBe(destinationBytes);
    await expect(lstat(intentPath)).resolves.toBeDefined();
    expect(remove).toHaveBeenCalledWith(stagePath);

    await expect(readProjectSnapshot(projectPath)).resolves.toMatchObject({
      project: { meta: { name: "Committed" } },
    });
    await expect(lstat(stagePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(intentPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(projectPath)).nlink).toBe(1);
  });

  it("preserves the old project and cleans its owned stage after a stage write failure", async () => {
    const { directory, projectPath } = await workspace("project-snapshot-write-fail-");
    const before = serializeProject(project("Before"));
    await writeFile(projectPath, before);
    const remove = vi.fn(async (path: string) => rm(path, { force: true }));

    await expect(writeProjectAtomic(projectPath, project("After"), {
      randomId: () => "write-failure",
      openFile: async (path, flags, mode) => {
        const handle = await open(path, flags, mode);
        return {
          writeFile: async () => { throw new Error("stage write failed"); },
          sync: () => handle.sync(),
          close: () => handle.close(),
        };
      },
      remove,
    })).rejects.toThrow("stage write failed");

    expect(await readFile(projectPath, "utf8")).toBe(before);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(await readdir(directory)).toEqual(["app-store-screenshots.json"]);
  });

  it("preserves the old project when a stage write rejects without an error value", async () => {
    const { directory, projectPath } = await workspace("project-snapshot-falsy-write-fail-");
    const before = serializeProject(project("Before"));
    await writeFile(projectPath, before);

    await expect(writeProjectAtomic(projectPath, project("After"), {
      randomId: () => "falsy-write-failure",
      openFile: async (path, flags, mode) => {
        const handle = await open(path, flags, mode);
        return {
          writeFile: () => Promise.reject(),
          sync: () => handle.sync(),
          close: () => handle.close(),
        };
      },
    })).rejects.toBeUndefined();

    expect(await readFile(projectPath, "utf8")).toBe(before);
    expect(await readdir(directory)).toEqual(["app-store-screenshots.json"]);
  });

  it("preserves the old project and cleans its owned stage after a stage sync failure", async () => {
    const { directory, projectPath } = await workspace("project-snapshot-sync-fail-");
    const before = serializeProject(project("Before"));
    const stage = join(directory, ".app-store-screenshots.json.sync-failure.tmp");
    await writeFile(projectPath, before);
    const remove = vi.fn(async (path: string) => rm(path, { force: true }));

    await expect(writeProjectAtomic(projectPath, project("After"), {
      randomId: () => "sync-failure",
      openFile: async (path, flags, mode) => {
        const handle = await open(path, flags, mode);
        return {
          writeFile: (data) => handle.writeFile(data),
          sync: async () => { throw new Error("stage sync failed"); },
          close: () => handle.close(),
        };
      },
      remove,
    })).rejects.toThrow("stage sync failed");

    expect(await readFile(projectPath, "utf8")).toBe(before);
    await expect(readProjectSnapshot(projectPath)).resolves.toEqual({
      project: project("Before"),
      revision: projectRevision(before),
    });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(stage);
    expect(await readdir(directory)).toEqual(["app-store-screenshots.json"]);
  });

  it("preserves the old project and removes its stage after rename fails", async () => {
    const { directory, projectPath } = await workspace("project-snapshot-rename-fail-");
    const before = serializeProject(project("Before"));
    await writeFile(projectPath, before);

    await expect(writeProjectAtomic(projectPath, project("After"), {
      randomId: () => "rename-failure",
      move: async () => { throw new Error("rename failed"); },
    })).rejects.toThrow("rename failed");

    expect(await readFile(projectPath, "utf8")).toBe(before);
    expect(await readdir(directory)).toEqual(["app-store-screenshots.json"]);
  });

  it("uses unique sibling stages and leaves none after successful writes", async () => {
    const { directory, projectPath } = await workspace("project-snapshot-unique-");
    const identifiers = ["first", "second"];
    const opened: string[] = [];

    for (const name of ["First", "Second"]) {
      await writeProjectAtomic(projectPath, project(name), {
        randomId: () => identifiers.shift()!,
        openFile: async (path, flags, mode) => {
          opened.push(path);
          return open(path, flags, mode);
        },
      });
    }

    expect(new Set(opened).size).toBe(2);
    expect(opened.every((path) => path.startsWith(`${directory}/.`))).toBe(true);
    expect(await readdir(directory)).toEqual(["app-store-screenshots.json"]);
    await expect(readProjectSnapshot(projectPath)).resolves.toMatchObject({ project: { meta: { name: "Second" } } });
  });

  it("keeps a published write successful when directory sync is unavailable", async () => {
    const { projectPath } = await workspace("project-snapshot-directory-sync-");
    const close = vi.fn(async () => undefined);

    await expect(writeProjectAtomic(projectPath, project("Published"), {
      openDirectory: async () => ({
        sync: async () => { throw new Error("directory sync unsupported"); },
        close,
      }),
    })).resolves.toMatchObject({ project: { meta: { name: "Published" } } });

    await expect(readProjectSnapshot(projectPath)).resolves.toMatchObject({
      project: { meta: { name: "Published" } },
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("never deletes a pre-existing unowned stage when exclusive open fails", async () => {
    const { directory, projectPath } = await workspace("project-snapshot-owned-");
    const before = serializeProject(project("Before"));
    await writeFile(projectPath, before);
    const stage = join(directory, ".app-store-screenshots.json.collision.tmp");
    await writeFile(stage, "sentinel", { flag: "wx" });

    await expect(writeProjectAtomic(projectPath, project("After"), {
      randomId: () => "collision",
    })).rejects.toMatchObject({ code: "EEXIST" });

    expect(await readFile(projectPath, "utf8")).toBe(before);
    await expect(readProjectSnapshot(projectPath)).resolves.toEqual({
      project: project("Before"),
      revision: projectRevision(before),
    });
    expect(await readFile(stage, "utf8")).toBe("sentinel");
  });

  it("opens stages exclusively without following a pre-existing leaf", async () => {
    const { projectPath } = await workspace("project-snapshot-flags-");
    const flags: number[] = [];

    await writeProjectAtomic(projectPath, project(), {
      openFile: async (path, value, mode) => {
        flags.push(value as number);
        return open(path, value, mode);
      },
    });

    expect(flags[0]! & constants.O_EXCL).not.toBe(0);
    expect(flags[0]! & constants.O_NOFOLLOW).not.toBe(0);
  });
});
