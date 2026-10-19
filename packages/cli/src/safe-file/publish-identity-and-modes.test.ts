// SPDX-License-Identifier: Apache-2.0
import { constants } from "node:fs";
import { link, lstat, open, readFile, readdir, rename, unlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { publishFileSafely, SafeFileConflictError } from "../safe-file-publisher.js";
import {
  execFileAsync,
  cleanupTemporaryRoots,
  workspace,
  utf8,
  publishWithDependencies,
  stageEntries,
  canonicalDestination,
} from "./test-support.js";
import type { VerificationHandle } from "./test-support.js";

afterEach(cleanupTemporaryRoots);

describe("publishFileSafely", () => {
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
          read: handle.read.bind(handle),
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
        read: (async () => {
          readCalled = true;
          throw new Error("must not read non-regular verification fd");
        }) as VerificationHandle["read"],
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
          read: (async (buffer, offset, length, position) => {
            const result = await handle.read(buffer, offset, length, position);
            if (!swapped) {
              await rename(destination, heldDestination);
              await writeFile(destination, "competitor", { flag: "wx" });
              swapped = true;
            }
            return result;
          }) as VerificationHandle["read"],
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
          read: (async (buffer, offset, length, position) => {
            readCalled = true;
            return handle.read(buffer, offset, length, position);
          }) as VerificationHandle["read"],
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
      bytes: utf8("new bytes"),
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
      bytes: utf8("new bytes"),
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
          read: handle.read.bind(handle),
          readFile: handle.readFile.bind(handle),
          close: handle.close.bind(handle),
        };
      },
    }).catch((caught: unknown) => caught);

    expect(transitioned).toBe(true);
    expect(error).toBeInstanceOf(SafeFileConflictError);
    expect(await readFile(destination, "utf8")).toBe("old bytes");
  });

  it("rejects a same-inode rewrite hidden by a ctime-only transition", async () => {
    const root = await workspace("safe-file-create-rewrite-ctime-");
    const destination = await canonicalDestination(root, "resource.txt");
    const fixedTime = new Date("2020-01-01T00:00:00.000Z");
    let rewritten = false;
    await writeFile(destination, "same bytes");
    await utimes(destination, fixedTime, fixedTime);

    await expect(publishWithDependencies({
      root,
      relativePath: "resource.txt",
      bytes: utf8("same bytes"),
    }, {
      openVerification: async (path, flags) => {
        const handle = await open(path, flags);
        return {
          stat: handle.stat.bind(handle),
          read: (async (buffer, offset, length, position) => {
            if (!rewritten && path === destination) {
              await writeFile(destination, "other byte");
              await utimes(destination, fixedTime, fixedTime);
              rewritten = true;
            }
            return handle.read(buffer, offset, length, position);
          }) as VerificationHandle["read"],
          readFile: handle.readFile.bind(handle),
          close: handle.close.bind(handle),
        };
      },
    })).rejects.toBeInstanceOf(SafeFileConflictError);

    expect(rewritten).toBe(true);
    expect(await readFile(destination, "utf8")).toBe("other byte");
    expect(await stageEntries(root)).toEqual([]);
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

  it("converges when the winner quarantines its linked stage during the loser's comparison", async () => {
    const root = await workspace("safe-file-concurrent-identical-quarantine-");
    const destination = await canonicalDestination(root, "resource.txt");
    const bytes = utf8("same bytes");
    let markWinnerLinked!: () => void;
    let markLoserReading!: () => void;
    let markStageQuarantined!: () => void;
    const winnerLinked = new Promise<void>((resolve) => { markWinnerLinked = resolve; });
    const loserReading = new Promise<void>((resolve) => { markLoserReading = resolve; });
    const stageQuarantined = new Promise<void>((resolve) => { markStageQuarantined = resolve; });
    let loserComparisonReads = 0;

    const winner = publishWithDependencies({ root, relativePath: "resource.txt", bytes }, {
      randomId: () => "winner",
      linkFile: async (source, target) => {
        await link(source, target);
        markWinnerLinked();
      },
      // The cleanup rename changes the shared inode's ctime while its link count stays at 2.
      quarantineFile: async (source, target) => {
        await loserReading;
        await rename(source, target);
        markStageQuarantined();
      },
    });
    const loser = publishWithDependencies({ root, relativePath: "resource.txt", bytes }, {
      randomId: () => "loser",
      beforePublication: () => winnerLinked,
      openVerification: async (path, flags) => {
        const handle = await open(path, flags);
        return {
          stat: handle.stat.bind(handle),
          // Only the bounded destination comparison uses positional reads.
          read: (async (buffer, offset, length, position) => {
            if (path === destination && loserComparisonReads++ === 0) {
              markLoserReading();
              await stageQuarantined;
            }
            return handle.read(buffer, offset, length, position);
          }) as VerificationHandle["read"],
          readFile: handle.readFile.bind(handle),
          close: handle.close.bind(handle),
        };
      },
    });

    await expect(Promise.all([winner, loser])).resolves.toEqual([
      { path: destination, created: true },
      { path: destination, created: false },
    ]);
    expect(loserComparisonReads).toBeGreaterThanOrEqual(2);
    expect(await readFile(destination)).toEqual(Buffer.from(bytes));
    // Also proves no stage quarantine (`<stage>.tmp.<uuid>.quarantine`) was left behind.
    expect(await readdir(root)).toEqual(["resource.txt"]);
  });
});
