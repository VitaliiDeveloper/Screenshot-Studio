// SPDX-License-Identifier: Apache-2.0
import {
  link,
  lstat,
  open,
  readFile,
  readdir,
  rename,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupTemporaryRoots,
  workspace,
  utf8,
  publishWithDependencies,
  canonicalDestination,
} from "./test-support.js";

afterEach(cleanupTemporaryRoots);

describe("publishFileSafely", () => {
  it("syncs the complete sibling stage before the destination becomes visible", async () => {
    const root = await workspace("safe-file-stage-sync-order-");
    const destination = join(root, "resource.txt");
    const events: string[] = [];

    await publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("complete"),
    }, {
      randomId: () => "sync-order",
      openStage: async (path, flags, mode) => {
        const handle = await open(path, flags, mode);
        return {
          writeFile: async (bytes) => {
            events.push("write");
            await handle.writeFile(bytes);
          },
          sync: async () => {
            events.push("sync");
            await handle.sync();
          },
          close: () => handle.close(),
        };
      },
      beforePublication: async () => {
        events.push("before-publication");
        await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
      },
      linkFile: async (source, target) => {
        events.push("publish");
        await link(source, target);
      },
    });

    expect(events).toEqual(["write", "sync", "before-publication", "publish"]);
    expect(await readFile(destination, "utf8")).toBe("complete");
  });

  it("cleans its owned stage after a stage write failure", async () => {
    const root = await workspace("safe-file-stage-write-failure-");

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("bytes"),
    }, {
      randomId: () => "write-failure",
      openStage: async (path, flags, mode) => {
        const handle = await open(path, flags, mode);
        return {
          writeFile: async () => { throw new Error("stage write failed"); },
          sync: () => handle.sync(),
          close: () => handle.close(),
        };
      },
    })).rejects.toThrow("stage write failed");

    expect(await readdir(root)).toEqual([]);
  });

  it("cleans its owned stage when the opened stage cannot be inspected", async () => {
    const root = await workspace("safe-file-stage-stat-failure-");

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("bytes"),
    }, {
      randomId: () => "stat-failure",
      openStage: async (path, flags, mode) => {
        const handle = await open(path, flags, mode);
        return {
          writeFile: handle.writeFile.bind(handle),
          sync: handle.sync.bind(handle),
          close: handle.close.bind(handle),
          stat: async () => { throw new Error("stage stat failed"); },
        };
      },
    })).rejects.toThrow("stage stat failed");

    expect(await readdir(root)).toEqual([]);
  });

  it("reports the retained private quarantine when failed-stage cleanup cannot unlink", async () => {
    const root = await workspace("safe-file-stage-write-recovery-path-");
    let recoveryPath = "";

    const error = await publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("partial bytes"),
    }, {
      randomId: () => "write-recovery-path",
      openStage: async (path, flags, mode) => {
        const handle = await open(path, flags, mode);
        return {
          writeFile: handle.writeFile.bind(handle),
          sync: async () => { throw new Error("stage sync failed"); },
          close: handle.close.bind(handle),
          stat: handle.stat.bind(handle),
        };
      },
      quarantineFile: async (source, target) => {
        recoveryPath = target;
        await rename(source, target);
      },
      removeStage: async () => { throw new Error("cleanup unlink failed"); },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as Error).message).toContain(recoveryPath);
    expect((error as Error).message).toMatch(/recovery retained/i);
    expect(await readFile(recoveryPath, "utf8")).toBe("partial bytes");
  });

  it("reconciles failed-stage cleanup when unlink commits before throwing", async () => {
    const root = await workspace("safe-file-stage-write-cleanup-ambiguous-");
    let recoveryPath = "";

    const error = await publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("partial bytes"),
    }, {
      randomId: () => "write-cleanup-ambiguous",
      openStage: async (path, flags, mode) => {
        const handle = await open(path, flags, mode);
        return {
          writeFile: handle.writeFile.bind(handle),
          sync: async () => { throw new Error("stage sync failed"); },
          close: handle.close.bind(handle),
          stat: handle.stat.bind(handle),
        };
      },
      quarantineFile: async (source, target) => {
        recoveryPath = target;
        await rename(source, target);
      },
      removeStage: async (path) => {
        await unlink(path);
        throw new Error("cleanup unlink completion unknown");
      },
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ message: "stage sync failed" });
    expect(error).not.toBeInstanceOf(AggregateError);
    await expect(lstat(recoveryPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("quarantines a replacement installed while cleaning a failed stage write", async () => {
    const root = await workspace("safe-file-stage-write-cleanup-quarantine-");
    const heldStage = join(root, "held-stage");
    let stagePath = "";
    let quarantinePath = "";
    let swapped = false;

    const replaceStage = async (): Promise<void> => {
      await rename(stagePath, heldStage);
      await writeFile(stagePath, "write cleanup competitor", { flag: "wx" });
      swapped = true;
    };

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("owned bytes"),
    }, {
      randomId: () => "write-cleanup-quarantine",
      openStage: async (path, flags, mode) => {
        stagePath = path;
        const handle = await open(path, flags, mode);
        return {
          writeFile: async () => { throw new Error("stage write failed"); },
          sync: handle.sync.bind(handle),
          close: handle.close.bind(handle),
          stat: handle.stat.bind(handle),
        };
      },
      quarantineFile: async (source, target) => {
        if (!swapped && source === stagePath) await replaceStage();
        quarantinePath = target;
        await rename(source, target);
      },
      removeStage: async (path) => {
        if (!swapped && path === stagePath) await replaceStage();
        await unlink(path);
      },
    })).rejects.toThrow(/stage write failed/);

    expect(swapped).toBe(true);
    expect(await readFile(stagePath, "utf8")).toBe("write cleanup competitor");
    expect(await readFile(quarantinePath, "utf8")).toBe("write cleanup competitor");
    expect(await readFile(heldStage, "utf8")).toBe("");
  });

  it("does not claim a vanished cleanup quarantine is retained", async () => {
    const root = await workspace("safe-file-stage-cleanup-vanished-recovery-");
    let removedRecovery = false;

    const error = await publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("bytes"),
    }, {
      randomId: () => "vanished-recovery",
      openStage: async (path, flags, mode) => {
        const handle = await open(path, flags, mode);
        return {
          writeFile: handle.writeFile.bind(handle),
          sync: async () => { throw new Error("stage sync failed"); },
          close: handle.close.bind(handle),
          stat: handle.stat.bind(handle),
        };
      },
      openVerification: async (path, flags) => {
        if (!removedRecovery && path.includes("creation-quarantine")) {
          await unlink(path);
          removedRecovery = true;
        }
        return open(path, flags);
      },
    }).catch((caught: unknown) => caught);

    expect(removedRecovery).toBe(true);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as Error).message).toMatch(/recovery entry disappeared/i);
    expect((error as Error).message).not.toMatch(/recovery retained/i);
  });

  it("never cleans a failed stage through a swapped ancestor", async () => {
    const root = await workspace("safe-file-stage-cleanup-ancestor-swap-");
    const outside = await workspace("safe-file-stage-cleanup-ancestor-outside-");
    const nested = join(root, "nested");
    const held = join(root, "held");
    const outsideStage = join(outside, ".resource.txt.write-ancestor-swap.tmp");

    await expect(publishWithDependencies({
      root,
      relativePath: "nested/resource.txt",
      bytes: utf8("owned stage"),
    }, {
      randomId: () => "write-ancestor-swap",
      openStage: async (path, flags, mode) => {
        const handle = await open(path, flags, mode);
        return {
          writeFile: async (bytes) => {
            await handle.writeFile(bytes);
            await rename(nested, held);
            await writeFile(outsideStage, "outside sentinel");
            await symlink(outside, nested);
            throw new Error("stage write failed");
          },
          sync: () => handle.sync(),
          close: () => handle.close(),
        };
      },
    })).rejects.toThrow(/stage write failed/);

    expect(await readFile(outsideStage, "utf8")).toBe("outside sentinel");
    expect(await readFile(join(held, ".resource.txt.write-ancestor-swap.tmp"), "utf8"))
      .toBe("owned stage");
  });

  it("preserves old bytes and cleans its stage after a stage sync failure", async () => {
    const root = await workspace("safe-file-stage-sync-failure-");
    const destination = join(root, "resource.txt");
    await writeFile(destination, "old bytes");

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("new bytes"),
      replace: true,
    }, {
      randomId: () => "sync-failure",
      openStage: async (path, flags, mode) => {
        const handle = await open(path, flags, mode);
        return {
          writeFile: (bytes) => handle.writeFile(bytes),
          sync: async () => { throw new Error("stage sync failed"); },
          close: () => handle.close(),
        };
      },
    })).rejects.toThrow("stage sync failed");

    expect(await readFile(destination, "utf8")).toBe("old bytes");
    expect(await readdir(root)).toEqual(["resource.txt"]);
  });

  it("propagates falsy stage failures and cleans only the owned stage", async () => {
    const thrownValues: unknown[] = [undefined, null, false, 0, ""];

    for (const [index, thrownValue] of thrownValues.entries()) {
      const root = await workspace(`safe-file-falsy-stage-${index}-`);
      let rejected = false;
      try {
        await publishWithDependencies({
          root,
          relativePath: "resource.txt",
          bytes: utf8("bytes"),
        }, {
          randomId: () => `falsy-${index}`,
          openStage: async (path, flags, mode) => {
            const handle = await open(path, flags, mode);
            return {
              writeFile: (bytes) => handle.writeFile(bytes),
              sync: async () => { throw thrownValue; },
              close: () => handle.close(),
            };
          },
        });
      } catch (error) {
        rejected = true;
        expect(error).toBe(thrownValue);
      }

      expect(rejected).toBe(true);
      expect(await readdir(root)).toEqual([]);
    }
  });

  it("does not treat a falsy cleanup failure as successful create-only reuse", async () => {
    const root = await workspace("safe-file-falsy-cleanup-");
    const destination = await canonicalDestination(root, "resource.txt");
    let stagePath = "";
    let rejected = false;

    try {
      await publishWithDependencies({
        root,
        relativePath: "resource.txt",
        bytes: utf8("same bytes"),
      }, {
        randomId: () => "falsy-cleanup",
        beforePublication: async (context) => {
          stagePath = context.stagePath;
          await writeFile(destination, "same bytes", { flag: "wx" });
        },
        quarantineFile: async () => { throw null; },
      });
    } catch (error) {
      rejected = true;
      expect(error).toBeNull();
    }

    expect(rejected).toBe(true);
    expect(await readFile(destination, "utf8")).toBe("same bytes");
    expect(await readFile(stagePath, "utf8")).toBe("same bytes");
  });

  it("reconciles a stage quarantine rename that commits before throwing", async () => {
    const root = await workspace("safe-file-stage-quarantine-ambiguous-");
    const destination = await canonicalDestination(root, "resource.txt");
    let stagePath = "";
    let quarantinePath = "";

    const error = await publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("same bytes"),
    }, {
      randomId: () => "stage-quarantine-ambiguous",
      beforePublication: async (context) => {
        stagePath = context.stagePath;
        await writeFile(destination, "same bytes", { flag: "wx" });
      },
      quarantineFile: async (source, target) => {
        quarantinePath = target;
        await rename(source, target);
        throw new Error("stage quarantine completion unknown");
      },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as Error).message).toContain(quarantinePath);
    expect(await readFile(stagePath, "utf8")).toBe("same bytes");
    expect(await readFile(quarantinePath, "utf8")).toBe("same bytes");
  });

  it("preserves old bytes and cleans its stage after replacement publication fails", async () => {
    const root = await workspace("safe-file-replace-failure-");
    const destination = join(root, "resource.txt");
    await writeFile(destination, "old bytes");

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("new bytes"),
      replace: true,
    }, {
      randomId: () => "replace-failure",
      moveFile: async () => { throw new Error("replacement failed"); },
    })).rejects.toThrow("replacement failed");

    expect(await readFile(destination, "utf8")).toBe("old bytes");
    expect(await readdir(root)).toEqual(["resource.txt"]);
  });

  it("propagates a falsy replacement failure after cleaning the owned stage", async () => {
    const root = await workspace("safe-file-falsy-replace-");
    const destination = join(root, "resource.txt");
    await writeFile(destination, "old bytes");
    let rejected = false;

    try {
      await publishWithDependencies({
        root,
        relativePath: "resource.txt",
        bytes: utf8("new bytes"),
        replace: true,
      }, {
        randomId: () => "falsy-replace",
        moveFile: async () => { throw undefined; },
      });
    } catch (error) {
      rejected = true;
      expect(error).toBeUndefined();
    }

    expect(rejected).toBe(true);
    expect(await readFile(destination, "utf8")).toBe("old bytes");
    expect(await readdir(root)).toEqual(["resource.txt"]);
  });

  it("cleans its stage when create-only publication fails", async () => {
    const root = await workspace("safe-file-link-failure-");

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("bytes"),
    }, {
      randomId: () => "link-failure",
      linkFile: async () => { throw new Error("link failed"); },
    })).rejects.toThrow("link failed");

    expect(await readdir(root)).toEqual([]);
  });
});
