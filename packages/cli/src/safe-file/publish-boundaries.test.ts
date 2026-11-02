// SPDX-License-Identifier: Apache-2.0
import {
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { publishFileSafely } from "../safe-file-publisher.js";
import {
  cleanupTemporaryRoots,
  workspace,
  utf8,
  publishWithDependencies,
  stageEntries,
  canonicalDestination,
} from "./test-support.js";

afterEach(cleanupTemporaryRoots);

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

  it("creates a missing root below a symbolic-link ancestor the caller chose", async () => {
    const base = await workspace("safe-file-missing-root-symlink-");
    const target = await workspace("safe-file-missing-root-target-");
    const linked = join(base, "linked");
    await symlink(target, linked);

    await expect(publishFileSafely({
      root: join(linked, "new", "root"),
      relativePath: "resource.txt",
      bytes: utf8("bytes"),
    })).resolves.toEqual({
      path: join(await realpath(target), "new", "root", "resource.txt"),
      created: true,
    });

    expect(await readFile(join(target, "new", "root", "resource.txt"), "utf8")).toBe("bytes");
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
});
