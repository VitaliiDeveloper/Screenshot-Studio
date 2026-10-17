// SPDX-License-Identifier: Apache-2.0
import { link, lstat, open, readFile, rename, unlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  inspectFilePublicationDestination,
  prepareFilePublication,
  SafeFileConflictError,
} from "../safe-file-publisher.js";
import { cleanupTemporaryRoots, workspace, utf8 } from "./test-support.js";
import type { VerificationHandle } from "./test-support.js";

afterEach(cleanupTemporaryRoots);

describe("prepared safe publication", () => {
  it("rejects a differently sized receiver without opening or reading its bytes", async () => {
    const root = await workspace("safe-file-inspect-size-");
    await writeFile(join(root, "receiver.bin"), Buffer.alloc(8 * 1024 * 1024, 1));
    const openVerification = vi.fn(async () => {
      throw new Error("differently sized destination must not be opened");
    });

    await expect(inspectFilePublicationDestination({
      root,
      relativePath: "receiver.bin",
      bytes: utf8("tiny"),
    }, { openVerification })).resolves.toBe("conflicting");
    expect(openVerification).not.toHaveBeenCalled();
  });

  it("rejects a differently sized receiver during final publication without opening it", async () => {
    const root = await workspace("safe-file-prepare-size-");
    await writeFile(join(root, "receiver.bin"), Buffer.alloc(8 * 1024 * 1024, 1));
    const openVerification = vi.fn(async () => {
      throw new Error("differently sized destination must not be opened");
    });

    await expect(prepareFilePublication({
      root,
      relativePath: "receiver.bin",
      bytes: utf8("tiny"),
      stageToken: "9".repeat(32),
    }, { openVerification })).rejects.toBeInstanceOf(SafeFileConflictError);
    expect(openVerification).not.toHaveBeenCalled();
  });

  it("rejects an A-to-B-to-A destination replacement during final comparison", async () => {
    const root = await workspace("safe-file-prepare-rebind-");
    const destination = join(root, "receiver.bin");
    const heldDestination = join(root, "held-receiver.bin");
    await writeFile(destination, "same bytes");

    await expect(prepareFilePublication({
      root,
      relativePath: "receiver.bin",
      bytes: utf8("same bytes"),
      stageToken: "8".repeat(32),
    }, {
      openVerification: async (path, flags) => {
        await rename(destination, heldDestination);
        await writeFile(destination, "same bytes", { flag: "wx" });
        const handle = await open(path, flags);
        return {
          stat: handle.stat.bind(handle),
          read: handle.read.bind(handle),
          readFile: handle.readFile.bind(handle),
          close: async () => {
            await handle.close();
            await unlink(destination);
            await rename(heldDestination, destination);
          },
        };
      },
    })).rejects.toThrow(/destination.*changed/i);

    await expect(readFile(destination, "utf8")).resolves.toBe("same bytes");
    await expect(lstat(heldDestination)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a same-inode rewrite after final comparison", async () => {
    const root = await workspace("safe-file-prepare-rewrite-");
    const destination = join(root, "receiver.bin");
    await writeFile(destination, "same bytes");

    await expect(prepareFilePublication({
      root,
      relativePath: "receiver.bin",
      bytes: utf8("same bytes"),
      stageToken: "7".repeat(32),
    }, {
      openVerification: async (path, flags) => {
        const handle = await open(path, flags);
        return {
          stat: handle.stat.bind(handle),
          read: handle.read.bind(handle),
          readFile: handle.readFile.bind(handle),
          close: async () => {
            await handle.close();
            await writeFile(destination, "other byte");
          },
        };
      },
    })).rejects.toThrow(/destination.*changed/i);

    await expect(readFile(destination, "utf8")).resolves.toBe("other byte");
  });

  it("rejects a same-inode rewrite hidden by a link-count transition", async () => {
    const root = await workspace("safe-file-prepare-rewrite-link-");
    const destination = join(root, "receiver.bin");
    const alias = join(root, "receiver-alias.bin");
    const fixedTime = new Date("2020-01-01T00:00:00.000Z");
    let rewritten = false;
    await writeFile(destination, "same bytes");
    await utimes(destination, fixedTime, fixedTime);

    await expect(prepareFilePublication({
      root,
      relativePath: "receiver.bin",
      bytes: utf8("same bytes"),
      stageToken: "6".repeat(32),
    }, {
      openVerification: async (path, flags) => {
        const handle = await open(path, flags);
        return {
          stat: handle.stat.bind(handle),
          read: handle.read.bind(handle),
          readFile: handle.readFile.bind(handle),
          close: async () => {
            await handle.close();
            if (!rewritten) {
              await writeFile(destination, "other byte");
              await utimes(destination, fixedTime, fixedTime);
              await link(destination, alias);
              rewritten = true;
            }
          },
        };
      },
    })).rejects.toBeInstanceOf(SafeFileConflictError);

    expect(rewritten).toBe(true);
    await expect(readFile(destination, "utf8")).resolves.toBe("other byte");
  });

  it("classifies repeated link transitions as a create-only conflict", async () => {
    const root = await workspace("safe-file-prepare-unstable-link-");
    const destination = join(root, "receiver.bin");
    const alias = join(root, "receiver-alias.bin");
    let aliasPresent = false;
    let transitions = 0;
    await writeFile(destination, "same bytes");

    await expect(prepareFilePublication({
      root,
      relativePath: "receiver.bin",
      bytes: utf8("same bytes"),
      stageToken: "5".repeat(32),
    }, {
      openVerification: async (path, flags) => {
        const handle = await open(path, flags);
        return {
          stat: (async (options?: { bigint?: boolean }) => {
            const stats = options?.bigint
              ? await handle.stat({ bigint: true })
              : await handle.stat();
            if (options?.bigint) {
              if (aliasPresent) await unlink(alias);
              else await link(destination, alias);
              aliasPresent = !aliasPresent;
              transitions += 1;
            }
            return stats;
          }) as VerificationHandle["stat"],
          read: handle.read.bind(handle),
          readFile: handle.readFile.bind(handle),
          close: handle.close.bind(handle),
        };
      },
    })).rejects.toBeInstanceOf(SafeFileConflictError);

    expect(transitions).toBe(3);
  });

  it("retries a link-count-only transition when ctime is unchanged", async () => {
    const root = await workspace("safe-file-prepare-nlink-only-");
    const destination = join(root, "receiver.bin");
    let statCalls = 0;
    await writeFile(destination, "same bytes");

    const prepared = await prepareFilePublication({
      root,
      relativePath: "receiver.bin",
      bytes: utf8("same bytes"),
      stageToken: "4".repeat(32),
    }, {
      openVerification: async (path, flags) => {
        const handle = await open(path, flags);
        return {
          stat: (async (options?: { bigint?: boolean }) => {
            const stats = options?.bigint
              ? await handle.stat({ bigint: true })
              : await handle.stat();
            statCalls += 1;
            if (options?.bigint && statCalls === 2) {
              return new Proxy(stats, {
                get(target, property) {
                  if (property === "nlink") return BigInt(target.nlink) + 1n;
                  const value = Reflect.get(target, property, target);
                  return typeof value === "function" ? value.bind(target) : value;
                },
              });
            }
            return stats;
          }) as VerificationHandle["stat"],
          read: handle.read.bind(handle),
          readFile: handle.readFile.bind(handle),
          close: handle.close.bind(handle),
        };
      },
    });

    expect(statCalls).toBeGreaterThanOrEqual(4);
    expect(prepared).toMatchObject({ created: false, stagePath: null });
  });

  it("exposes synced stage ownership before creating the destination", async () => {
    const root = await workspace("safe-file-prepared-");
    const prepared = await prepareFilePublication({
      root,
      relativePath: "assets/imports/capture.png",
      bytes: utf8("capture"),
      stageToken: "a".repeat(32),
    });

    expect(prepared.created).toBe(true);
    await expect(readFile(prepared.stagePath!, "utf8")).resolves.toBe("capture");
    await expect(readFile(prepared.path)).rejects.toMatchObject({ code: "ENOENT" });

    const committed = await prepared.commit();

    expect(committed).toMatchObject({ created: true, ownership: prepared.ownership });
    await expect(readFile(prepared.path, "utf8")).resolves.toBe("capture");
    await expect(readFile(prepared.stagePath!)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("retains exact stage and destination evidence when directory sync fails", async () => {
    const root = await workspace("safe-file-prepared-sync-");
    const prepared = await prepareFilePublication({
      root,
      relativePath: "assets/imports/capture.png",
      bytes: utf8("capture"),
      stageToken: "b".repeat(32),
    }, {
      openDirectory: async () => {
        const error = new Error("injected directory sync failure") as NodeJS.ErrnoException;
        error.code = "EIO";
        throw error;
      },
    });

    await expect(prepared.commit()).rejects.toThrow(/directory sync failure/i);
    await expect(readFile(prepared.path, "utf8")).resolves.toBe("capture");
    await expect(readFile(prepared.stagePath!, "utf8")).resolves.toBe("capture");
    expect((await lstat(prepared.path, { bigint: true })).ino).toBe(
      (await lstat(prepared.stagePath!, { bigint: true })).ino,
    );
  });

  it("recognizes a hard link that committed even when link reported an error", async () => {
    const root = await workspace("safe-file-prepared-ambiguous-link-");
    const prepared = await prepareFilePublication({
      root,
      relativePath: "assets/imports/capture.png",
      bytes: utf8("capture"),
      stageToken: "c".repeat(32),
    }, {
      async linkFile(source, destination) {
        await link(source, destination);
        const error = new Error("ambiguous link result") as NodeJS.ErrnoException;
        error.code = "EEXIST";
        throw error;
      },
    });

    await expect(prepared.commit()).resolves.toMatchObject({ created: true });
    await expect(readFile(prepared.path, "utf8")).resolves.toBe("capture");
    await expect(readFile(prepared.stagePath!)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
