// SPDX-License-Identifier: Apache-2.0
import { link, lstat, open, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
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
            read: handle.read.bind(handle),
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
});
