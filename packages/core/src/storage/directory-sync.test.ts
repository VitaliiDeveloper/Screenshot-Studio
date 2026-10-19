// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { syncDirectoryBestEffort, type DirectoryHandle } from "./directory-sync.js";

describe("syncDirectoryBestEffort", () => {
  it("syncs a real directory with the default opener", async () => {
    const directory = await mkdtemp(join(tmpdir(), "directory-sync-"));
    try {
      await expect(syncDirectoryBestEffort(directory)).resolves.toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("swallows an open failure", async () => {
    await expect(syncDirectoryBestEffort("/unused", async () => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    })).resolves.toBeUndefined();
  });

  it("swallows sync and close failures and still closes the handle", async () => {
    let closed = 0;
    const handle: DirectoryHandle = {
      sync: async () => { throw new Error("fsync unsupported"); },
      close: async () => {
        closed += 1;
        throw new Error("close failed");
      },
    };
    await expect(syncDirectoryBestEffort("/unused", async () => handle)).resolves.toBeUndefined();
    expect(closed).toBe(1);
  });
});
