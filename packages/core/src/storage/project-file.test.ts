// SPDX-License-Identifier: Apache-2.0
import { constants } from "node:fs";
import { mkdtemp, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../model/index.js";
import {
  projectRevision,
  readProjectSnapshot,
  serializeProject,
  writeProjectAtomic,
} from "./project-file.js";

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
