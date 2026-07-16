// SPDX-License-Identifier: Apache-2.0
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  publishFileSafely,
  SafeFileConflictError,
  type SafeFilePublication,
} from "./safe-file-publisher.js";

const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

type StageHandle = Pick<FileHandle, "writeFile" | "sync" | "close">
  & Partial<Pick<FileHandle, "stat">>;
type VerificationHandle = Pick<FileHandle, "stat" | "readFile" | "close">;

interface TestPublicationDependencies {
  randomId?: () => string;
  openStage?: (path: string, flags: number, mode: number) => Promise<StageHandle>;
  openVerification?: (path: string, flags: number) => Promise<VerificationHandle>;
  linkFile?: (source: string, destination: string) => Promise<void>;
  moveFile?: (source: string, destination: string) => Promise<void>;
  quarantineFile?: (source: string, destination: string) => Promise<void>;
  restoreLink?: (source: string, destination: string) => Promise<void>;
  removeStage?: (path: string) => Promise<void>;
  beforePublication?: (context: {
    destinationPath: string;
    stagePath: string;
    mode: "create-only" | "replace";
  }) => Promise<void>;
}

const publishWithDependencies = publishFileSafely as unknown as (
  options: SafeFilePublication,
  dependencies?: TestPublicationDependencies,
) => Promise<{ path: string; created: boolean }>;

async function stageEntries(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter((name) => name.startsWith(".") && name.endsWith(".tmp"));
}

async function canonicalDestination(root: string, relativePath: string): Promise<string> {
  return join(await realpath(root), relativePath);
}

