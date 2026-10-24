// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseStoreSpecs } from "@screenshot-studio/core/export";
import { runInit } from "./init.js";
import { runAssetCommand } from "./asset-commands.js";

const storeSpecs = parseStoreSpecs(JSON.parse(
  await readFile(new URL("../../../store-specs.json", import.meta.url), "utf8"),
));

async function projectWithSource(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await runInit(dir, "Asset Commands", storeSpecs);
  const png = await sharp({
    create: { width: 2, height: 2, channels: 4, background: "white" },
  }).png().toBuffer();
  await writeFile(join(dir, "assets", "icons", "source.png"), png);
  return join(dir, "app-store-screenshots.json");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runAssetCommand", () => {
  it("imports an image from outside the project without touching the project file", async () => {
    const projectPath = await projectWithSource("screenshot-studio-asset-command-import-");
    const projectBefore = await readFile(projectPath);
    const outside = await mkdtemp(join(tmpdir(), "screenshot-studio-asset-import-source-"));
    const png = await readFile(join(dirname(projectPath), "assets", "icons", "source.png"));
    await writeFile(join(outside, "1.png"), png);

    await expect(runAssetCommand(projectPath, ["import", join(outside, "1.png")], {}))
      .resolves.toBe("Imported assets/imported/1.png");
    await expect(runAssetCommand(projectPath, ["import", join(outside, "1.png")], {}))
      .resolves.toBe("Imported assets/imported/1.png");
    await writeFile(join(outside, "1.png"), await sharp(png).png({ compressionLevel: 0 }).toBuffer());
    await expect(runAssetCommand(projectPath, ["import", join(outside, "1.png")], {}))
      .resolves.toBe("Imported assets/imported/1-2.png");
    expect(await readFile(join(dirname(projectPath), "assets", "imported", "1.png"))).toEqual(png);
    expect(await readFile(projectPath)).toEqual(projectBefore);
  });

  it("refuses an import that is not an image file", async () => {
    const projectPath = await projectWithSource("screenshot-studio-asset-command-import-invalid-");
    const outside = await mkdtemp(join(tmpdir(), "screenshot-studio-asset-import-invalid-"));
    await writeFile(join(outside, "notes.png"), "not an image");

    await expect(runAssetCommand(projectPath, ["import", join(outside, "notes.png")], {}))
      .rejects.toThrow(/valid PNG, JPEG, or WebP/);
    await expect(runAssetCommand(projectPath, ["import", outside], {})).rejects.toThrow(/not a file/);
    await expect(runAssetCommand(projectPath, ["import", join(outside, "missing.png")], {}))
      .rejects.toThrow(/not found/);
    await expect(runAssetCommand(projectPath, ["import"], {})).rejects.toThrow(/asset import <file>/);
    await expect(readdir(join(dirname(projectPath), "assets", "imported"))).rejects.toThrow(/ENOENT/);
  });

  it("returns the persisted auto-crop path and dimensions", async () => {
    const projectPath = await projectWithSource("screenshot-studio-asset-command-crop-");

    await expect(runAssetCommand(
      projectPath,
      ["auto-crop", "assets/icons/source.png"],
      { threshold: "0" },
    )).resolves.toMatch(/^Created assets\/processed\/source-auto-crop\.png \(1x1\)$/);
  });

  it("runs background removal without a network request", async () => {
    const projectPath = await projectWithSource("screenshot-studio-asset-command-background-");
    const fetchSpy = vi.fn(() => Promise.reject(new Error("network disabled")));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(runAssetCommand(
      projectPath,
      ["remove-background", "assets/icons/source.png"],
      { background: "#FFFFFF", tolerance: "0" },
    )).resolves.toMatch(/^Created assets\/processed\/source-background-removed\.png \(2x2\)$/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects invalid commands and byte flags", async () => {
    const projectPath = await projectWithSource("screenshot-studio-asset-command-invalid-");

    await expect(runAssetCommand(projectPath, ["auto-crop"], {})).rejects.toThrow(/auto-crop <file>/);
    await expect(runAssetCommand(
      projectPath,
      ["remove-background", "assets/icons/source.png"],
      { tolerance: "256" },
    )).rejects.toThrow(/--tolerance must be an integer from 0 to 255/);
    await expect(runAssetCommand(
      projectPath,
      ["remove-background", "assets/icons/source.png"],
      { background: "white" },
    )).rejects.toThrow(/six-digit RGB hex/);
  });
});
