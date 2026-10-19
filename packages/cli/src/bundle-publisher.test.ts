// SPDX-License-Identifier: Apache-2.0
import {
  link,
  mkdir,
  lstat,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { writeBundleOutputs } from "./bundle-publisher.js";
import { cleanupTemporaryRoots, entries, execFileAsync, pngBytes, workspace } from "./bundle-publisher-test-support.js";

afterEach(cleanupTemporaryRoots);

describe("writeBundleOutputs", () => {
  it("writes PNG files and one zip with matching entries", async () => {
    const outDir = await workspace("bundle-output-");
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

  it("preserves a portable Unicode output path", async () => {
    const outDir = await workspace("bundle-output-unicode-");
    const relativePath = "日本語/écrans/01-héros.png";

    await writeBundleOutputs({
      outDir,
      entries: [{
        entry: { ...entries[0]!, relativePath },
        png: pngBytes(),
      }],
    });

    expect(await readFile(join(outDir, relativePath))).toEqual(pngBytes());
  });

  it("writes byte-identical zip files for identical entries", async () => {
    const firstOutDir = await workspace("bundle-output-deterministic-first-");
    const secondOutDir = await workspace("bundle-output-deterministic-second-");
    const renderedEntries = [
      { entry: entries[0]!, png: pngBytes() },
      { entry: entries[1]!, png: pngBytes() },
    ];

    const firstZip = await writeBundleOutputs({ outDir: firstOutDir, entries: renderedEntries });
    const secondZip = await writeBundleOutputs({ outDir: secondOutDir, entries: renderedEntries });

    expect(await readFile(firstZip)).toEqual(await readFile(secondZip));
  });

  it("preflights the complete batch before rejecting a traversal path", async () => {
    const base = await workspace("bundle-output-unsafe-");
    const outDir = join(base, "export");
    await expect(writeBundleOutputs({
      outDir,
      entries: [
        { entry: entries[0]!, png: pngBytes() },
        { entry: { ...entries[1]!, relativePath: "../escaped.png" }, png: pngBytes() },
      ],
    })).rejects.toThrow(/Unsafe bundle output path/);
    await expect(stat(join(outDir, entries[0]!.relativePath))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(base, "escaped.png"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects every non-portable path and reserved ZIP collision before touching output", async () => {
    const invalidPaths = [
      "C:/drive.png",
      "file:asset.png",
      "https://example.com/asset.png",
      "",
      ".",
      "nested/../asset.png",
      "nested\\asset.png",
      "nul\0asset.png",
      "app-store-screenshots-bundle.zip",
      "APP-STORE-SCREENSHOTS-BUNDLE.ZIP",
    ];

    for (const [index, relativePath] of invalidPaths.entries()) {
      const base = await workspace(`bundle-output-invalid-${index}-`);
      const outDir = join(base, "export");
      await expect(writeBundleOutputs({
        outDir,
        entries: [
          { entry: entries[0]!, png: pngBytes() },
          { entry: { ...entries[1]!, relativePath }, png: pngBytes() },
        ],
      })).rejects.toThrow(/Unsafe bundle output path|Duplicate bundle output path/);
      await expect(stat(outDir)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("rejects duplicate output paths before writing the first file", async () => {
    const outDir = await workspace("bundle-output-duplicate-");
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
    const base = await workspace("bundle-output-symlink-");
    const outDir = join(base, "export");
    const outside = join(base, "outside.png");
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
    const base = await workspace("bundle-directory-symlink-");
    const outDir = join(base, "export");
    const outside = join(base, "outside");
    await mkdir(join(outDir, "apple"), { recursive: true });
    await mkdir(outside);
    await symlink(outside, join(outDir, "apple", "iphone"));

    await expect(writeBundleOutputs({
      outDir,
      entries: [{ entry: entries[0]!, png: pngBytes() }],
    })).rejects.toThrow(/symbolic link/);
    await expect(stat(join(outside, "en", "01-one-one.png"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects creation of a missing output root below a symlink anchor", async () => {
    const base = await workspace("bundle-root-symlink-anchor-");
    const realAnchor = join(base, "real-anchor");
    const linkedAnchor = join(base, "linked-anchor");
    const outDir = join(linkedAnchor, "missing-output");
    await mkdir(realAnchor);
    await symlink(realAnchor, linkedAnchor);

    await expect(writeBundleOutputs({
      outDir,
      entries: [{ entry: entries[0]!, png: pngBytes() }],
    })).rejects.toThrow(/symbolic link/i);

    await expect(stat(join(realAnchor, "missing-output"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an existing directory leaf", async () => {
    const outDir = await workspace("bundle-output-directory-leaf-");
    const destination = join(outDir, entries[0]!.relativePath);
    await mkdir(destination, { recursive: true });

    await expect(writeBundleOutputs({
      outDir,
      entries: [{ entry: entries[0]!, png: pngBytes() }],
    })).rejects.toThrow(/regular file|existing directory/i);

    expect((await stat(destination)).isDirectory()).toBe(true);
  });

  it.skipIf(process.platform === "win32")("rejects an existing FIFO leaf", async () => {
    const outDir = await workspace("bundle-output-fifo-leaf-");
    const destination = join(outDir, entries[0]!.relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await execFileAsync("mkfifo", [destination]);

    await expect(writeBundleOutputs({
      outDir,
      entries: [{ entry: entries[0]!, png: pngBytes() }],
    })).rejects.toThrow(/regular file/i);

    expect((await stat(destination)).isFIFO()).toBe(true);
  });

  it.skipIf(process.platform === "win32")("rejects an existing device leaf", async () => {
    await expect(writeBundleOutputs({
      outDir: "/dev",
      entries: [{ entry: { ...entries[0]!, relativePath: "null" }, png: pngBytes() }],
    })).rejects.toThrow(/regular file/i);
  });

  it("deliberately replaces an existing regular generated file on rerun", async () => {
    const outDir = await workspace("bundle-output-replace-");
    const destination = join(outDir, entries[0]!.relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, "stale");

    await writeBundleOutputs({
      outDir,
      entries: [{ entry: entries[0]!, png: pngBytes() }],
    });

    expect(await readFile(destination)).toEqual(pngBytes());
  });

  it("rejects a leaf swapped after backup and retains recovery instead of deleting it", async () => {
    const outDir = await workspace("bundle-output-leaf-swap-");
    const outsideRoot = await workspace("bundle-output-leaf-swap-outside-");
    const destination = join(outDir, entries[0]!.relativePath);
    const outside = join(outsideRoot, "sentinel.png");
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, "prior");
    await writeFile(outside, "outside");
    let moves = 0;

    await expect(writeBundleOutputs({
      outDir,
      entries: [{ entry: entries[0]!, png: pngBytes() }],
      dependencies: {
        move: async (source, target) => {
          moves += 1;
          await rename(source, target);
          if (moves === 1) await symlink(outside, destination);
        },
      },
    })).rejects.toThrow(/bundle output rollback failed; recovery data retained/);

    expect((await lstat(destination)).isSymbolicLink()).toBe(true);
    expect(await readFile(outside, "utf8")).toBe("outside");
    const recoveryDirectories = (await readdir(outDir))
      .filter((name) => name.startsWith(".screenshot-studio-stage-"));
    expect(recoveryDirectories).toHaveLength(1);
    expect(await readFile(join(outDir, recoveryDirectories[0]!, "backup", "0"), "utf8")).toBe("prior");
  });

  it("does not overwrite a concurrent regular leaf while restoring backup", async () => {
    const outDir = await workspace("bundle-output-rollback-concurrent-leaf-");
    const destination = join(outDir, entries[0]!.relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, "prior");
    let moves = 0;

    await expect(writeBundleOutputs({
      outDir,
      entries: [{ entry: entries[0]!, png: pngBytes() }],
      dependencies: {
        move: async (source, target) => {
          moves += 1;
          await rename(source, target);
          if (moves === 1) await writeFile(destination, "competitor", { flag: "wx" });
        },
      },
    })).rejects.toThrow(/bundle output rollback failed; recovery data retained/);

    expect(await readFile(destination, "utf8")).toBe("competitor");
    const recoveryDirectories = (await readdir(outDir))
      .filter((name) => name.startsWith(".screenshot-studio-stage-"));
    expect(recoveryDirectories).toHaveLength(1);
    expect(await readFile(join(outDir, recoveryDirectories[0]!, "backup", "0"), "utf8")).toBe("prior");
  });

  it("preserves a different regular inode that replaces an already-published output", async () => {
    const outDir = await workspace("bundle-output-rollback-replaced-published-");
    const first = join(outDir, entries[0]!.relativePath);
    const second = join(outDir, entries[1]!.relativePath);
    const displacedPublished = join(outDir, "displaced-published.png");
    const competitor = Buffer.from("concurrent regular replacement");
    let replaced = false;

    const replacePublishedThenFail = async (): Promise<never> => {
      if (!replaced) {
        await rename(first, displacedPublished);
        await writeFile(first, competitor, { flag: "wx" });
        replaced = true;
      }
      throw new Error("later publication failed");
    };

    await expect(writeBundleOutputs({
      outDir,
      entries: [
        { entry: entries[0]!, png: pngBytes() },
        { entry: entries[1]!, png: pngBytes() },
      ],
      dependencies: {
        move: async (source, target) => {
          if (String(target) === second) return replacePublishedThenFail();
          await rename(source, target);
        },
        linkFile: async (source: string, target: string) => {
          if (target === second) return replacePublishedThenFail();
          await link(source, target);
        },
      },
    })).rejects.toThrow(/rollback failed; recovery data retained/i);

    expect(await readFile(first)).toEqual(competitor);
    const recoveryDirectories = (await readdir(outDir))
      .filter((name) => name.startsWith(".screenshot-studio-stage-"));
    expect(recoveryDirectories).toHaveLength(1);
  });

  it("preserves in-place concurrent bytes written to an already-published output", async () => {
    const outDir = await workspace("bundle-output-rollback-mutated-published-");
    const first = join(outDir, entries[0]!.relativePath);
    const second = join(outDir, entries[1]!.relativePath);
    const competitor = Buffer.from("concurrent in-place replacement");
    let originalIdentity: { dev: bigint; ino: bigint } | undefined;

    const mutatePublishedThenFail = async (): Promise<never> => {
      const before = await stat(first, { bigint: true });
      originalIdentity = { dev: before.dev, ino: before.ino };
      await writeFile(first, competitor);
      const after = await stat(first, { bigint: true });
      expect({ dev: after.dev, ino: after.ino }).toEqual(originalIdentity);
      throw new Error("later publication failed");
    };

    await expect(writeBundleOutputs({
      outDir,
      entries: [
        { entry: entries[0]!, png: pngBytes() },
        { entry: entries[1]!, png: pngBytes() },
      ],
      dependencies: {
        move: async (source, target) => {
          if (String(target) === second) return mutatePublishedThenFail();
          await rename(source, target);
        },
        linkFile: async (source: string, target: string) => {
          if (target === second) return mutatePublishedThenFail();
          await link(source, target);
        },
      },
    })).rejects.toThrow(/rollback failed; recovery data retained/i);

    expect(originalIdentity).toBeDefined();
    expect(await readFile(first)).toEqual(competitor);
    const recoveryDirectories = (await readdir(outDir))
      .filter((name) => name.startsWith(".screenshot-studio-stage-"));
    expect(recoveryDirectories).toHaveLength(1);
  });

  it("quarantines rather than deleting a replacement installed at rollback removal", async () => {
    const outDir = await workspace("bundle-output-rollback-remove-race-");
    const first = join(outDir, entries[0]!.relativePath);
    const second = join(outDir, entries[1]!.relativePath);
    const displacedPublished = join(outDir, "displaced-published.png");
    const competitor = Buffer.from("rollback removal competitor");
    let swapped = false;

    await expect(writeBundleOutputs({
      outDir,
      entries: [
        { entry: entries[0]!, png: pngBytes() },
        { entry: entries[1]!, png: pngBytes() },
      ],
      dependencies: {
        move: async (source, target) => {
          if (
            !swapped
            && String(source) === first
            && String(target).includes(`${join("quarantine", "0")}`)
          ) {
            await rename(first, displacedPublished);
            await writeFile(first, competitor, { flag: "wx" });
            swapped = true;
          }
          await rename(source, target);
        },
        linkFile: async (source, target) => {
          if (target === second) throw new Error("later publication failed");
          await link(source, target);
        },
      },
    })).rejects.toThrow(/rollback failed; recovery data retained/i);

    expect(swapped).toBe(true);
    expect(await readFile(first)).toEqual(competitor);
    const recoveryDirectories = (await readdir(outDir))
      .filter((name) => name.startsWith(".screenshot-studio-stage-"));
    expect(recoveryDirectories).toHaveLength(1);
    expect(await readFile(join(outDir, recoveryDirectories[0]!, "quarantine", "0")))
      .toEqual(competitor);
  });

  it("never overwrites an occupant inserted at the no-replace publication boundary", async () => {
    const outDir = await workspace("bundle-output-publication-no-replace-");
    const destination = join(outDir, entries[0]!.relativePath);
    const competitor = Buffer.from("publication competitor");
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, "prior");
    let inserted = false;

    const insertCompetitor = async (): Promise<void> => {
      if (inserted) return;
      await writeFile(destination, competitor, { flag: "wx" });
      inserted = true;
    };

    await expect(writeBundleOutputs({
      outDir,
      entries: [{ entry: entries[0]!, png: pngBytes() }],
      dependencies: {
        move: async (source, target) => {
          if (String(target) === destination) await insertCompetitor();
          await rename(source, target);
        },
        linkFile: async (source: string, target: string) => {
          if (target === destination) await insertCompetitor();
          await link(source, target);
        },
      },
    })).rejects.toThrow(/rollback failed; recovery data retained/i);

    expect(await readFile(destination)).toEqual(competitor);
    const recoveryDirectories = (await readdir(outDir))
      .filter((name) => name.startsWith(".screenshot-studio-stage-"));
    expect(recoveryDirectories).toHaveLength(1);
    expect(await readFile(join(outDir, recoveryDirectories[0]!, "backup", "0"), "utf8")).toBe("prior");
  });

  it("never overwrites an occupant inserted at the no-replace restore boundary", async () => {
    const outDir = await workspace("bundle-output-restore-no-replace-");
    const destination = join(outDir, entries[0]!.relativePath);
    const competitor = Buffer.from("restore competitor");
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, "prior");
    let moves = 0;
    let links = 0;

    await expect(writeBundleOutputs({
      outDir,
      entries: [{ entry: entries[0]!, png: pngBytes() }],
      dependencies: {
        move: async (source, target) => {
          moves += 1;
          if (moves === 2) throw new Error("publication interrupted");
          if (moves === 3) await writeFile(destination, competitor, { flag: "wx" });
          await rename(source, target);
        },
        linkFile: async (source: string, target: string) => {
          links += 1;
          if (links === 1) throw new Error("publication interrupted");
          if (links === 2) await writeFile(destination, competitor, { flag: "wx" });
          await link(source, target);
        },
      },
    })).rejects.toThrow(/rollback failed; recovery data retained/i);

    expect(await readFile(destination)).toEqual(competitor);
    const recoveryDirectories = (await readdir(outDir))
      .filter((name) => name.startsWith(".screenshot-studio-stage-"));
    expect(recoveryDirectories).toHaveLength(1);
    expect(await readFile(join(outDir, recoveryDirectories[0]!, "backup", "0"), "utf8")).toBe("prior");
  });

  it("retains the backup when the restored output changes during final validation", async () => {
    const outDir = await workspace("bundle-output-restore-backup-boundary-");
    const destination = join(outDir, entries[0]!.relativePath);
    const competitor = Buffer.from("restored output competitor");
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, "prior");
    let restorationLinked = false;
    let restoredOutputVerifications = 0;
    let swapped = false;

    await expect(writeBundleOutputs({
      outDir,
      entries: [{ entry: entries[0]!, png: pngBytes() }],
      dependencies: {
        linkFile: async (source, target) => {
          if (String(target).endsWith("app-store-screenshots-bundle.zip")) {
            throw new Error("later publication failed");
          }
          await link(source, target);
          if (String(source).includes(`${join("backup", "0")}`) && target === destination) {
            restorationLinked = true;
          }
        },
        openVerification: async (path, flags) => {
          const handle = await open(path, flags);
          const verification = restorationLinked && path === destination
            ? ++restoredOutputVerifications
            : 0;
          return {
            stat: handle.stat.bind(handle),
            readFile: handle.readFile.bind(handle),
            close: async () => {
              await handle.close();
              if (verification === 2 && !swapped) {
                await rm(destination, { force: true });
                await writeFile(destination, competitor, { flag: "wx" });
                swapped = true;
              }
            },
          };
        },
      },
    })).rejects.toThrow(/rollback failed; recovery data retained/i);

    expect(swapped).toBe(true);
    expect(await readFile(destination)).toEqual(competitor);
    const recoveryDirectories = (await readdir(outDir))
      .filter((name) => name.startsWith(".screenshot-studio-stage-"));
    expect(recoveryDirectories).toHaveLength(1);
    expect(await readFile(join(outDir, recoveryDirectories[0]!, "backup", "0"), "utf8"))
      .toBe("prior");
  });

  it("restores pre-existing output aliases that share one hard-linked inode", async () => {
    const outDir = await workspace("bundle-output-restore-hard-link-aliases-");
    const first = join(outDir, entries[0]!.relativePath);
    const second = join(outDir, entries[1]!.relativePath);
    await mkdir(dirname(first), { recursive: true });
    await mkdir(dirname(second), { recursive: true });
    await writeFile(first, "shared prior");
    await link(first, second);

    await expect(writeBundleOutputs({
      outDir,
      entries: [
        { entry: entries[0]!, png: pngBytes() },
        { entry: entries[1]!, png: pngBytes() },
      ],
      dependencies: {
        linkFile: async (source, target) => {
          if (String(target).endsWith("app-store-screenshots-bundle.zip")) {
            throw new Error("zip publication failed");
          }
          await link(source, target);
        },
      },
    })).rejects.toThrow(/zip publication failed/);

    expect(await readFile(first, "utf8")).toBe("shared prior");
    expect(await readFile(second, "utf8")).toBe("shared prior");
    const firstStats = await stat(first, { bigint: true });
    const secondStats = await stat(second, { bigint: true });
    expect(firstStats.ino).toBe(secondStats.ino);
    expect(firstStats.nlink).toBe(2n);
    expect((await readdir(outDir)).some((name) => name.startsWith(".screenshot-studio-stage-")))
      .toBe(false);
  });
});
