// SPDX-License-Identifier: Apache-2.0
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  link,
  mkdir,
  mkdtemp,
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
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import JSZip from "jszip";
import type { BundleEntry } from "@screenshot-studio/core/export";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeBundleOutputs } from "./bundle-publisher.js";

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

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

  it("rejects a staged pathname swapped after its opened handle was verified", async () => {
    const outDir = await workspace("bundle-output-stage-name-swap-");
    const destination = join(outDir, entries[0]!.relativePath);
    let swapped = false;

    await expect(writeBundleOutputs({
      outDir,
      entries: [{ entry: entries[0]!, png: pngBytes() }],
      dependencies: {
        openVerification: async (path: string, flags: number) => {
          const handle = await open(path, flags);
          return {
            stat: handle.stat.bind(handle),
            readFile: handle.readFile.bind(handle),
            close: async () => {
              await handle.close();
              if (!swapped && path.endsWith(join("files", entries[0]!.relativePath))) {
                await rename(path, `${path}.verified`);
                await writeFile(path, "unverified replacement", { flag: "wx" });
                swapped = true;
              }
            },
          };
        },
      },
    })).rejects.toThrow(/stage.*changed/i);

    expect(swapped).toBe(true);
    await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses BigIntStats for exact stage identity capture and verification", async () => {
    const outDir = await workspace("bundle-output-bigint-identity-");
    const statOptions: unknown[] = [];

    await writeBundleOutputs({
      outDir,
      entries: [{ entry: entries[0]!, png: pngBytes() }],
      dependencies: {
        openStage: async (path, flags, mode) => {
          const handle = await open(path, flags, mode);
          return {
            writeFile: handle.writeFile.bind(handle),
            sync: handle.sync.bind(handle),
            close: handle.close.bind(handle),
            stat: (async (options?: unknown) => {
              statOptions.push(options);
              return handle.stat({ bigint: true });
            }) as typeof handle.stat,
          };
        },
        openVerification: async (path: string, flags: number) => {
          const handle = await open(path, flags);
          return {
            stat: (async (options?: unknown) => {
              statOptions.push(options);
              return handle.stat({ bigint: true });
            }) as typeof handle.stat,
            readFile: handle.readFile.bind(handle),
            close: handle.close.bind(handle),
          };
        },
      },
    });

    expect(statOptions.length).toBeGreaterThanOrEqual(2);
    expect(statOptions.every((options) => (options as { bigint?: boolean })?.bigint === true)).toBe(true);
  });

  it.skipIf(process.platform === "win32")("rejects a FIFO stage replacement without blocking", async () => {
    const outDir = await workspace("bundle-output-stage-fifo-");
    const destination = join(outDir, entries[0]!.relativePath);
    let verificationFlags: number | undefined;
    let swapped = false;

    await expect(writeBundleOutputs({
      outDir,
      entries: [{ entry: entries[0]!, png: pngBytes() }],
      dependencies: {
        openVerification: async (path: string, flags: number) => {
          if (!swapped && path.endsWith(join("files", entries[0]!.relativePath))) {
            verificationFlags = flags;
            await rename(path, `${path}.regular`);
            await execFileAsync("mkfifo", [path]);
            swapped = true;
          }
          return open(path, flags);
        },
      },
    })).rejects.toThrow(/stage.*changed|regular file/i);

    expect(swapped).toBe(true);
    expect(verificationFlags! & constants.O_NONBLOCK).not.toBe(0);
    await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a staged file replaced after backup and restores the prior output", async () => {
    const outDir = await workspace("bundle-output-stage-replaced-");
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
          if (moves === 1) {
            if (typeof target !== "string") throw new Error("Expected a string backup path");
            const stagingRoot = dirname(dirname(target));
            const stagedPath = join(stagingRoot, "files", entries[0]!.relativePath);
            await rename(stagedPath, join(stagingRoot, "held-stage"));
            await writeFile(stagedPath, "attacker", { flag: "wx" });
          }
        },
      },
    })).rejects.toThrow(/stage.*changed/i);

    expect(await readFile(destination, "utf8")).toBe("prior");
    expect((await readdir(outDir)).some((name) => name.startsWith(".screenshot-studio-stage-"))).toBe(false);
  });

  it("rejects staged bytes mutated in place after backup", async () => {
    const outDir = await workspace("bundle-output-stage-mutated-");
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
          if (moves === 1) {
            if (typeof target !== "string") throw new Error("Expected a string backup path");
            const stagingRoot = dirname(dirname(target));
            const stagedPath = join(stagingRoot, "files", entries[0]!.relativePath);
            const before = await lstat(stagedPath);
            await writeFile(stagedPath, "attacker");
            const after = await lstat(stagedPath);
            expect({ dev: after.dev, ino: after.ino }).toEqual({ dev: before.dev, ino: before.ino });
          }
        },
      },
    })).rejects.toThrow(/stage contents changed/i);

    expect(await readFile(destination, "utf8")).toBe("prior");
    expect((await readdir(outDir)).some((name) => name.startsWith(".screenshot-studio-stage-"))).toBe(false);
  });

  it("rejects a staged file that gains another hard link before publication", async () => {
    const outDir = await workspace("bundle-output-stage-linked-");
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
          if (moves === 1) {
            if (typeof target !== "string") throw new Error("Expected a string backup path");
            const stagingRoot = dirname(dirname(target));
            const stagedPath = join(stagingRoot, "files", entries[0]!.relativePath);
            await link(stagedPath, join(stagingRoot, "stage-link"));
          }
        },
      },
    })).rejects.toThrow(/stage.*changed/i);

    expect(await readFile(destination, "utf8")).toBe("prior");
    expect((await readdir(outDir)).some((name) => name.startsWith(".screenshot-studio-stage-"))).toBe(false);
  });

  it("rolls back earlier output when a later ancestor is swapped after initial preflight", async () => {
    const outDir = await workspace("bundle-output-later-ancestor-swap-");
    const outside = await workspace("bundle-output-later-ancestor-outside-");
    const first = join(outDir, entries[0]!.relativePath);
    const laterAncestor = join(outDir, "android", "phone");
    const heldAncestor = join(outDir, "held-phone");
    await mkdir(dirname(first), { recursive: true });
    await mkdir(laterAncestor, { recursive: true });
    await writeFile(first, "prior");
    await writeFile(join(outside, "sentinel.txt"), "outside");
    let publications = 0;

    await expect(writeBundleOutputs({
      outDir,
      entries: [
        { entry: entries[0]!, png: pngBytes() },
        { entry: entries[1]!, png: pngBytes() },
      ],
      dependencies: {
        move: rename,
        linkFile: async (source, target) => {
          await link(source, target);
          publications += 1;
          if (publications === 1) {
            await rename(laterAncestor, heldAncestor);
            await symlink(outside, laterAncestor);
          }
        },
      },
    })).rejects.toThrow(/symbolic link/);

    expect(await readFile(first, "utf8")).toBe("prior");
    expect(await readFile(join(outside, "sentinel.txt"), "utf8")).toBe("outside");
    await expect(stat(join(outside, "uk", "02-two-two.png"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stages the complete batch and leaves prior outputs unchanged when staging fails", async () => {
    const outDir = await workspace("bundle-output-stage-fail-");
    const destination = join(outDir, entries[0]!.relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, "prior");
    let opens = 0;

    await expect(writeBundleOutputs({
      outDir,
      entries: [
        { entry: entries[0]!, png: pngBytes() },
        { entry: entries[1]!, png: pngBytes() },
      ],
      dependencies: {
        openStage: async (path, flags, mode) => {
          opens += 1;
          const handle = await open(path, flags, mode);
          if (opens !== 2) return handle;
          return {
            writeFile: async () => { throw new Error("staging disk full"); },
            sync: () => handle.sync(),
            close: () => handle.close(),
          };
        },
      },
    })).rejects.toThrow(/staging disk full/);

    expect(await readFile(destination, "utf8")).toBe("prior");
    expect((await readdir(outDir)).some((name) => name.startsWith(".screenshot-studio-stage-"))).toBe(false);
  });

  it("opens stages exclusively and syncs every complete file before close and publication", async () => {
    const outDir = await workspace("bundle-output-stage-sync-order-");
    const events: string[] = [];
    let stages = 0;

    await writeBundleOutputs({
      outDir,
      entries: [{ entry: entries[0]!, png: pngBytes() }],
      dependencies: {
        openStage: async (path, flags, mode) => {
          const index = stages;
          stages += 1;
          expect(flags & constants.O_EXCL).not.toBe(0);
          if (typeof constants.O_NOFOLLOW === "number") {
            expect(flags & constants.O_NOFOLLOW).not.toBe(0);
          }
          const handle = await open(path, flags, mode);
          return {
            writeFile: async (bytes) => {
              events.push(`write-${index}`);
              await handle.writeFile(bytes);
            },
            sync: async () => {
              events.push(`sync-${index}`);
              await handle.sync();
            },
            close: async () => {
              events.push(`close-${index}`);
              await handle.close();
            },
          };
        },
        linkFile: async (source, target) => {
          events.push("publish");
          await link(source, target);
        },
      },
    });

    expect(events.slice(0, 6)).toEqual([
      "write-0",
      "sync-0",
      "close-0",
      "write-1",
      "sync-1",
      "close-1",
    ]);
    expect(events[6]).toBe("publish");
  });

  it("preserves old output and cleans staging when stage sync fails", async () => {
    const outDir = await workspace("bundle-output-stage-sync-failure-");
    const destination = join(outDir, entries[0]!.relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, "prior");

    await expect(writeBundleOutputs({
      outDir,
      entries: [{ entry: entries[0]!, png: pngBytes() }],
      dependencies: {
        openStage: async (path, flags, mode) => {
          const handle = await open(path, flags, mode);
          return {
            writeFile: (bytes) => handle.writeFile(bytes),
            sync: async () => { throw new Error("stage sync failed"); },
            close: () => handle.close(),
          };
        },
      },
    })).rejects.toThrow(/stage sync failed/);

    expect(await readFile(destination, "utf8")).toBe("prior");
    expect((await readdir(outDir)).some((name) => name.startsWith(".screenshot-studio-stage-"))).toBe(false);
  });

  it("rolls back replaced and new generated files when publication fails", async () => {
    const outDir = await workspace("bundle-output-publish-fail-");
    const first = join(outDir, entries[0]!.relativePath);
    const second = join(outDir, entries[1]!.relativePath);
    const sentinel = join(outDir, "keep.txt");
    await mkdir(dirname(first), { recursive: true });
    await writeFile(first, "prior");
    await writeFile(sentinel, "unrelated");
    let publications = 0;

    await expect(writeBundleOutputs({
      outDir,
      entries: [
        { entry: entries[0]!, png: pngBytes() },
        { entry: entries[1]!, png: pngBytes() },
      ],
      dependencies: {
        move: rename,
        linkFile: vi.fn(async (source, destination) => {
          publications += 1;
          if (publications === 2) throw new Error("publish interrupted");
          await link(source, destination);
        }),
      },
    })).rejects.toThrow(/publish interrupted/);

    expect(await readFile(first, "utf8")).toBe("prior");
    await expect(stat(second)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(sentinel, "utf8")).toBe("unrelated");
    expect((await readdir(outDir)).some((name) => name.startsWith(".screenshot-studio-stage-"))).toBe(false);
  });

  it("preserves a falsy publication failure after successful rollback", async () => {
    const outDir = await workspace("bundle-output-falsy-publish-fail-");
    const destination = join(outDir, entries[0]!.relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, "prior");
    let publications = 0;
    let rejected = false;

    try {
      await writeBundleOutputs({
        outDir,
        entries: [{ entry: entries[0]!, png: pngBytes() }],
        dependencies: {
          move: rename,
          linkFile: async (source, target) => {
            publications += 1;
            if (publications === 1) throw undefined;
            await link(source, target);
          },
        },
      });
    } catch (error) {
      rejected = true;
      expect(error).toBeUndefined();
    }

    expect(rejected).toBe(true);
    expect(await readFile(destination, "utf8")).toBe("prior");
    expect((await readdir(outDir)).some((name) => name.startsWith(".screenshot-studio-stage-"))).toBe(false);
  });

  it("aggregates cleanup failure behind a falsy publication primary", async () => {
    const outDir = await workspace("bundle-output-falsy-cleanup-fail-");
    const destination = join(outDir, entries[0]!.relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, "prior");
    let publications = 0;

    const error = await writeBundleOutputs({
      outDir,
      entries: [{ entry: entries[0]!, png: pngBytes() }],
      dependencies: {
        move: rename,
        linkFile: async (source, target) => {
          publications += 1;
          if (publications === 1) throw undefined;
          await link(source, target);
        },
        remove: async () => { throw new Error("staging cleanup failed"); },
      },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors[0]).toBeUndefined();
    expect((error as AggregateError).errors[1]).toMatchObject({ message: "staging cleanup failed" });
    expect(await readFile(destination, "utf8")).toBe("prior");
  });

  it("retains recovery data and reports both errors when rollback fails", async () => {
    const outDir = await workspace("bundle-output-rollback-fail-");
    const first = join(outDir, entries[0]!.relativePath);
    await mkdir(dirname(first), { recursive: true });
    await writeFile(first, "prior");
    let publications = 0;

    await expect(writeBundleOutputs({
      outDir,
      entries: [{ entry: entries[0]!, png: pngBytes() }],
      dependencies: {
        move: rename,
        linkFile: vi.fn(async (source, destination) => {
          publications += 1;
          if (publications === 2) throw new Error("publish interrupted");
          if (publications === 3) throw new Error("restore failed");
          await link(source, destination);
        }),
      },
    })).rejects.toThrow(/publish interrupted; bundle output rollback failed; recovery data retained at/);

    const recoveryDirectories = (await readdir(outDir))
      .filter((name) => name.startsWith(".screenshot-studio-stage-"));
    expect(recoveryDirectories).toHaveLength(1);
    expect(await readFile(join(outDir, recoveryDirectories[0]!, "backup", "0"), "utf8")).toBe("prior");
  });
});
