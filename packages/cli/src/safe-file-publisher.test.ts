// SPDX-License-Identifier: Apache-2.0
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
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  publishFileSafely,
  removeRegularFileSafely,
  SafeFileConflictError,
  type SafeFilePublication,
} from "./safe-file-publisher.js";

const temporaryRoots: string[] = [];

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

type StageHandle = Pick<FileHandle, "writeFile" | "sync" | "close">;

interface TestPublicationDependencies {
  randomId?: () => string;
  openStage?: (path: string, flags: number, mode: number) => Promise<StageHandle>;
  linkFile?: (source: string, destination: string) => Promise<void>;
  moveFile?: (source: string, destination: string) => Promise<void>;
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

  it("retains a publication error when owned-stage cleanup also fails", async () => {
    const root = await workspace("safe-file-cleanup-failure-");
    const destination = join(root, "resource.txt");
    await writeFile(destination, "old bytes");

    const error = await publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("new bytes"),
      replace: true,
    }, {
      randomId: () => "cleanup-failure",
      moveFile: async () => { throw new Error("primary publication failed"); },
      removeStage: async () => { throw new Error("stage cleanup failed"); },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AggregateError);
    expect(error).toMatchObject({ cause: expect.objectContaining({ message: "primary publication failed" }) });
    expect((error as AggregateError).errors[0]).toMatchObject({ message: "primary publication failed" });
    expect((error as Error).message).toMatch(/primary publication failed.*stage cleanup failed/);
    expect(await readFile(destination, "utf8")).toBe("old bytes");
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
    expect(await readdir(root)).toEqual([
      ".resource.txt.published-cleanup-failure.tmp",
      "resource.txt",
    ]);
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
    expect(flags[0]! & constants.O_NOFOLLOW).not.toBe(0);
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

describe("removeRegularFileSafely", () => {
  it("returns false when the root itself is absent", async () => {
    const base = await workspace("safe-file-remove-missing-root-");
    await expect(removeRegularFileSafely(join(base, "missing-root"), "missing.txt"))
      .resolves.toBe(false);
  });

  it("returns false for an absent leaf", async () => {
    const root = await workspace("safe-file-remove-absent-");
    await expect(removeRegularFileSafely(root, "missing.txt")).resolves.toBe(false);
  });

  it("removes only a regular leaf and reports true", async () => {
    const root = await workspace("safe-file-remove-regular-");
    const destination = join(root, "resource.txt");
    await writeFile(destination, "bytes");

    await expect(removeRegularFileSafely(root, "resource.txt")).resolves.toBe(true);
    await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a symbolic-link leaf without changing its target", async () => {
    const root = await workspace("safe-file-remove-symlink-");
    const outside = await workspace("safe-file-remove-outside-");
    const sentinel = join(outside, "sentinel.txt");
    const linked = join(root, "linked.txt");
    await writeFile(sentinel, "outside");
    await symlink(sentinel, linked);

    await expect(removeRegularFileSafely(root, "linked.txt"))
      .rejects.toThrow(/symbolic link.*removal/i);

    expect((await lstat(linked)).isSymbolicLink()).toBe(true);
    expect(await readFile(sentinel, "utf8")).toBe("outside");
  });

  it("rejects a directory leaf", async () => {
    const root = await workspace("safe-file-remove-directory-");
    await mkdir(join(root, "directory"));

    await expect(removeRegularFileSafely(root, "directory"))
      .rejects.toThrow(/removal target.*regular file/i);

    expect((await lstat(join(root, "directory"))).isDirectory()).toBe(true);
  });

  it("rejects an unsafe symbolic-link ancestor", async () => {
    const root = await workspace("safe-file-remove-ancestor-");
    const outside = await workspace("safe-file-remove-ancestor-outside-");
    const sentinel = join(outside, "sentinel.txt");
    await writeFile(sentinel, "outside");
    await symlink(outside, join(root, "linked"));

    await expect(removeRegularFileSafely(root, "linked/sentinel.txt"))
      .rejects.toThrow(/symbolic link.*ancestor/i);

    expect(await readFile(sentinel, "utf8")).toBe("outside");
  });

  it.skipIf(process.platform === "win32")("rejects a non-regular device leaf", async () => {
    await expect(removeRegularFileSafely("/dev", "null"))
      .rejects.toThrow(/removal target.*regular file/i);
  });

  it("uses the same portable path validation before mutation", async () => {
    const root = await workspace("safe-file-remove-invalid-");
    await expect(removeRegularFileSafely(root, "../outside.txt"))
      .rejects.toThrow(/portable project-relative path/);
  });
});
