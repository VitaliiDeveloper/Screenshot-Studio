// SPDX-License-Identifier: Apache-2.0
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  publishManagedResourceFile,
  quarantineManagedResourceFile,
  removeManagedResourceFile,
} from "./managed-resource-file.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "screenshot-studio-managed-resource-"));
  temporaryRoots.push(root);
  return root;
}

describe("managed resource files", () => {
  it("publishes ownership evidence used by rollback and later removal", async () => {
    const root = await workspace();
    const destination = join(root, "fonts", "Inter.ttf");

    const publication = await publishManagedResourceFile({
      root,
      relativePath: "fonts/Inter.ttf",
      bytes: new TextEncoder().encode("font bytes"),
    });
    const quarantine = await quarantineManagedResourceFile(
      root,
      "fonts/Inter.ttf",
      publication.ownership,
    );

    expect(publication.created).toBe(true);
    expect(quarantine).not.toBeNull();
    await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });

    await quarantine!.restore();
    expect(await readFile(destination, "utf8")).toBe("font bytes");
    await expect(removeManagedResourceFile(
      root,
      "fonts/Inter.ttf",
      publication.ownership,
    )).resolves.toBe(true);
    await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
