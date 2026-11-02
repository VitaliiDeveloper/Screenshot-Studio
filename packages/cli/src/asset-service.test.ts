// SPDX-License-Identifier: Apache-2.0
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  symlink,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { parseStoreSpecs } from "@screenshot-studio/core/export";
import { projectRevision } from "@screenshot-studio/core/storage";
import { runInit } from "./init.js";
import {
  autoCropAsset,
  removeBackgroundAsset,
} from "./asset-service.js";
import { importProjectImageMutation } from "./project-image-service.js";
import { captureImportIntentPath } from "./capture-import-recovery.js";
import { publishFileSafely } from "./safe-file-publisher.js";

const cleanupPaths: string[] = [];
const storeSpecs = parseStoreSpecs(JSON.parse(
  await readFile(new URL("../../../store-specs.json", import.meta.url), "utf8"),
));

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

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

function pngWithoutImageData(png: Buffer): Buffer {
  const chunks = [png.subarray(0, 8)];
  let offset = 8;
  while (offset + 12 <= png.byteLength) {
    const length = png.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > png.byteLength) throw new Error("Invalid PNG test fixture");
    if (png.toString("ascii", offset + 4, offset + 8) !== "IDAT") {
      chunks.push(png.subarray(offset, end));
    }
    offset = end;
  }
  return Buffer.concat(chunks);
}

async function initializedProject(prefix: string): Promise<{ dir: string; projectPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanupPaths.push(dir);
  await runInit(dir, "Asset Processing", storeSpecs);
  return { dir, projectPath: join(dir, "app-store-screenshots.json") };
}

