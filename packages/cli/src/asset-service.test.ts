// SPDX-License-Identifier: Apache-2.0
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { runInit } from "./init.js";
import { autoCropAsset, removeBackgroundAsset } from "./asset-service.js";

type Pixel = readonly [red: number, green: number, blue: number, alpha: number];

async function rgbaPng(
  width: number,
  height: number,
  pixelAt: (x: number, y: number) => Pixel,
): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const pixel = pixelAt(x, y);
      pixels[offset] = pixel[0];
      pixels[offset + 1] = pixel[1];
      pixels[offset + 2] = pixel[2];
      pixels[offset + 3] = pixel[3];
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function initializedProject(prefix: string): Promise<{ dir: string; projectPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await runInit(dir, "Asset Processing");
  return { dir, projectPath: join(dir, "app-store-screenshots.json") };
}

describe("asset processing", () => {
  it("auto-crops top-left-colour margins without mutating the source", async () => {
    const { dir, projectPath } = await initializedProject("screenshot-studio-auto-crop-");
    const sourcePath = join(dir, "assets", "icons", "product.png");
    const source = await rgbaPng(8, 6, (x, y) => (
      x >= 2 && x <= 5 && y >= 2 && y <= 3
        ? [220, 20, 60, 255]
        : [255, 255, 255, 255]
    ));
    await writeFile(sourcePath, source);
    const projectBefore = await readFile(projectPath);

    const result = await autoCropAsset(projectPath, "assets/icons/product.png", { threshold: 0 });

    expect(result).toMatchObject({ path: "assets/processed/product-auto-crop.png", width: 4, height: 2 });
    expect(await readFile(sourcePath)).toEqual(source);
    expect(await readFile(projectPath)).toEqual(projectBefore);
    await expect(readFile(join(dir, result.path))).resolves.toBeInstanceOf(Buffer);
  });

  it("uses collision-safe output names", async () => {
    const { dir, projectPath } = await initializedProject("screenshot-studio-auto-crop-collision-");
    const sourcePath = join(dir, "assets", "icons", "product.png");
    await writeFile(sourcePath, await rgbaPng(3, 3, (x, y) => (
      x === 1 && y === 1 ? [0, 0, 0, 255] : [255, 255, 255, 255]
    )));

    const first = await autoCropAsset(projectPath, "assets/icons/product.png", { threshold: 0 });
    const second = await autoCropAsset(projectPath, "assets/icons/product.png", { threshold: 0 });

    expect(first.path).toBe("assets/processed/product-auto-crop.png");
    expect(second.path).toBe("assets/processed/product-auto-crop-2.png");
  });

  it("rejects real source paths outside the project root", async () => {
    const { dir, projectPath } = await initializedProject("screenshot-studio-asset-containment-");
    const outsidePath = join(dirname(dir), `${basename(dir)}-outside.png`);
    await writeFile(outsidePath, await rgbaPng(1, 1, () => [0, 0, 0, 255]));

    await expect(autoCropAsset(projectPath, outsidePath)).rejects.toThrow(/must stay inside project root/);
  });

  it("rejects source and output-directory symlink escapes", async () => {
    const { dir, projectPath } = await initializedProject("screenshot-studio-asset-symlink-");
    const outsideDir = join(dirname(dir), `${basename(dir)}-outside`);
    await mkdir(outsideDir);
    const outsideSource = join(outsideDir, "outside.png");
    await writeFile(outsideSource, await rgbaPng(3, 3, () => [255, 255, 255, 255]));
    await symlink(outsideSource, join(dir, "assets", "icons", "linked.png"));

    await expect(autoCropAsset(projectPath, "assets/icons/linked.png")).rejects.toThrow(
      /must stay inside project root/,
    );

    const safeSource = join(dir, "assets", "icons", "safe.png");
    await writeFile(safeSource, await rgbaPng(3, 3, () => [255, 255, 255, 255]));
    await symlink(outsideDir, join(dir, "assets", "processed"), "dir");

    await expect(autoCropAsset(projectPath, "assets/icons/safe.png")).rejects.toThrow(
      /must stay inside project root/,
    );
  });

  it("removes only matching edge-connected background pixels", async () => {
    const { dir, projectPath } = await initializedProject("screenshot-studio-background-remove-");
    const sourcePath = join(dir, "assets", "icons", "ring.png");
    const source = await rgbaPng(5, 5, (x, y) => {
      const inRing = x >= 1 && x <= 3 && y >= 1 && y <= 3;
      const enclosedHole = x === 2 && y === 2;
      return inRing && !enclosedHole ? [0, 0, 0, 255] : [255, 255, 255, 255];
    });
    await writeFile(sourcePath, source);

    const result = await removeBackgroundAsset(projectPath, "assets/icons/ring.png", { tolerance: 0 });

    expect(result).toMatchObject({
      path: "assets/processed/ring-background-removed.png",
      width: 5,
      height: 5,
    });
    expect(await readFile(sourcePath)).toEqual(source);
    const output = await sharp(join(dir, result.path)).ensureAlpha().raw().toBuffer();
    const alphaAt = (x: number, y: number): number => output[(y * 5 + x) * 4 + 3]!;
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(1, 1)).toBe(255);
    expect(alphaAt(2, 2)).toBe(255);
  });

  it("honours an explicit near-uniform background colour and tolerance", async () => {
    const { dir, projectPath } = await initializedProject("screenshot-studio-background-tolerance-");
    const sourcePath = join(dir, "assets", "icons", "soft-edge.png");
    await writeFile(sourcePath, await rgbaPng(3, 1, (x) => (
      x === 2 ? [20, 20, 20, 255] : [250 - x * 5, 250 - x * 5, 250 - x * 5, 255]
    )));

    const result = await removeBackgroundAsset(projectPath, "assets/icons/soft-edge.png", {
      background: { red: 255, green: 255, blue: 255 },
      tolerance: 10,
    });

    const output = await sharp(join(dir, result.path)).ensureAlpha().raw().toBuffer();
    expect(output[3]).toBe(0);
    expect(output[7]).toBe(0);
    expect(output[11]).toBe(255);
  });
});
