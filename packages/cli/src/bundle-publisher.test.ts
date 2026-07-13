// SPDX-License-Identifier: Apache-2.0
import { mkdir, mkdtemp, readFile, readdir, rename, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import JSZip from "jszip";
import type { BundleEntry } from "@screenshot-studio/core/export";
import { describe, expect, it, vi } from "vitest";
import { writeBundleOutputs } from "./bundle-publisher.js";

function pngBytes(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWPgEpFrAAABJQC9HDa67AAAAABJRU5ErkJggg==",
    "base64",
  );
}

const entries = [
  {
    screen: { id: "s1", artboard: { width: 1, height: 1 } },
    target: { id: "one", width: 1, height: 1 },
    relativePath: "apple/iphone/en/01-one-one.png",
  },
  {
    screen: { id: "s2", artboard: { width: 1, height: 1 } },
    target: { id: "two", width: 1, height: 1 },
    relativePath: "android/phone/uk/02-two-two.png",
  },
] as unknown as BundleEntry[];

describe("writeBundleOutputs", () => {
  it("writes PNG files and one zip with matching entries", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "bundle-output-"));
    const zipPath = await writeBundleOutputs({
      outDir,
      entries: [
        { entry: entries[0]!, png: pngBytes() },
        { entry: entries[1]!, png: pngBytes() },
      ],
    });

    await expect(stat(join(outDir, entries[0]!.relativePath))).resolves.toBeTruthy();
    await expect(stat(join(outDir, entries[1]!.relativePath))).resolves.toBeTruthy();

    const zip = await JSZip.loadAsync(await readFile(zipPath));
    expect(Object.values(zip.files).filter((file) => !file.dir).map((file) => file.name).sort()).toEqual([
      "android/phone/uk/02-two-two.png",
      "apple/iphone/en/01-one-one.png",
    ]);
  });

  it("writes byte-identical zip files for identical entries", async () => {
    const firstOutDir = await mkdtemp(join(tmpdir(), "bundle-output-deterministic-first-"));
    const secondOutDir = await mkdtemp(join(tmpdir(), "bundle-output-deterministic-second-"));
    const renderedEntries = [
      { entry: entries[0]!, png: pngBytes() },
      { entry: entries[1]!, png: pngBytes() },
    ];

    const firstZip = await writeBundleOutputs({ outDir: firstOutDir, entries: renderedEntries });
    const secondZip = await writeBundleOutputs({ outDir: secondOutDir, entries: renderedEntries });

    expect(await readFile(firstZip)).toEqual(await readFile(secondZip));
  });

  it("preflights the complete batch before rejecting a traversal path", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "bundle-output-unsafe-"));
    const outDir = join(workspace, "export");
    await expect(writeBundleOutputs({
      outDir,
      entries: [
        { entry: entries[0]!, png: pngBytes() },
        { entry: { ...entries[1]!, relativePath: "../escaped.png" }, png: pngBytes() },
      ],
    })).rejects.toThrow(/Unsafe bundle output path/);
    await expect(stat(join(outDir, entries[0]!.relativePath))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(workspace, "escaped.png"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects duplicate output paths before writing the first file", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "bundle-output-duplicate-"));
    await expect(writeBundleOutputs({
      outDir,
      entries: [
        { entry: entries[0]!, png: pngBytes() },
        { entry: { ...entries[1]!, relativePath: entries[0]!.relativePath }, png: pngBytes() },
      ],
    })).rejects.toThrow(/Duplicate bundle output path/);
    await expect(stat(join(outDir, entries[0]!.relativePath))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a symlinked later output before overwriting outside the bundle root", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "bundle-output-symlink-"));
    const outDir = join(workspace, "export");
    const outside = join(workspace, "outside.png");
    const linkedOutput = join(outDir, entries[1]!.relativePath);
    await mkdir(dirname(linkedOutput), { recursive: true });
    await symlink(outside, linkedOutput);

    await expect(writeBundleOutputs({
      outDir,
      entries: [
        { entry: entries[0]!, png: pngBytes() },
        { entry: entries[1]!, png: pngBytes() },
      ],
    })).rejects.toThrow(/symbolic link/);
    await expect(stat(join(outDir, entries[0]!.relativePath))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(outside)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a symlinked output directory before writing", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "bundle-directory-symlink-"));
    const outDir = join(workspace, "export");
    const outside = join(workspace, "outside");
    await mkdir(join(outDir, "apple"), { recursive: true });
    await mkdir(outside);
    await symlink(outside, join(outDir, "apple", "iphone"));

    await expect(writeBundleOutputs({
      outDir,
      entries: [{ entry: entries[0]!, png: pngBytes() }],
    })).rejects.toThrow(/symbolic link/);
    await expect(stat(join(outside, "en", "01-one-one.png"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("deliberately replaces an existing regular generated file on rerun", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "bundle-output-replace-"));
    const destination = join(outDir, entries[0]!.relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, "stale");

    await writeBundleOutputs({
      outDir,
      entries: [{ entry: entries[0]!, png: pngBytes() }],
    });

    expect(await readFile(destination)).toEqual(pngBytes());
  });

  it("stages the complete batch and leaves prior outputs unchanged when staging fails", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "bundle-output-stage-fail-"));
    const destination = join(outDir, entries[0]!.relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, "prior");
    let writes = 0;

    await expect(writeBundleOutputs({
      outDir,
      entries: [
        { entry: entries[0]!, png: pngBytes() },
        { entry: entries[1]!, png: pngBytes() },
      ],
      dependencies: {
        write: vi.fn(async (path, bytes) => {
          writes += 1;
          if (writes === 2) throw new Error("staging disk full");
          await writeFile(path, bytes);
        }),
      },
    })).rejects.toThrow(/staging disk full/);

    expect(await readFile(destination, "utf8")).toBe("prior");
    expect((await readdir(outDir)).some((name) => name.startsWith(".screenshot-studio-stage-"))).toBe(false);
  });

  it("rolls back replaced and new generated files when publication fails", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "bundle-output-publish-fail-"));
    const first = join(outDir, entries[0]!.relativePath);
    const second = join(outDir, entries[1]!.relativePath);
    const sentinel = join(outDir, "keep.txt");
    await mkdir(dirname(first), { recursive: true });
    await writeFile(first, "prior");
    await writeFile(sentinel, "unrelated");
    let moves = 0;

    await expect(writeBundleOutputs({
      outDir,
      entries: [
        { entry: entries[0]!, png: pngBytes() },
        { entry: entries[1]!, png: pngBytes() },
      ],
      dependencies: {
        move: vi.fn(async (source, destination) => {
          moves += 1;
          if (moves === 3) throw new Error("publish interrupted");
          await rename(source, destination);
        }),
      },
    })).rejects.toThrow(/publish interrupted/);

    expect(await readFile(first, "utf8")).toBe("prior");
    await expect(stat(second)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(sentinel, "utf8")).toBe("unrelated");
    expect((await readdir(outDir)).some((name) => name.startsWith(".screenshot-studio-stage-"))).toBe(false);
  });

  it("retains recovery data and reports both errors when rollback fails", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "bundle-output-rollback-fail-"));
    const first = join(outDir, entries[0]!.relativePath);
    await mkdir(dirname(first), { recursive: true });
    await writeFile(first, "prior");
    let moves = 0;

    await expect(writeBundleOutputs({
      outDir,
      entries: [{ entry: entries[0]!, png: pngBytes() }],
      dependencies: {
        move: vi.fn(async (source, destination) => {
          moves += 1;
          if (moves === 3) throw new Error("publish interrupted");
          if (moves === 4) throw new Error("restore failed");
          await rename(source, destination);
        }),
      },
    })).rejects.toThrow(/publish interrupted; bundle output rollback failed; recovery data retained at/);

    const recoveryDirectories = (await readdir(outDir))
      .filter((name) => name.startsWith(".screenshot-studio-stage-"));
    expect(recoveryDirectories).toHaveLength(1);
    expect(await readFile(join(outDir, recoveryDirectories[0]!, "backup", "0"), "utf8")).toBe("prior");
  });
});