describe("asset processing", () => {
  it("imports decoded project images with collision-safe project-relative names", async () => {
    const { dir, projectPath } = await initializedProject("screenshot-studio-asset-import-");
    const firstBytes = await rgbaPng(3, 2, () => [15, 80, 160, 255]);
    const secondBytes = await rgbaPng(3, 2, () => [220, 90, 30, 255]);
    const projectBefore = await readFile(projectPath);

    const first = await importProjectImageMutation(projectPath, {
      filename: "My Finder capture.gif",
      bytes: firstBytes,
    }, {}, { expectedRevision: projectRevision(projectBefore) });
    const repeated = await importProjectImageMutation(projectPath, {
      filename: "My Finder capture.gif",
      bytes: firstBytes,
    });
    const collision = await importProjectImageMutation(projectPath, {
      filename: "My Finder capture.png",
      bytes: secondBytes,
    });

    expect(first).toEqual({
      asset: {
        path: "assets/imported/My-Finder-capture.png",
        name: "My-Finder-capture.png",
        source: "assets",
      },
      revision: projectRevision(projectBefore),
    });
    expect(repeated.asset.path).toBe(first.asset.path);
    expect(collision.asset.path).toBe("assets/imported/My-Finder-capture-2.png");
    expect(await readFile(join(dir, first.asset.path))).toEqual(firstBytes);
    expect(await readFile(join(dir, collision.asset.path))).toEqual(secondBytes);
    expect(await readFile(projectPath)).toEqual(projectBefore);
  });

  it("renames images the project archive would drop", async () => {
    const { projectPath } = await initializedProject("screenshot-studio-asset-import-archivable-");
    const paths = [];
    for (const [index, filename] of ["secret-sauce.png", "lock.png", "credentials-screen.png"].entries()) {
      const bytes = await rgbaPng(1, 1, () => [index, 0, 0, 255]);
      paths.push((await importProjectImageMutation(projectPath, { filename, bytes })).asset.path);
    }
    expect(paths).toEqual([
      "assets/imported/asset.png",
      "assets/imported/asset-2.png",
      "assets/imported/asset-3.png",
    ]);
  });

  it("rejects invalid image bytes and stale revisions before publication", async () => {
    const { dir, projectPath } = await initializedProject("screenshot-studio-asset-import-invalid-");
    await expect(importProjectImageMutation(projectPath, {
      filename: "not-an-image.png",
      bytes: new TextEncoder().encode("not an image"),
    })).rejects.toThrow(/valid PNG, JPEG, or WebP|could not be decoded/);

    const validBytes = await rgbaPng(1, 1, () => [0, 0, 0, 255]);
    await expect(importProjectImageMutation(projectPath, {
      filename: "missing-image-data.png",
      bytes: pngWithoutImageData(validBytes),
    })).rejects.toThrow(/valid PNG, JPEG, or WebP|could not be decoded/);
    await expect(importProjectImageMutation(projectPath, {
      filename: "stale.png",
      bytes: validBytes,
    }, {}, { expectedRevision: "stale-revision" })).rejects.toMatchObject({
      name: "ProjectRevisionConflictError",
    });
    await expect(readFile(join(dir, "assets/imported/not-an-image.png")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(dir, "assets/imported/missing-image-data.png")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(dir, "assets/imported/stale.png")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("derives JPEG and WebP extensions from image bytes instead of the Finder filename", async () => {
    const { dir, projectPath } = await initializedProject("screenshot-studio-image-formats-");
    const pixels = Buffer.from([30, 90, 180, 255]);
    const jpeg = await sharp(pixels, { raw: { width: 1, height: 1, channels: 4 } })
      .jpeg()
      .toBuffer();
    const webp = await sharp(pixels, { raw: { width: 1, height: 1, channels: 4 } })
      .webp()
      .toBuffer();

    const jpegResult = await importProjectImageMutation(projectPath, {
      filename: "camera-export.png",
      bytes: jpeg,
    });
    const webpResult = await importProjectImageMutation(projectPath, {
      filename: "browser-export.jpg",
      bytes: webp,
    });

    expect(jpegResult.asset.path).toBe("assets/imported/camera-export.jpg");
    expect(webpResult.asset.path).toBe("assets/imported/browser-export.webp");
    expect(await readFile(join(dir, jpegResult.asset.path))).toEqual(jpeg);
    expect(await readFile(join(dir, webpResult.asset.path))).toEqual(webp);
  });

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
    cleanupPaths.push(outsidePath);
    await writeFile(outsidePath, await rgbaPng(1, 1, () => [0, 0, 0, 255]));

    await expect(autoCropAsset(projectPath, outsidePath)).rejects.toThrow(/must stay inside project root/);
  });

  it("rejects source and output-directory symlink escapes", async () => {
    const { dir, projectPath } = await initializedProject("screenshot-studio-asset-symlink-");
    const outsideDir = join(dirname(dir), `${basename(dir)}-outside`);
    cleanupPaths.push(outsideDir);
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

  it("does not reopen a source that becomes an external symlink after validation", async () => {
    const { dir, projectPath } = await initializedProject("screenshot-studio-asset-source-race-");
    const sourcePath = join(dir, "assets", "icons", "source.png");
    const outsidePath = join(dirname(dir), `${basename(dir)}-outside.png`);
    cleanupPaths.push(outsidePath);
    await writeFile(sourcePath, await rgbaPng(3, 3, () => [255, 255, 255, 255]));
    await writeFile(outsidePath, await rgbaPng(3, 3, () => [0, 0, 0, 255]));
    let openAttempted = false;

    await expect(autoCropAsset(
      projectPath,
      "assets/icons/source.png",
      { threshold: 0 },
      {
        openSourceFile: async (path) => {
          openAttempted = true;
          await rm(path);
          await symlink(outsidePath, path);
          // Deliberately ignore the supplied O_NOFOLLOW flag to prove the inode checks are the
          // portable enforcement boundary on platforms that do not expose it.
          return open(path, "r");
        },
      },
    )).rejects.toThrow(/changed|symbolic link/i);

    expect(openAttempted).toBe(true);
    await expect(readFile(join(dir, "assets", "processed", "source-auto-crop.png")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an ancestor directory rebound to an external symlink before open", async () => {
    const { dir, projectPath } = await initializedProject("screenshot-studio-asset-ancestor-race-");
    const sourcePath = join(dir, "assets", "icons", "source.png");
    const outsideDir = join(dirname(dir), `${basename(dir)}-outside`);
    cleanupPaths.push(outsideDir);
    await mkdir(outsideDir);
    await writeFile(sourcePath, await rgbaPng(3, 3, () => [255, 255, 255, 255]));
    await writeFile(join(outsideDir, "source.png"), await rgbaPng(3, 3, () => [0, 0, 0, 255]));

    await expect(autoCropAsset(
      projectPath,
      "assets/icons/source.png",
      { threshold: 0 },
      {
        openSourceFile: async (path, flags) => {
          await rm(join(dir, "assets", "icons"), { recursive: true });
          await symlink(outsideDir, join(dir, "assets", "icons"), "dir");
          return open(path, flags);
        },
      },
    )).rejects.toThrow(/changed|symbolic link/i);
  });

  it("rejects a regular-file replacement after source validation", async () => {
    const { dir, projectPath } = await initializedProject("screenshot-studio-asset-leaf-race-");
    const sourcePath = join(dir, "assets", "icons", "source.png");
    await writeFile(sourcePath, await rgbaPng(3, 3, () => [255, 255, 255, 255]));

    await expect(autoCropAsset(
      projectPath,
      "assets/icons/source.png",
      { threshold: 0 },
      {
        openSourceFile: async (path, flags) => {
          await rm(path);
          await writeFile(path, await rgbaPng(3, 3, () => [0, 0, 0, 255]));
          return open(path, flags);
        },
      },
    )).rejects.toThrow(/changed|symbolic link/i);
  });

  it("preserves source-read and handle-close failures together", async () => {
    const { dir, projectPath } = await initializedProject("screenshot-studio-asset-close-error-");
    const sourcePath = join(dir, "assets", "icons", "source.png");
    await writeFile(sourcePath, await rgbaPng(3, 3, () => [255, 255, 255, 255]));

    const caught = await autoCropAsset(
      projectPath,
      "assets/icons/source.png",
      { threshold: 0 },
      {
        openSourceFile: async (path, flags) => {
          const handle = await open(path, flags);
          return {
            stat: () => handle.stat({ bigint: true }),
            readFile: async () => { throw new Error("source read failed"); },
            close: async () => {
              await handle.close();
              throw new Error("source close failed");
            },
          } as unknown as FileHandle;
        },
      },
    ).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors.map((error) => (error as Error).message)).toEqual([
      "source read failed",
      "source close failed",
    ]);
  });

  it("does not skip an unsafe first output candidate and publish a numbered fallback", async () => {
    const { dir, projectPath } = await initializedProject("screenshot-studio-asset-output-leaf-");
    const sourcePath = join(dir, "assets", "icons", "product.png");
    const outsidePath = join(dirname(dir), `${basename(dir)}-outside.png`);
    cleanupPaths.push(outsidePath);
    await writeFile(sourcePath, await rgbaPng(3, 3, (x, y) => (
      x === 1 && y === 1 ? [0, 0, 0, 255] : [255, 255, 255, 255]
    )));
    await writeFile(outsidePath, "outside sentinel");
    await mkdir(join(dir, "assets", "processed"), { recursive: true });
    await symlink(outsidePath, join(dir, "assets", "processed", "product-auto-crop.png"));

    await expect(autoCropAsset(
      projectPath,
      "assets/icons/product.png",
      { threshold: 0 },
    )).rejects.toThrow(/symbolic link.*destination/i);

    expect(await readFile(outsidePath, "utf8")).toBe("outside sentinel");
    await expect(readFile(join(dir, "assets", "processed", "product-auto-crop-2.png")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps processing and safe publication inside the canonical project lease", async () => {
    const { dir, projectPath } = await initializedProject("screenshot-studio-asset-lease-");
    const sourcePath = join(dir, "assets", "icons", "product.png");
    await writeFile(sourcePath, await rgbaPng(3, 3, (x, y) => (
      x === 1 && y === 1 ? [0, 0, 0, 255] : [255, 255, 255, 255]
    )));
    const events: string[] = [];

    await autoCropAsset(projectPath, "assets/icons/product.png", { threshold: 0 }, {
      withProjectMutation: async (_path, operation) => {
        events.push("lease-enter");
        try {
          return await operation();
        } finally {
          events.push("lease-exit");
        }
      },
      publishFileSafely: async (options) => {
        events.push("publish");
        return publishFileSafely(options);
      },
    });

    expect(events).toEqual(["lease-enter", "publish", "lease-exit"]);
  });

  it("blocks direct resource mutations while capture-import recovery is malformed", async () => {
    const { dir, projectPath } = await initializedProject("screenshot-studio-asset-recovery-");
    const sourcePath = join(dir, "assets", "icons", "product.png");
    await writeFile(sourcePath, await rgbaPng(3, 3, () => [255, 255, 255, 255]));
    await writeFile(captureImportIntentPath(projectPath), "{}\n");

    await expect(autoCropAsset(projectPath, "assets/icons/product.png"))
      .rejects.toThrow(/invalid capture import recovery intent/i);
    await expect(readFile(join(dir, "assets", "processed", "product-auto-crop.png")))
      .rejects.toMatchObject({ code: "ENOENT" });
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