describe("publishFileSafely", () => {
  it("creates a Unicode file below normal missing nested directories", async () => {
    const root = await workspace("safe-file-unicode-");
    const relativePath = "ресурси/日本語/éxample.txt";
    const bytes = new TextEncoder().encode("complete bytes");

    await expect(publishFileSafely({ root, relativePath, bytes })).resolves.toEqual({
      path: await canonicalDestination(root, relativePath),
      created: true,
    });

    expect(await readFile(join(root, relativePath))).toEqual(Buffer.from(bytes));
    expect(await readdir(join(root, "ресурси/日本語"))).toEqual(["éxample.txt"]);
  });

  it("safely creates a missing root below its nearest existing canonical directory", async () => {
    const base = await workspace("safe-file-missing-root-");
    const root = join(base, "exports", "nested");

    const result = await publishFileSafely({
      root,
      relativePath: "resource.txt",
      bytes: utf8("bytes"),
    });

    expect(result).toEqual({
      path: join(await realpath(root), "resource.txt"),
      created: true,
    });
    expect(await readFile(join(root, "resource.txt"), "utf8")).toBe("bytes");
  });

  it("rejects every invalid portable project-relative path before mutation", async () => {
    const root = await workspace("safe-file-invalid-path-");
    const invalidPaths = [
      "",
      ".",
      "..",
      "nested/./file.txt",
      "nested/../file.txt",
      "/absolute.txt",
      "//server/share.txt",
      "nested//file.txt",
      "nested/",
      "nested\\file.txt",
      "C:/drive.txt",
      "https:resource.txt",
      "nul\0byte.txt",
    ];

    for (const relativePath of invalidPaths) {
      await expect(publishFileSafely({ root, relativePath, bytes: utf8("unsafe") }))
        .rejects.toThrow(/portable project-relative path/);
    }

    expect(await readdir(root)).toEqual([]);
  });

  it("rejects a symbolic-link root without changing its target", async () => {
    const base = await workspace("safe-file-root-symlink-");
    const outside = join(base, "outside");
    const rootLink = join(base, "root-link");
    await mkdir(outside);
    await writeFile(join(outside, "sentinel.txt"), "outside");
    await symlink(outside, rootLink);

    await expect(publishFileSafely({ root: rootLink, relativePath: "sentinel.txt", bytes: utf8("changed") }))
      .rejects.toThrow(/symbolic link.*root/i);

    expect(await readFile(join(outside, "sentinel.txt"), "utf8")).toBe("outside");
  });

  it("rejects a symbolic link in the ancestry of a missing root", async () => {
    const base = await workspace("safe-file-missing-root-symlink-");
    const outside = await workspace("safe-file-missing-root-outside-");
    const linked = join(base, "linked");
    await symlink(outside, linked);

    await expect(publishFileSafely({
      root: join(linked, "new-root"),
      relativePath: "resource.txt",
      bytes: utf8("bytes"),
    })).rejects.toThrow(/symbolic link.*root/i);

    expect(await readdir(outside)).toEqual([]);
  });

  it("rejects a non-directory root", async () => {
    const base = await workspace("safe-file-root-file-");
    const rootFile = join(base, "root-file");
    await writeFile(rootFile, "not a directory");

    await expect(publishFileSafely({ root: rootFile, relativePath: "file.txt", bytes: utf8("bytes") }))
      .rejects.toThrow(/root.*directory/i);

    expect(await readFile(rootFile, "utf8")).toBe("not a directory");
  });

  it("rejects a symbolic-link ancestor without writing outside the root", async () => {
    const root = await workspace("safe-file-ancestor-symlink-");
    const outside = await workspace("safe-file-ancestor-outside-");
    const sentinel = join(outside, "sentinel.txt");
    await writeFile(sentinel, "outside");
    await symlink(outside, join(root, "linked"));

    await expect(publishFileSafely({
      root,
      relativePath: "linked/sentinel.txt",
      bytes: utf8("changed"),
      replace: true,
    })).rejects.toThrow(/symbolic link.*ancestor/i);

    expect(await readFile(sentinel, "utf8")).toBe("outside");
  });

  it("rejects a non-directory ancestor", async () => {
    const root = await workspace("safe-file-ancestor-file-");
    await writeFile(join(root, "blocked"), "not a directory");

    await expect(publishFileSafely({
      root,
      relativePath: "blocked/file.txt",
      bytes: utf8("bytes"),
    })).rejects.toThrow(/ancestor.*not a directory/i);
  });

  it("rejects a symbolic-link leaf without following or replacing it", async () => {
    const root = await workspace("safe-file-leaf-symlink-");
    const outside = await workspace("safe-file-leaf-outside-");
    const destination = join(root, "resource.txt");
    const sentinel = join(outside, "sentinel.txt");
    await writeFile(sentinel, "outside");
    await symlink(sentinel, destination);

    await expect(publishFileSafely({
      root,
      relativePath: "resource.txt",
      bytes: utf8("changed"),
      replace: true,
    })).rejects.toThrow(/symbolic link.*destination/i);

    expect((await lstat(destination)).isSymbolicLink()).toBe(true);
    expect(await readFile(sentinel, "utf8")).toBe("outside");
  });

  it("rejects a directory leaf", async () => {
    const root = await workspace("safe-file-leaf-directory-");
    await mkdir(join(root, "resource.txt"));

    await expect(publishFileSafely({
      root,
      relativePath: "resource.txt",
      bytes: utf8("bytes"),
      replace: true,
    })).rejects.toThrow(/destination.*regular file/i);

    expect((await lstat(join(root, "resource.txt"))).isDirectory()).toBe(true);
  });

  it.skipIf(process.platform === "win32")("rejects a device leaf", async () => {
    await expect(publishFileSafely({
      root: "/dev",
      relativePath: "null",
      bytes: utf8("bytes"),
      replace: true,
    })).rejects.toThrow(/destination.*regular file/i);
  });

  it("does not overwrite a different regular leaf swapped in immediately before create-only publication", async () => {
    const root = await workspace("safe-file-leaf-swap-regular-");
    const destination = join(root, "resource.txt");

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("ours"),
    }, {
      beforePublication: async ({ destinationPath }) => {
        await writeFile(destinationPath, "competitor", { flag: "wx" });
      },
    })).rejects.toThrow(/different bytes/);

    expect(await readFile(destination, "utf8")).toBe("competitor");
    expect(await stageEntries(root)).toEqual([]);
  });

  it("does not follow or replace a symbolic-link leaf swapped in immediately before publication", async () => {
    const root = await workspace("safe-file-leaf-swap-symlink-");
    const outside = await workspace("safe-file-leaf-swap-outside-");
    const destination = join(root, "resource.txt");
    const sentinel = join(outside, "sentinel.txt");
    await writeFile(sentinel, "outside");

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("ours"),
    }, {
      beforePublication: async ({ destinationPath }) => {
        await symlink(sentinel, destinationPath);
      },
    })).rejects.toThrow(/symbolic link.*destination/i);

    expect((await lstat(destination)).isSymbolicLink()).toBe(true);
    expect(await readFile(sentinel, "utf8")).toBe("outside");
    expect(await stageEntries(root)).toEqual([]);
  });

  it("rejects a replaced stage without publishing or removing the unowned replacement", async () => {
    const root = await workspace("safe-file-stage-swap-");
    const destination = join(root, "resource.txt");
    const heldOwnedStage = join(root, "held-owned-stage");
    let swappedStage = "";

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("owned bytes"),
    }, {
      randomId: () => "stage-swap",
      beforePublication: async ({ stagePath }) => {
        swappedStage = stagePath;
        await rename(stagePath, heldOwnedStage);
        await writeFile(stagePath, "attacker bytes", { flag: "wx" });
      },
    })).rejects.toThrow(/stage.*changed/i);

    await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(swappedStage, "utf8")).toBe("attacker bytes");
    expect(await readFile(heldOwnedStage, "utf8")).toBe("owned bytes");
  });

  it("rejects same-inode stage content changed before publication", async () => {
    const root = await workspace("safe-file-stage-content-swap-");
    const destination = join(root, "resource.txt");
    let stagePath = "";

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("owned bytes"),
    }, {
      randomId: () => "stage-content-swap",
      beforePublication: async (context) => {
        stagePath = context.stagePath;
        await writeFile(stagePath, "attacker bytes");
      },
    })).rejects.toThrow(/stage.*changed/i);

    await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(stagePath, "utf8")).toBe("attacker bytes");
  });

  it("rejects a stage with an unexpected hard-link alias before publication", async () => {
    const root = await workspace("safe-file-stage-hard-link-");
    const destination = join(root, "resource.txt");
    const alias = join(root, "attacker-alias");

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("owned bytes"),
    }, {
      randomId: () => "stage-hard-link",
      beforePublication: async ({ stagePath }) => {
        await link(stagePath, alias);
      },
    })).rejects.toThrow(/stage.*changed/i);

    await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(alias, "utf8")).toBe("owned bytes");
    expect(await stageEntries(root)).toEqual([".resource.txt.stage-hard-link.tmp"]);
  });

  it("never cleans through an ancestor swapped after staging", async () => {
    const root = await workspace("safe-file-cleanup-ancestor-swap-");
    const outside = await workspace("safe-file-cleanup-ancestor-outside-");
    const nested = join(root, "nested");
    const held = join(root, "held");
    const outsideStage = join(outside, ".resource.txt.ancestor-swap.tmp");

    await expect(publishWithDependencies({
      root,
      relativePath: "nested/resource.txt",
      bytes: utf8("owned stage"),
    }, {
      randomId: () => "ancestor-swap",
      beforePublication: async () => {
        await rename(nested, held);
        await writeFile(outsideStage, "outside sentinel");
        await symlink(outside, nested);
      },
    })).rejects.toThrow(/symbolic link.*ancestor/i);

    expect(await readFile(outsideStage, "utf8")).toBe("outside sentinel");
    expect(await readFile(join(held, ".resource.txt.ancestor-swap.tmp"), "utf8"))
      .toBe("owned stage");
  });

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

  it("reconciles a hard-link publication that commits before throwing", async () => {
    const root = await workspace("safe-file-link-ambiguous-commit-");
    const destination = await canonicalDestination(root, "resource.txt");

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("published bytes"),
    }, {
      randomId: () => "link-ambiguous-commit",
      linkFile: async (source, target) => {
        await link(source, target);
        throw new Error("link completion unknown");
      },
    })).resolves.toEqual({ path: destination, created: true });

    expect(await readFile(destination, "utf8")).toBe("published bytes");
    expect(await readdir(root)).toEqual(["resource.txt"]);
  });

  it("reconciles committed hard-link publication when a competitor occupies the old stage name", async () => {
    const root = await workspace("safe-file-link-ambiguous-stage-competitor-");
    const destination = await canonicalDestination(root, "resource.txt");
    let stagePath = "";

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("published bytes"),
    }, {
      randomId: () => "link-ambiguous-stage-competitor",
      beforePublication: async (context) => {
        stagePath = context.stagePath;
      },
      linkFile: async (source, target) => {
        await link(source, target);
        await unlink(source);
        await writeFile(source, "competitor", { flag: "wx" });
        throw new Error("link completion unknown");
      },
    })).resolves.toEqual({ path: destination, created: true });

    expect(await readFile(destination, "utf8")).toBe("published bytes");
    expect(await readFile(stagePath, "utf8")).toBe("competitor");
  });

  it("retains a publication error when owned-stage cleanup also fails", async () => {
    const root = await workspace("safe-file-cleanup-failure-");
    const destination = join(root, "resource.txt");
    await writeFile(destination, "old bytes");

    let recoveryPath = "";
    const error = await publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("new bytes"),
      replace: true,
    }, {
      randomId: () => "cleanup-failure",
      moveFile: async () => { throw new Error("primary publication failed"); },
      quarantineFile: async (source, target) => {
        recoveryPath = target;
        await rename(source, target);
      },
      removeStage: async () => { throw new Error("stage cleanup failed"); },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AggregateError);
    expect(error).toMatchObject({ cause: expect.objectContaining({ message: "primary publication failed" }) });
    expect((error as AggregateError).errors[0]).toMatchObject({ message: "primary publication failed" });
    expect((error as Error).message).toMatch(/primary publication failed.*stage cleanup failed/);
    expect((error as Error).message).toContain(recoveryPath);
    expect((error as Error).message).toMatch(/recovery retained/i);
    expect(await readFile(destination, "utf8")).toBe("old bytes");
    expect(await readFile(recoveryPath, "utf8")).toBe("new bytes");
  });

  it("reconciles noncommitted stage cleanup when unlink commits before throwing", async () => {
    const root = await workspace("safe-file-cleanup-ambiguous-unlink-");
    const destination = join(root, "resource.txt");
    let recoveryPath = "";
    await writeFile(destination, "old bytes");

    const error = await publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("new bytes"),
      replace: true,
    }, {
      randomId: () => "cleanup-ambiguous-unlink",
      moveFile: async () => { throw new Error("primary publication failed"); },
      quarantineFile: async (source, target) => {
        recoveryPath = target;
        await rename(source, target);
      },
      removeStage: async (path) => {
        await unlink(path);
        throw new Error("stage cleanup completion unknown");
      },
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ message: "primary publication failed" });
    expect(error).not.toBeInstanceOf(AggregateError);
    expect(await readFile(destination, "utf8")).toBe("old bytes");
    await expect(lstat(recoveryPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports successful hard-link publication even when owned-stage cleanup fails", async () => {
    const root = await workspace("safe-file-published-cleanup-failure-");
    const destination = join(root, "resource.txt");

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("published bytes"),
    }, {
      randomId: () => "published-cleanup-failure",
      removeStage: async () => { throw new Error("stage cleanup failed"); },
    })).resolves.toEqual({
      path: await canonicalDestination(root, "resource.txt"),
      created: true,
    });

    expect(await readFile(destination, "utf8")).toBe("published bytes");
    const entries = await readdir(root);
    expect(entries).toContain("resource.txt");
    expect(entries).toHaveLength(2);
    expect(entries.find((entry) => entry !== "resource.txt")).toMatch(
      /^\.resource\.txt\.published-cleanup-failure\.tmp\.[0-9a-f-]+\.quarantine$/,
    );
  });

  it("keeps committed success when stage quarantine fails before rename", async () => {
    const root = await workspace("safe-file-published-quarantine-pre-failure-");
    const destination = await canonicalDestination(root, "resource.txt");
    let stagePath = "";

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("published bytes"),
    }, {
      randomId: () => "quarantine-pre-failure",
      beforePublication: async (context) => {
        stagePath = context.stagePath;
      },
      quarantineFile: async () => {
        throw new Error("stage quarantine failed before rename");
      },
    })).resolves.toEqual({ path: destination, created: true });

    expect(await readFile(destination, "utf8")).toBe("published bytes");
    expect(await readFile(stagePath, "utf8")).toBe("published bytes");
  });

  it("keeps committed success when stage quarantine commits before throwing", async () => {
    const root = await workspace("safe-file-published-quarantine-post-failure-");
    const destination = await canonicalDestination(root, "resource.txt");
    let quarantinePath = "";

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("published bytes"),
    }, {
      randomId: () => "quarantine-post-failure",
      quarantineFile: async (source, target) => {
        quarantinePath = target;
        await rename(source, target);
        throw new Error("stage quarantine completion unknown");
      },
    })).resolves.toEqual({ path: destination, created: true });

    expect(await readFile(destination, "utf8")).toBe("published bytes");
    await expect(lstat(quarantinePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not use a predictable quarantine path that a competitor can preoccupy", async () => {
    const root = await workspace("safe-file-published-private-quarantine-");
    const destination = await canonicalDestination(root, "resource.txt");
    let predictableQuarantine = "";

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("published bytes"),
    }, {
      randomId: () => "private-quarantine",
      beforePublication: async ({ stagePath }) => {
        predictableQuarantine = `${stagePath}.quarantine`;
        await writeFile(predictableQuarantine, "competitor", { flag: "wx" });
      },
    })).resolves.toEqual({ path: destination, created: true });

    expect(await readFile(destination, "utf8")).toBe("published bytes");
    expect(await readFile(predictableQuarantine, "utf8")).toBe("competitor");
  });

  it("rejects a destination replacement made by a failing post-commit cleanup", async () => {
    const root = await workspace("safe-file-published-cleanup-rebind-");
    const destination = await canonicalDestination(root, "resource.txt");
    const heldPublication = join(root, "held-publication");
    let swapped = false;

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("published bytes"),
    }, {
      randomId: () => "cleanup-rebind",
      removeStage: async () => {
        if (!swapped) {
          await rename(destination, heldPublication);
          await writeFile(destination, "competitor", { flag: "wx" });
          swapped = true;
        }
        throw new Error("stage cleanup failed");
      },
    })).rejects.toThrow(/destination.*changed/i);

    expect(swapped).toBe(true);
    expect(await readFile(destination, "utf8")).toBe("competitor");
    expect(await readFile(heldPublication, "utf8")).toBe("published bytes");
  });

  it("rejects a post-commit stage integrity failure instead of treating it as cleanup-only", async () => {
    const root = await workspace("safe-file-published-integrity-failure-");
    const destination = join(root, "resource.txt");

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("published bytes"),
    }, {
      randomId: () => "published-integrity-failure",
      linkFile: async (source, target) => {
        await link(source, target);
        await writeFile(source, "corrupted bytes");
      },
    })).rejects.toThrow(/stage.*changed|destination.*changed/i);

    expect(await readFile(destination, "utf8")).toBe("corrupted bytes");
  });

  it("rejects a committed destination name moved to an alias while preserving its competitor", async () => {
    const root = await workspace("safe-file-published-destination-binding-");
    const destination = join(root, "resource.txt");
    const heldPublication = join(root, "held-publication");
    let initialPublication = true;

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("published bytes"),
    }, {
      randomId: () => "destination-binding",
      linkFile: async (source, target) => {
        await link(source, target);
        if (initialPublication) {
          initialPublication = false;
          await rename(target, heldPublication);
          await writeFile(target, "competitor", { flag: "wx" });
        }
      },
    })).rejects.toThrow(/destination.*changed/i);

    expect(await readFile(destination, "utf8")).toBe("competitor");
    expect(await readFile(heldPublication, "utf8")).toBe("published bytes");
  });

  it("quarantines a rollback replacement and never overwrites an occupant at restore", async () => {
    const root = await workspace("safe-file-published-rollback-quarantine-");
    const destination = await canonicalDestination(root, "resource.txt");
    const heldPublication = join(root, "held-publication");
    const alias = join(root, "publication-alias");
    let quarantinePath = "";
    let rollbackSwapped = false;
    let restoreOccupied = false;

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("published bytes"),
    }, {
      randomId: () => "rollback-quarantine",
      linkFile: async (source, target) => {
        await link(source, target);
        if (!quarantinePath && target === destination) await link(source, alias);
      },
      quarantineFile: async (source, target) => {
        if (!rollbackSwapped && source === destination) {
          await rename(destination, heldPublication);
          await writeFile(destination, "rollback competitor", { flag: "wx" });
          quarantinePath = target;
          rollbackSwapped = true;
        }
        await rename(source, target);
      },
      restoreLink: async (source, target) => {
        if (source === quarantinePath && target === destination) {
          await writeFile(destination, "restore-boundary competitor", { flag: "wx" });
          restoreOccupied = true;
        }
        await link(source, target);
      },
    })).rejects.toThrow(/rollback failed|recovery/i);

    expect(rollbackSwapped).toBe(true);
    expect(restoreOccupied).toBe(true);
    expect(await readFile(destination, "utf8")).toBe("restore-boundary competitor");
    expect(await readFile(quarantinePath, "utf8")).toBe("rollback competitor");
    expect(await readFile(heldPublication, "utf8")).toBe("published bytes");
  });

  it("cleans both exact committed links after a transient destination verification failure", async () => {
    const root = await workspace("safe-file-published-exact-rollback-");
    const destination = await canonicalDestination(root, "resource.txt");
    let failedDestinationVerification = false;

    const error = await publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("published bytes"),
    }, {
      randomId: () => "exact-rollback",
      openVerification: async (path, flags) => {
        if (!failedDestinationVerification && path === destination) {
          failedDestinationVerification = true;
          throw new Error("transient destination verification failure");
        }
        return open(path, flags);
      },
    }).catch((caught: unknown) => caught);

    expect(failedDestinationVerification).toBe(true);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AggregateError);
    expect((error as Error).message).toMatch(/destination.*changed/i);
    expect(await readdir(root)).toEqual([]);
  });

  it("rolls back cleanly when only the post-stage-removal destination verification fails", async () => {
    const root = await workspace("safe-file-published-second-verification-");
    const destination = await canonicalDestination(root, "resource.txt");
    let destinationVerifications = 0;

    const error = await publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("published bytes"),
    }, {
      randomId: () => "second-verification",
      openVerification: async (path, flags) => {
        if (path === destination) {
          destinationVerifications += 1;
          if (destinationVerifications === 2) {
            throw new Error("second destination verification failed");
          }
        }
        return open(path, flags);
      },
    }).catch((caught: unknown) => caught);

    expect(destinationVerifications).toBeGreaterThanOrEqual(2);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AggregateError);
    expect((error as Error).message).toMatch(/destination.*changed/i);
    expect(await readdir(root)).toEqual([]);
  });

  it("reconciles an exact rollback unlink that commits before throwing", async () => {
    const root = await workspace("safe-file-published-ambiguous-unlink-");
    const destination = await canonicalDestination(root, "resource.txt");
    let failedDestinationVerification = false;
    let destinationQuarantinePath = "";

    const error = await publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("published bytes"),
    }, {
      randomId: () => "ambiguous-unlink",
      openVerification: async (path, flags) => {
        if (!failedDestinationVerification && path === destination) {
          failedDestinationVerification = true;
          throw new Error("transient destination verification failure");
        }
        return open(path, flags);
      },
      quarantineFile: async (source, target) => {
        if (source === destination) destinationQuarantinePath = target;
        await rename(source, target);
      },
      removeStage: async (path) => {
        await unlink(path);
        if (path === destinationQuarantinePath) {
          throw new Error("destination rollback unlink completion unknown");
        }
      },
    }).catch((caught: unknown) => caught);

    expect(failedDestinationVerification).toBe(true);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as Error).message).toMatch(/unlink completion unknown/i);
    expect((error as Error).message).not.toMatch(/recovery retained/i);
    expect(await readdir(root)).toEqual([]);
  });

  it("does not treat a falsy committed-destination verification failure as success", async () => {
    const root = await workspace("safe-file-published-falsy-verification-");
    const destination = await canonicalDestination(root, "resource.txt");
    let failedDestinationVerification = false;
    let rejected = false;

    try {
      await publishWithDependencies({
        root,
        relativePath: "resource.txt",
        bytes: utf8("published bytes"),
      }, {
        randomId: () => "falsy-verification",
        openVerification: async (path, flags) => {
          const handle = await open(path, flags);
          return {
            stat: (async (options?: { bigint?: boolean }) => {
              if (!failedDestinationVerification && path === destination) {
                failedDestinationVerification = true;
                throw null;
              }
              return options?.bigint
                ? handle.stat({ bigint: true })
                : handle.stat();
            }) as typeof handle.stat,
            readFile: handle.readFile.bind(handle),
            close: handle.close.bind(handle),
          };
        },
      });
    } catch (error) {
      rejected = true;
      expect(error).toBeNull();
    }

    expect(failedDestinationVerification).toBe(true);
    expect(rejected).toBe(true);
    expect(await readdir(root)).toEqual([]);
  });

  it("rejects a stage replacement that leaves an unaccounted publication alias", async () => {
    const root = await workspace("safe-file-published-cleanup-quarantine-");
    const destination = await canonicalDestination(root, "resource.txt");
    const heldStage = join(root, "held-stage");
    let stagePath = "";
    let quarantinePath = "";
    let cleanupSwapped = false;

    const replaceStage = async (): Promise<void> => {
      await rename(stagePath, heldStage);
      await writeFile(stagePath, "cleanup competitor", { flag: "wx" });
      cleanupSwapped = true;
    };

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("published bytes"),
    }, {
      randomId: () => "cleanup-quarantine",
      beforePublication: async (context) => {
        stagePath = context.stagePath;
      },
      quarantineFile: async (source, target) => {
        if (!cleanupSwapped && source === stagePath) await replaceStage();
        if (source === stagePath) quarantinePath = target;
        await rename(source, target);
      },
      removeStage: async (path) => {
        if (!cleanupSwapped && path === stagePath) await replaceStage();
        await unlink(path);
      },
    })).rejects.toThrow(/destination.*changed|rollback failed/i);

    expect(cleanupSwapped).toBe(true);
    expect(await readFile(stagePath, "utf8")).toBe("cleanup competitor");
    expect(await readFile(quarantinePath, "utf8")).toBe("cleanup competitor");
    expect(await readFile(heldStage, "utf8")).toBe("published bytes");
    await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps a valid committed destination when its stage link is replaced during cleanup", async () => {
    const root = await workspace("safe-file-published-cleanup-unlinked-stage-");
    const destination = await canonicalDestination(root, "resource.txt");
    let stagePath = "";
    let quarantinePath = "";
    let swapped = false;

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("published bytes"),
    }, {
      randomId: () => "cleanup-unlinked-stage",
      beforePublication: async (context) => {
        stagePath = context.stagePath;
      },
      quarantineFile: async (source, target) => {
        if (!swapped && source === stagePath) {
          await unlink(source);
          await writeFile(source, "cleanup competitor", { flag: "wx" });
          quarantinePath = target;
          swapped = true;
        }
        await rename(source, target);
      },
    })).resolves.toEqual({
      path: destination,
      created: true,
    });

    expect(swapped).toBe(true);
    expect(await readFile(destination, "utf8")).toBe("published bytes");
    expect(await readFile(stagePath, "utf8")).toBe("cleanup competitor");
    expect(await readFile(quarantinePath, "utf8")).toBe("cleanup competitor");
  });

  it("rejects extra aliases when a cleanup competitor hides the committed stage link", async () => {
    const root = await workspace("safe-file-published-hidden-alias-");
    const destination = await canonicalDestination(root, "resource.txt");
    const heldStage = join(root, "held-stage");
    const alias = join(root, "attacker-alias");
    let stagePath = "";
    let swapped = false;

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("published bytes"),
    }, {
      randomId: () => "hidden-alias",
      beforePublication: async (context) => {
        stagePath = context.stagePath;
      },
      quarantineFile: async (source, target) => {
        if (!swapped && source === stagePath) {
          await rename(source, heldStage);
          await link(heldStage, alias);
          await writeFile(source, "cleanup competitor", { flag: "wx" });
          swapped = true;
        }
        await rename(source, target);
      },
    })).rejects.toThrow(/destination.*changed|rollback failed/i);

    expect(swapped).toBe(true);
    expect(await readFile(destination, "utf8")).toBe("published bytes");
    expect(await readFile(heldStage, "utf8")).toBe("published bytes");
    expect(await readFile(alias, "utf8")).toBe("published bytes");
    expect(await readFile(stagePath, "utf8")).toBe("cleanup competitor");
  });

  it("rejects a single hidden alias when a cleanup competitor replaces an unlinked stage", async () => {
    const root = await workspace("safe-file-published-hidden-single-alias-");
    const destination = await canonicalDestination(root, "resource.txt");
    const alias = join(root, "attacker-alias");
    let stagePath = "";
    let swapped = false;

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("published bytes"),
    }, {
      randomId: () => "hidden-single-alias",
      beforePublication: async (context) => {
        stagePath = context.stagePath;
      },
      quarantineFile: async (source, target) => {
        if (!swapped && source === stagePath) {
          await unlink(source);
          await link(destination, alias);
          await writeFile(source, "cleanup competitor", { flag: "wx" });
          swapped = true;
        }
        await rename(source, target);
      },
    })).rejects.toThrow(/destination.*changed|rollback failed/i);

    expect(swapped).toBe(true);
    expect(await readFile(alias, "utf8")).toBe("published bytes");
    expect(await readFile(stagePath, "utf8")).toBe("cleanup competitor");
  });

  it("uses BigIntStats for exact publication identity and link-count checks", async () => {
    const root = await workspace("safe-file-published-bigint-identity-");
    const statOptions: unknown[] = [];

    await publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("published bytes"),
    }, {
      randomId: () => "bigint-identity",
      openStage: async (path, flags, mode) => {
        const handle = await open(path, flags, mode);
        return {
          writeFile: handle.writeFile.bind(handle),
          sync: handle.sync.bind(handle),
          close: handle.close.bind(handle),
          stat: (async (options?: { bigint?: boolean }) => {
            statOptions.push(options);
            return options?.bigint
              ? handle.stat({ bigint: true })
              : handle.stat();
          }) as typeof handle.stat,
        };
      },
      openVerification: async (path, flags) => {
        const handle = await open(path, flags);
        return {
          stat: (async (options?: { bigint?: boolean }) => {
            statOptions.push(options);
            return options?.bigint
              ? handle.stat({ bigint: true })
              : handle.stat();
          }) as typeof handle.stat,
          readFile: handle.readFile.bind(handle),
          close: handle.close.bind(handle),
        };
      },
    });

    expect(statOptions.length).toBeGreaterThanOrEqual(3);
    expect(statOptions.every(
      (options) => (options as { bigint?: boolean } | undefined)?.bigint === true,
    )).toBe(true);
  });

  it("rejects a non-regular verification fd before reading from it", async () => {
    const root = await workspace("safe-file-verification-device-");
    const destination = await canonicalDestination(root, "resource.txt");
    const directoryStats = await lstat(root, { bigint: true });
    let readCalled = false;
    await writeFile(destination, "same bytes");

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("same bytes"),
    }, {
      openVerification: async () => ({
        stat: (async () => directoryStats) as VerificationHandle["stat"],
        readFile: (async () => {
          readCalled = true;
          return Buffer.from("device bytes");
        }) as VerificationHandle["readFile"],
        close: async () => {},
      }),
    })).rejects.toThrow(/destination.*changed/i);

    expect(readCalled).toBe(false);
  });

  it("binds the destination name while its verification fd is open", async () => {
    const root = await workspace("safe-file-verification-open-binding-");
    const destination = await canonicalDestination(root, "resource.txt");
    const heldDestination = join(root, "held-destination");
    let swapped = false;
    await writeFile(destination, "same bytes");

    const error = await publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("same bytes"),
    }, {
      openVerification: async (path, flags) => {
        const handle = await open(path, flags);
        return {
          stat: handle.stat.bind(handle),
          readFile: (async () => {
            const bytes = await handle.readFile();
            if (!swapped) {
              await rename(destination, heldDestination);
              await writeFile(destination, "competitor", { flag: "wx" });
              swapped = true;
            }
            return bytes;
          }) as VerificationHandle["readFile"],
          close: async () => {
            await handle.close();
            throw new Error("verification close failed");
          },
        };
      },
    }).catch((caught: unknown) => caught);

    expect(swapped).toBe(true);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toHaveLength(2);
    expect((error as Error).message).toMatch(/destination.*changed.*close failed/i);
    expect(await readFile(destination, "utf8")).toBe("competitor");
    expect(await readFile(heldDestination, "utf8")).toBe("same bytes");
  });

  it.skipIf(process.platform === "win32")("rejects a FIFO stage swap without blocking", async () => {
    const root = await workspace("safe-file-published-fifo-stage-");
    const destination = join(root, "resource.txt");
    let verificationFlags: number | undefined;
    let swapped = false;

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("published bytes"),
    }, {
      randomId: () => "fifo-stage",
      openVerification: async (path, flags) => {
        if (!swapped && path.endsWith(".resource.txt.fifo-stage.tmp")) {
          verificationFlags = flags;
          await rename(path, `${path}.regular`);
          await execFileAsync("mkfifo", [path]);
          swapped = true;
        }
        return open(path, flags);
      },
    })).rejects.toThrow(/stage.*changed|regular file/i);

    expect(swapped).toBe(true);
    expect(verificationFlags! & constants.O_NONBLOCK).not.toBe(0);
    await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an unexpected hard-link alias added during publication", async () => {
    const root = await workspace("safe-file-published-hard-link-alias-");
    const destination = join(root, "resource.txt");
    const alias = join(root, "attacker-alias");

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("published bytes"),
    }, {
      randomId: () => "published-hard-link-alias",
      linkFile: async (source, target) => {
        await link(source, target);
        await link(source, alias);
      },
    })).rejects.toThrow(/stage.*changed|destination.*changed/i);

    expect(await readFile(destination, "utf8")).toBe("published bytes");
    expect(await readFile(alias, "utf8")).toBe("published bytes");
  });

  it("verifies the committed destination when publication already removed its stage", async () => {
    const root = await workspace("safe-file-published-stage-removed-");
    const destination = join(root, "resource.txt");

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("published bytes"),
    }, {
      randomId: () => "published-stage-removed",
      linkFile: async (source, target) => {
        await link(source, target);
        await unlink(source);
      },
    })).resolves.toEqual({
      path: await canonicalDestination(root, "resource.txt"),
      created: true,
    });

    expect(await readFile(destination, "utf8")).toBe("published bytes");
  });

  it("rejects a corrupted destination when publication already removed its stage", async () => {
    const root = await workspace("safe-file-published-stage-removed-corrupt-");
    const destination = join(root, "resource.txt");

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("published bytes"),
    }, {
      randomId: () => "published-stage-removed-corrupt",
      linkFile: async (source, target) => {
        await link(source, target);
        await unlink(source);
        await writeFile(target, "corrupted bytes");
      },
    })).rejects.toThrow(/destination.*changed/i);

    expect(await readFile(destination, "utf8")).toBe("corrupted bytes");
  });

  it("preserves a concurrent destination replacement when integrity rollback cannot prove ownership", async () => {
    const root = await workspace("safe-file-published-competitor-");
    const destination = join(root, "resource.txt");
    const heldPublication = join(root, "held-publication");

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("published bytes"),
    }, {
      randomId: () => "published-competitor",
      linkFile: async (source, target) => {
        await link(source, target);
        await unlink(source);
        await rename(target, heldPublication);
        await writeFile(target, "competitor", { flag: "wx" });
      },
    })).rejects.toThrow(/destination.*changed.*rollback failed/i);

    expect(await readFile(destination, "utf8")).toBe("competitor");
    expect(await readFile(heldPublication, "utf8")).toBe("published bytes");
  });

  it("preserves a falsy primary when the failed publication stage disappeared", async () => {
    const root = await workspace("safe-file-falsy-stage-disappeared-");
    let rejected = false;

    try {
      await publishWithDependencies({
        root,
        relativePath: "resource.txt",
        bytes: utf8("bytes"),
      }, {
        randomId: () => "falsy-stage-disappeared",
        beforePublication: async ({ stagePath }) => {
          await unlink(stagePath);
          throw undefined;
        },
      });
    } catch (error) {
      rejected = true;
      expect(error).toBeUndefined();
    }

    expect(rejected).toBe(true);
  });

  it("uses an exclusive no-follow open for a random sibling stage", async () => {
    const root = await workspace("safe-file-stage-flags-");
    const flags: number[] = [];
    const opened: string[] = [];

    await publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("bytes"),
    }, {
      randomId: () => "exclusive",
      openStage: async (path, value, mode) => {
        opened.push(path);
        flags.push(value);
        return open(path, value, mode);
      },
    });

    expect(opened).toEqual([await canonicalDestination(root, ".resource.txt.exclusive.tmp")]);
    expect(flags[0]! & constants.O_EXCL).not.toBe(0);
    if (typeof constants.O_NOFOLLOW === "number") {
      expect(flags[0]! & constants.O_NOFOLLOW).not.toBe(0);
    }
    expect(await readdir(root)).toEqual(["resource.txt"]);
  });

  it("never removes a pre-existing stage when exclusive creation loses a collision", async () => {
    const root = await workspace("safe-file-stage-owned-");
    const stage = join(root, ".resource.txt.collision.tmp");
    await writeFile(stage, "unowned sentinel", { flag: "wx" });

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("bytes"),
    }, {
      randomId: () => "collision",
    })).rejects.toMatchObject({ code: "EEXIST" });

    expect(await readFile(stage, "utf8")).toBe("unowned sentinel");
    await expect(lstat(join(root, "resource.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns created false for exact create-only reuse", async () => {
    const root = await workspace("safe-file-create-reuse-");
    const destination = join(root, "resource.txt");
    await writeFile(destination, "same bytes");

    await expect(publishFileSafely({
      root,
      relativePath: "resource.txt",
      bytes: utf8("same bytes"),
    })).resolves.toEqual({ path: await canonicalDestination(root, "resource.txt"), created: false });

    expect(await readFile(destination, "utf8")).toBe("same bytes");
    expect(await readdir(root)).toEqual(["resource.txt"]);
  });

  it("does not reuse bytes from an opened inode after the destination name is replaced", async () => {
    const root = await workspace("safe-file-create-reuse-rebind-");
    const destination = await canonicalDestination(root, "resource.txt");
    const heldDestination = join(root, "held-destination");
    let swapped = false;
    let readCalled = false;
    await writeFile(destination, "same bytes");

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("same bytes"),
    }, {
      openVerification: async (path, flags) => {
        const handle = await open(path, flags);
        if (!swapped && path === destination) {
          await rename(destination, heldDestination);
          await writeFile(destination, "competitor", { flag: "wx" });
          swapped = true;
        }
        return {
          stat: handle.stat.bind(handle),
          readFile: (async () => {
            readCalled = true;
            return handle.readFile();
          }) as VerificationHandle["readFile"],
          close: handle.close.bind(handle),
        };
      },
    })).rejects.toThrow(/destination.*changed/i);

    expect(swapped).toBe(true);
    expect(readCalled).toBe(false);
    expect(await readFile(destination, "utf8")).toBe("competitor");
    expect(await readFile(heldDestination, "utf8")).toBe("same bytes");
  });

  it("rejects different bytes under create-only semantics", async () => {
    const root = await workspace("safe-file-create-conflict-");
    const destination = join(root, "resource.txt");
    await writeFile(destination, "old bytes");

    const error = await publishFileSafely({
      root,
      relativePath: "resource.txt",
      bytes: utf8("different bytes"),
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: "SafeFileConflictError",
      code: "SAFE_FILE_CONFLICT",
      path: await canonicalDestination(root, "resource.txt"),
    });
    expect(error).toBeInstanceOf(SafeFileConflictError);
    expect((error as Error).message).toMatch(/different bytes/);
    expect(await readFile(destination, "utf8")).toBe("old bytes");
  });

  it("tolerates a link-count-only transition while comparing create-only bytes", async () => {
    const root = await workspace("safe-file-create-conflict-link-transition-");
    const destination = await canonicalDestination(root, "resource.txt");
    const cleanupAlias = join(root, "cleanup-alias");
    let transitioned = false;
    await writeFile(destination, "old bytes");
    await link(destination, cleanupAlias);

    const error = await publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("different bytes"),
    }, {
      openVerification: async (path, flags) => {
        const handle = await open(path, flags);
        return {
          stat: (async (options?: { bigint?: boolean }) => {
            const stats = options?.bigint
              ? await handle.stat({ bigint: true })
              : await handle.stat();
            if (!transitioned && path === destination) {
              await unlink(cleanupAlias);
              transitioned = true;
            }
            return stats;
          }) as typeof handle.stat,
          readFile: handle.readFile.bind(handle),
          close: handle.close.bind(handle),
        };
      },
    }).catch((caught: unknown) => caught);

    expect(transitioned).toBe(true);
    expect(error).toBeInstanceOf(SafeFileConflictError);
    expect(await readFile(destination, "utf8")).toBe("old bytes");
  });

  it("returns created false when replacing an existing regular file", async () => {
    const root = await workspace("safe-file-replace-existing-");
    const destination = join(root, "resource.txt");
    await writeFile(destination, "old bytes");

    await expect(publishFileSafely({
      root,
      relativePath: "resource.txt",
      bytes: utf8("new bytes"),
      replace: true,
    })).resolves.toEqual({ path: await canonicalDestination(root, "resource.txt"), created: false });

    expect(await readFile(destination, "utf8")).toBe("new bytes");
    expect(await readdir(root)).toEqual(["resource.txt"]);
  });

  it("rejects replacement publication when the moved destination bytes change", async () => {
    const root = await workspace("safe-file-replace-destination-binding-");
    const destination = join(root, "resource.txt");
    await writeFile(destination, "old bytes");

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("new bytes"),
      replace: true,
    }, {
      randomId: () => "replace-destination-binding",
      moveFile: async (source, target) => {
        await rename(source, target);
        await writeFile(target, "competitor bytes");
      },
    })).rejects.toThrow(/destination.*changed/i);

    expect(await readFile(destination, "utf8")).toBe("competitor bytes");
  });

  it("reconciles a replacement rename that commits before throwing", async () => {
    const root = await workspace("safe-file-replace-ambiguous-commit-");
    const destination = await canonicalDestination(root, "resource.txt");
    await writeFile(destination, "old bytes");

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("new bytes"),
      replace: true,
    }, {
      randomId: () => "replace-ambiguous-commit",
      moveFile: async (source, target) => {
        await rename(source, target);
        throw new Error("rename completion unknown");
      },
    })).resolves.toEqual({ path: destination, created: false });

    expect(await readFile(destination, "utf8")).toBe("new bytes");
    expect(await readdir(root)).toEqual(["resource.txt"]);
  });

  it("reconciles committed replacement when a competitor occupies the old stage name", async () => {
    const root = await workspace("safe-file-replace-ambiguous-stage-competitor-");
    const destination = await canonicalDestination(root, "resource.txt");
    let stagePath = "";
    await writeFile(destination, "old bytes");

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("new bytes"),
      replace: true,
    }, {
      randomId: () => "replace-ambiguous-stage-competitor",
      beforePublication: async (context) => {
        stagePath = context.stagePath;
      },
      moveFile: async (source, target) => {
        await rename(source, target);
        await writeFile(source, "competitor", { flag: "wx" });
        throw new Error("rename completion unknown");
      },
    })).resolves.toEqual({ path: destination, created: false });

    expect(await readFile(destination, "utf8")).toBe("new bytes");
    expect(await readFile(stagePath, "utf8")).toBe("competitor");
  });

  it("returns created true when replacement mode creates a missing file", async () => {
    const root = await workspace("safe-file-replace-create-");
    const destination = join(root, "resource.txt");

    await expect(publishFileSafely({
      root,
      relativePath: "resource.txt",
      bytes: utf8("new bytes"),
      replace: true,
    })).resolves.toEqual({ path: await canonicalDestination(root, "resource.txt"), created: true });

    expect(await readFile(destination, "utf8")).toBe("new bytes");
  });

  it("reconciles a replace-mode hard link that commits before throwing", async () => {
    const root = await workspace("safe-file-replace-link-ambiguous-commit-");
    const destination = await canonicalDestination(root, "resource.txt");

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("new bytes"),
      replace: true,
    }, {
      randomId: () => "replace-link-ambiguous-commit",
      linkFile: async (source, target) => {
        await link(source, target);
        throw new Error("replace link completion unknown");
      },
    })).resolves.toEqual({ path: destination, created: true });

    expect(await readFile(destination, "utf8")).toBe("new bytes");
    expect(await readdir(root)).toEqual(["resource.txt"]);
  });

  it("still reports created true when a transient replacement collision disappears", async () => {
    const root = await workspace("safe-file-replace-transient-collision-");
    const destination = join(root, "resource.txt");
    let linkCalls = 0;

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("new bytes"),
      replace: true,
    }, {
      linkFile: async (source, target) => {
        linkCalls += 1;
        if (linkCalls === 1) {
          throw Object.assign(new Error("transient collision"), { code: "EEXIST" });
        }
        await link(source, target);
      },
      moveFile: async () => { throw new Error("must not replace an absent leaf"); },
    })).resolves.toEqual({
      path: await canonicalDestination(root, "resource.txt"),
      created: true,
    });

    expect(linkCalls).toBe(2);
    expect(await readFile(destination, "utf8")).toBe("new bytes");
  });

  it("allows only one concurrent create-only writer with different bytes", async () => {
    const root = await workspace("safe-file-concurrent-different-");
    const destination = join(root, "resource.txt");
    const first = utf8("first bytes");
    const second = utf8("second bytes");

    const results = await Promise.allSettled([
      publishFileSafely({ root, relativePath: "resource.txt", bytes: first }),
      publishFileSafely({ root, relativePath: "resource.txt", bytes: second }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      reason: {
        name: "SafeFileConflictError",
        code: "SAFE_FILE_CONFLICT",
        path: await canonicalDestination(root, "resource.txt"),
      },
    });
    expect([Buffer.from(first), Buffer.from(second)]).toContainEqual(await readFile(destination));
    expect(await stageEntries(root)).toEqual([]);
  });

  it("lets concurrent create-only writers with identical bytes converge", async () => {
    const root = await workspace("safe-file-concurrent-identical-");
    const destination = join(root, "resource.txt");
    const bytes = utf8("same bytes");

    const results = await Promise.all([
      publishFileSafely({ root, relativePath: "resource.txt", bytes }),
      publishFileSafely({ root, relativePath: "resource.txt", bytes }),
    ]);

    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect(await readFile(destination)).toEqual(Buffer.from(bytes));
    expect(await stageEntries(root)).toEqual([]);
  });
});
