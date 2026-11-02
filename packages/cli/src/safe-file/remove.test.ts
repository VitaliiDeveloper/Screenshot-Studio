// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rename, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { publishFileSafelyWithOwnership, removeRegularFileSafely } from "../safe-file-publisher.js";
import {
  execFileAsync,
  cleanupTemporaryRoots,
  workspace,
  utf8,
  removeWithDependencies,
  canonicalDestination,
} from "./test-support.js";

afterEach(cleanupTemporaryRoots);

describe("removeRegularFileSafely", () => {
  it("uses publication ownership to make a later rollback fail closed", async () => {
    const root = await workspace("safe-file-remove-publication-ownership-");
    const destination = await canonicalDestination(root, "resource.txt");
    const heldOwned = join(root, "held-owned");
    const publication = await publishFileSafelyWithOwnership({
      root,
      relativePath: "resource.txt",
      bytes: utf8("owned bytes"),
    });
    await rename(destination, heldOwned);
    await writeFile(destination, "competitor", { flag: "wx" });

    await expect(removeRegularFileSafely(
      root,
      "resource.txt",
      publication.ownership,
    )).resolves.toBe(false);

    expect(publication.created).toBe(true);
    expect(await readFile(destination, "utf8")).toBe("competitor");
    expect(await readFile(heldOwned, "utf8")).toBe("owned bytes");
  });

  it("returns false when the root itself is absent", async () => {
    const base = await workspace("safe-file-remove-missing-root-");
    await expect(removeRegularFileSafely(join(base, "missing-root"), "missing.txt"))
      .resolves.toBe(false);
  });

  it("returns false for an absent leaf", async () => {
    const root = await workspace("safe-file-remove-absent-");
    await expect(removeRegularFileSafely(root, "missing.txt")).resolves.toBe(false);
  });

  it("returns false when the leaf vanishes just before its quarantine", async () => {
    const root = await workspace("safe-file-remove-vanished-");
    await writeFile(join(root, "resource.txt"), "bytes");

    await expect(removeWithDependencies(root, "resource.txt", undefined, {
      quarantineFile: async (source, target) => {
        await unlink(source);
        await rename(source, target);
      },
    })).resolves.toBe(false);
  });

  it("removes only a regular leaf and reports true", async () => {
    const root = await workspace("safe-file-remove-regular-");
    const destination = join(root, "resource.txt");
    await writeFile(destination, "bytes");

    await expect(removeRegularFileSafely(root, "resource.txt")).resolves.toBe(true);
    await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports a retained quarantine when final removal fails before unlink", async () => {
    const root = await workspace("safe-file-remove-final-failure-");
    const destination = await canonicalDestination(root, "resource.txt");
    let quarantinePath = "";
    await writeFile(destination, "bytes");

    await expect(removeWithDependencies(root, "resource.txt", undefined, {
      removeFile: async (path) => {
        quarantinePath = path;
        throw new Error("final unlink failed");
      },
    })).rejects.toThrow(/final unlink failed.*recovery retained|recovery retained.*final unlink failed/i);

    await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(quarantinePath, "utf8")).toBe("bytes");
  });

  it("accepts final removal when unlink commits before throwing", async () => {
    const root = await workspace("safe-file-remove-final-ambiguous-");
    const destination = await canonicalDestination(root, "resource.txt");
    let quarantinePath = "";
    await writeFile(destination, "bytes");

    await expect(removeWithDependencies(root, "resource.txt", undefined, {
      removeFile: async (path) => {
        quarantinePath = path;
        await unlink(path);
        throw new Error("final unlink completion unknown");
      },
    })).resolves.toBe(true);

    await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(quarantinePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses to remove a replacement that does not match expected ownership", async () => {
    const root = await workspace("safe-file-remove-ownership-");
    const destination = await canonicalDestination(root, "resource.txt");
    const heldOwned = join(root, "held-owned");
    await writeFile(destination, "owned bytes");
    const ownedStats = await lstat(destination, { bigint: true });
    const ownership = {
      device: ownedStats.dev,
      inode: ownedStats.ino,
      revision: createHash("sha256").update("owned bytes").digest("hex"),
    };
    await rename(destination, heldOwned);
    await writeFile(destination, "competitor");

    await expect(removeWithDependencies(root, "resource.txt", ownership)).resolves.toBe(false);

    expect(await readFile(destination, "utf8")).toBe("competitor");
    expect(await readFile(heldOwned, "utf8")).toBe("owned bytes");
  });

  it("quarantines and preserves a regular replacement installed at the removal boundary", async () => {
    const root = await workspace("safe-file-remove-boundary-replacement-");
    const destination = await canonicalDestination(root, "resource.txt");
    const heldOwned = join(root, "held-owned");
    let quarantinePath = "";
    let swapped = false;
    await writeFile(destination, "owned bytes");

    await expect(removeWithDependencies(root, "resource.txt", undefined, {
      quarantineFile: async (source, target) => {
        await rename(source, heldOwned);
        await writeFile(source, "competitor", { flag: "wx" });
        quarantinePath = target;
        swapped = true;
        await rename(source, target);
      },
    })).resolves.toBe(false);

    expect(swapped).toBe(true);
    expect(await readFile(destination, "utf8")).toBe("competitor");
    expect(await readFile(quarantinePath, "utf8")).toBe("competitor");
    expect(await readFile(heldOwned, "utf8")).toBe("owned bytes");
  });

  it("does not follow a symbolic-link replacement captured at the removal boundary", async () => {
    const root = await workspace("safe-file-remove-boundary-symlink-");
    const outside = await workspace("safe-file-remove-boundary-symlink-outside-");
    const destination = await canonicalDestination(root, "resource.txt");
    const heldOwned = join(root, "held-owned");
    const sentinel = join(outside, "sentinel.txt");
    let quarantinePath = "";
    await writeFile(destination, "owned bytes");
    await writeFile(sentinel, "outside");

    await expect(removeWithDependencies(root, "resource.txt", undefined, {
      quarantineFile: async (source, target) => {
        await rename(source, heldOwned);
        await symlink(sentinel, source);
        quarantinePath = target;
        await rename(source, target);
      },
    })).rejects.toThrow(/recovery|regular file|changed/i);

    expect((await lstat(quarantinePath)).isSymbolicLink()).toBe(true);
    expect(await readFile(sentinel, "utf8")).toBe("outside");
    expect(await readFile(heldOwned, "utf8")).toBe("owned bytes");
  });

  it.skipIf(process.platform === "win32")(
    "does not read a FIFO replacement captured at the removal boundary",
    async () => {
      const root = await workspace("safe-file-remove-boundary-fifo-");
      const destination = await canonicalDestination(root, "resource.txt");
      const heldOwned = join(root, "held-owned");
      let quarantinePath = "";
      await writeFile(destination, "owned bytes");

      await expect(removeWithDependencies(root, "resource.txt", undefined, {
        quarantineFile: async (source, target) => {
          await rename(source, heldOwned);
          await execFileAsync("mkfifo", [source]);
          quarantinePath = target;
          await rename(source, target);
        },
      })).rejects.toThrow(/recovery|regular file|changed/i);

      expect((await lstat(quarantinePath)).isFIFO()).toBe(true);
      expect(await readFile(heldOwned, "utf8")).toBe("owned bytes");
    },
  );

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
