// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
