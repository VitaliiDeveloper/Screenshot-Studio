// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { link, lstat, open, readFile, rename, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { quarantineRegularFileSafely } from "../safe-file-publisher.js";
import {
  execFileAsync,
  cleanupTemporaryRoots,
  workspace,
  quarantineWithDependencies,
  canonicalDestination,
} from "./test-support.js";

afterEach(cleanupTemporaryRoots);

describe("quarantineRegularFileSafely", () => {
  it("atomically captures bytes and restores the exact quarantined file", async () => {
    const root = await workspace("safe-file-transaction-quarantine-");
    const destination = await canonicalDestination(root, "resource.txt");
    await writeFile(destination, "transaction bytes");

    const quarantined = await quarantineRegularFileSafely(root, "resource.txt");

    expect(quarantined).not.toBeNull();
    expect(Buffer.from(quarantined!.bytes).toString("utf8")).toBe("transaction bytes");
    expect(quarantined!.ownership.revision).toBe(
      createHash("sha256").update("transaction bytes").digest("hex"),
    );
    await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(quarantined!.recoveryPath, "utf8")).toBe("transaction bytes");

    await quarantined!.restore();

    expect(await readFile(destination, "utf8")).toBe("transaction bytes");
    await expect(lstat(quarantined!.recoveryPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns bytes for the exact regular replacement captured at the quarantine boundary", async () => {
    const root = await workspace("safe-file-transaction-replacement-");
    const destination = await canonicalDestination(root, "resource.txt");
    const heldOriginal = join(root, "held-original");
    await writeFile(destination, "original bytes");

    const quarantined = await quarantineWithDependencies(root, "resource.txt", undefined, {
      quarantineFile: async (source, target) => {
        await rename(source, heldOriginal);
        await writeFile(source, "replacement bytes", { flag: "wx" });
        await rename(source, target);
      },
    });

    expect(quarantined).not.toBeNull();
    expect(Buffer.from(quarantined!.bytes).toString("utf8")).toBe("replacement bytes");
    expect(await readFile(heldOriginal, "utf8")).toBe("original bytes");
    await quarantined!.restore();
    expect(await readFile(destination, "utf8")).toBe("replacement bytes");
  });

  it("returns null when the leaf vanishes just before its quarantine", async () => {
    const root = await workspace("safe-file-transaction-vanished-");
    await writeFile(join(root, "resource.txt"), "bytes");

    await expect(quarantineWithDependencies(root, "resource.txt", undefined, {
      quarantineFile: async (source, target) => {
        await unlink(source);
        await rename(source, target);
      },
    })).resolves.toBeNull();
  });

  it("rejects a quarantine mutation that leaves the source entry in place", async () => {
    const root = await workspace("safe-file-transaction-source-retained-");
    const destination = await canonicalDestination(root, "resource.txt");
    let recoveryPath = "";
    await writeFile(destination, "source remains");

    await expect(quarantineWithDependencies(root, "resource.txt", undefined, {
      quarantineFile: async (source, target) => {
        recoveryPath = target;
        await link(source, target);
      },
    })).rejects.toThrow(/unexpected outcome|recovery retained/i);

    expect(await readFile(destination, "utf8")).toBe("source remains");
    expect(await readFile(recoveryPath, "utf8")).toBe("source remains");
  });

  it("does not follow a symbolic-link replacement captured at the quarantine boundary", async () => {
    const root = await workspace("safe-file-transaction-symlink-");
    const outside = await workspace("safe-file-transaction-symlink-outside-");
    const destination = await canonicalDestination(root, "resource.txt");
    const heldOriginal = join(root, "held-original");
    const sentinel = join(outside, "sentinel.txt");
    let recoveryPath = "";
    await writeFile(destination, "original bytes");
    await writeFile(sentinel, "outside");

    await expect(quarantineWithDependencies(root, "resource.txt", undefined, {
      quarantineFile: async (source, target) => {
        await rename(source, heldOriginal);
        await symlink(sentinel, source);
        recoveryPath = target;
        await rename(source, target);
      },
    })).rejects.toThrow(/recovery retained|regular file|changed/i);

    expect((await lstat(recoveryPath)).isSymbolicLink()).toBe(true);
    expect(await readFile(sentinel, "utf8")).toBe("outside");
    expect(await readFile(heldOriginal, "utf8")).toBe("original bytes");
  });

  it.skipIf(process.platform === "win32")(
    "does not read a FIFO replacement captured at the quarantine boundary",
    async () => {
      const root = await workspace("safe-file-transaction-fifo-");
      const destination = await canonicalDestination(root, "resource.txt");
      const heldOriginal = join(root, "held-original");
      let recoveryPath = "";
      await writeFile(destination, "original bytes");

      await expect(quarantineWithDependencies(root, "resource.txt", undefined, {
        quarantineFile: async (source, target) => {
          await rename(source, heldOriginal);
          await execFileAsync("mkfifo", [source]);
          recoveryPath = target;
          await rename(source, target);
        },
      })).rejects.toThrow(/recovery retained|regular file|changed/i);

      expect((await lstat(recoveryPath)).isFIFO()).toBe(true);
      expect(await readFile(heldOriginal, "utf8")).toBe("original bytes");
    },
  );

  it("never overwrites an occupied destination while restoring", async () => {
    const root = await workspace("safe-file-transaction-occupied-restore-");
    const destination = await canonicalDestination(root, "resource.txt");
    await writeFile(destination, "quarantined bytes");
    const quarantined = await quarantineRegularFileSafely(root, "resource.txt");
    expect(quarantined).not.toBeNull();
    await writeFile(destination, "occupant", { flag: "wx" });

    await expect(quarantined!.restore()).rejects.toThrow(/occupied path/i);

    expect(await readFile(destination, "utf8")).toBe("occupant");
    expect(await readFile(quarantined!.recoveryPath, "utf8")).toBe("quarantined bytes");
    await unlink(destination);
    await quarantined!.restore();
    expect(await readFile(destination, "utf8")).toBe("quarantined bytes");
  });

  it("resumes restore after transient verification fails following the committed link", async () => {
    const root = await workspace("safe-file-transaction-resume-linked-");
    const destination = await canonicalDestination(root, "resource.txt");
    let linkCommitted = false;
    let failedOnce = false;
    await writeFile(destination, "resumable bytes");
    const quarantined = await quarantineWithDependencies(root, "resource.txt", undefined, {
      restoreLink: async (source, target) => {
        await link(source, target);
        linkCommitted = true;
      },
      openVerification: async (path, flags) => {
        if (linkCommitted && !failedOnce && path === destination) {
          failedOnce = true;
          throw new Error("transient destination verification failure");
        }
        return open(path, flags);
      },
    });
    expect(quarantined).not.toBeNull();

    await expect(quarantined!.restore()).rejects.toThrow(/changed.*recovery retained/i);
    expect(await readFile(destination, "utf8")).toBe("resumable bytes");
    expect(await readFile(quarantined!.recoveryPath, "utf8")).toBe("resumable bytes");

    await quarantined!.restore();

    expect(await readFile(destination, "utf8")).toBe("resumable bytes");
    await expect(lstat(quarantined!.recoveryPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("resumes restore after transient verification fails following quarantine cleanup", async () => {
    const root = await workspace("safe-file-transaction-resume-cleaned-");
    const destination = await canonicalDestination(root, "resource.txt");
    let cleanupCommitted = false;
    let failedOnce = false;
    await writeFile(destination, "resumable bytes");
    const quarantined = await quarantineWithDependencies(root, "resource.txt", undefined, {
      removeFile: async (path) => {
        await unlink(path);
        cleanupCommitted = true;
      },
      openVerification: async (path, flags) => {
        if (cleanupCommitted && !failedOnce && path === destination) {
          failedOnce = true;
          throw new Error("transient final verification failure");
        }
        return open(path, flags);
      },
    });
    expect(quarantined).not.toBeNull();

    await expect(quarantined!.restore()).rejects.toThrow(/changed.*recovery entry disappeared/i);
    await expect(lstat(quarantined!.recoveryPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(destination, "utf8")).toBe("resumable bytes");

    await quarantined!.restore();

    expect(await readFile(destination, "utf8")).toBe("resumable bytes");
  });

  it("reports recovery when ownership changes and the restore destination is occupied", async () => {
    const root = await workspace("safe-file-transaction-mismatch-occupied-");
    const destination = await canonicalDestination(root, "resource.txt");
    const heldOriginal = join(root, "held-original");
    let recoveryPath = "";
    await writeFile(destination, "expected bytes");
    const stats = await lstat(destination, { bigint: true });
    const expected = {
      device: stats.dev,
      inode: stats.ino,
      revision: createHash("sha256").update("expected bytes").digest("hex"),
    };

    const error = await quarantineWithDependencies(root, "resource.txt", expected, {
      quarantineFile: async (source, target) => {
        await rename(source, heldOriginal);
        await writeFile(source, "replacement", { flag: "wx" });
        recoveryPath = target;
        await rename(source, target);
        await writeFile(source, "occupant", { flag: "wx" });
      },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(recoveryPath);
    expect((error as Error).message).toMatch(/recovery retained/i);
    expect(await readFile(destination, "utf8")).toBe("occupant");
    expect(await readFile(recoveryPath, "utf8")).toBe("replacement");
    expect(await readFile(heldOriginal, "utf8")).toBe("expected bytes");
  });

  it("discards the exact quarantine on transaction commit", async () => {
    const root = await workspace("safe-file-transaction-discard-");
    const destination = await canonicalDestination(root, "resource.txt");
    await writeFile(destination, "committed removal");
    const quarantined = await quarantineRegularFileSafely(root, "resource.txt");
    expect(quarantined).not.toBeNull();

    await quarantined!.discard();

    await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(quarantined!.recoveryPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses to discard a replacement installed at the private quarantine path", async () => {
    const root = await workspace("safe-file-transaction-discard-replacement-");
    const destination = await canonicalDestination(root, "resource.txt");
    const heldQuarantine = join(root, "held-quarantine");
    await writeFile(destination, "owned quarantine");
    const quarantined = await quarantineRegularFileSafely(root, "resource.txt");
    expect(quarantined).not.toBeNull();
    await rename(quarantined!.recoveryPath, heldQuarantine);
    await writeFile(quarantined!.recoveryPath, "competitor", { flag: "wx" });

    await expect(quarantined!.discard()).rejects.toThrow(/quarantine changed|recovery retained/i);

    expect(await readFile(quarantined!.recoveryPath, "utf8")).toBe("competitor");
    expect(await readFile(heldQuarantine, "utf8")).toBe("owned quarantine");
  });
});
