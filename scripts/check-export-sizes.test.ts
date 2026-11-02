// SPDX-License-Identifier: Apache-2.0
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { compareSizes, expectedSizes, exportedSizes, pngSize } from "./check-export-sizes.mjs";

function pngHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

const specs = {
  platforms: {
    apple: { families: { iphone: { leadStoreSizeId: "6.3", targets: [{ id: "6.3", width: 1206, height: 2622 }, { id: "6.9", width: 1320, height: 2868 }] } } },
  },
};
const project = {
  layouts: [
    { id: "default", screens: [{ platform: "apple", device: "iphone" }, { platform: "apple", device: "iphone", storeTargetId: "6.9" }] },
    { id: "other", screens: [{ platform: "apple", device: "ipad" }] },
  ],
};

const root = await mkdtemp(join(tmpdir(), "screenshot-studio-sizes-"));
afterAll(() => rm(root, { force: true, recursive: true }));

describe("check-export-sizes", () => {
  it("reads width and height from the IHDR chunk", () => {
    expect(pngSize(pngHeader(1206, 2622))).toBe("1206x2622");
    expect(() => pngSize(Buffer.from("not a png at all, really not"))).toThrow("not a PNG");
  });

  it("resolves each screen to its store target or the family's lead size", () => {
    expect(expectedSizes(project, specs, "default")).toEqual(["1206x2622", "1320x2868"]);
    expect(() => expectedSizes(project, specs, "missing")).toThrow("Layout not found");
    expect(() => expectedSizes(project, specs, "other")).toThrow("No store target");
  });

  it("compares sizes as a multiset", () => {
    expect(compareSizes(["1x2", "3x4"], ["3x4", "1x2"])).toEqual([]);
    expect(compareSizes(["1x2", "3x4"], ["1x2", "1x2"])).toHaveLength(1);
    expect(compareSizes(["1x2"], ["1x2", "1x2"])).toHaveLength(1);
    expect(compareSizes(["1x2"], [])).toHaveLength(1);
  });

  it("reads every PNG under nested export folders and ignores other files", async () => {
    const dir = join(root, "export", "apple", "iphone", "en", "6.3");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "01-hero-6.3.png"), pngHeader(1206, 2622));
    await writeFile(join(root, "export", "notes.txt"), "skip");
    expect(await exportedSizes(join(root, "export"))).toEqual(["1206x2622"]);
  });
});
