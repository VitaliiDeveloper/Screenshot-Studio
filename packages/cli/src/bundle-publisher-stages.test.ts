// SPDX-License-Identifier: Apache-2.0
import { constants } from "node:fs";
import {
  link,
  mkdir,
  lstat,
  open,
  readFile,
  readdir,
  rename,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeBundleOutputs } from "./bundle-publisher.js";
import { cleanupTemporaryRoots, entries, execFileAsync, pngBytes, workspace } from "./bundle-publisher-test-support.js";

afterEach(cleanupTemporaryRoots);

describe("writeBundleOutputs", () => {
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
