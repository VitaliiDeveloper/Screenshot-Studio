// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { access, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunFolder, removeRunFolder, sweepStaleRunFolders } from "./agent-attachment-store.server.js";

const root = join(tmpdir(), "screenshot-studio-agent-attachments");
const exists = (path: string) => access(path).then(() => true, () => false);
const PNG = { type: "png" as const, bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) };
let deadPid: number;
const created: string[] = [];

beforeEach(() => {
  // A pid far above any live process: kill(pid, 0) answers ESRCH.
  deadPid = 4_194_000 + Math.floor(Math.random() * 1_000);
});

afterEach(async () => {
  await Promise.all(created.splice(0).map(removeRunFolder));
  await removeRunFolder(join(root, String(deadPid)));
});

describe("agent attachment run folders", () => {
  it("names files from the detected type under a private folder of this server", async () => {
    const { dir, files } = await createRunFolder([PNG, { type: "webp", bytes: PNG.bytes }]);
    created.push(dir);

    expect(files).toEqual([join(dir, "1.png"), join(dir, "2.webp")]);
    expect(dir.startsWith(join(await realpath(root), String(process.pid)))).toBe(true);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(files[0]!)).mode & 0o777).toBe(0o600);
    expect([...await readFile(files[0]!)]).toEqual([...PNG.bytes]);
    await removeRunFolder(dir);
    expect(await exists(dir)).toBe(false);
    await removeRunFolder(dir);
  });

  it("at server start removes folders of dead servers, never a live server's", async () => {
    const { dir } = await createRunFolder([PNG]);
    created.push(dir);
    const dead = join(root, String(deadPid), "run-left-behind");
    await mkdir(dead, { recursive: true });
    await writeFile(join(dead, "1.png"), PNG.bytes);
    const parent = join(root, String(process.ppid));
    const liveOther = await mkdir(join(parent, "run-other"), { recursive: true }).then(() => true, () => false);

    await sweepStaleRunFolders();

    expect(await exists(join(root, String(deadPid)))).toBe(false);
    expect(await exists(dir)).toBe(true);
    if (liveOther) {
      expect(await readdir(parent)).toContain("run-other");
      await removeRunFolder(join(parent, "run-other"));
    }
  });
});
