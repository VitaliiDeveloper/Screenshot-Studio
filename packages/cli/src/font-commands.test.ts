// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { resolveFontAction, runFontCommand } from "./font-commands.js";
import { loadProjectFile } from "./project-io.js";

async function projectFile() {
  const dir = await mkdtemp(join(tmpdir(), "font-command-"));
  const path = join(dir, "app-store-screenshots.json");
  await writeFile(path, JSON.stringify({
    meta: { name: "Fonts", schemaVersion: 1 }, mode: "isolated", platforms: ["apple"], locales: ["en"], fonts: [],
    screens: [{ id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en", artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#111111" }, elements: [] }],
  }));
  return { dir, path };
}

describe("resolveFontAction", () => {
  it("requires a family for uploaded files and validates weights", () => {
    expect(() => resolveFontAction(["add", "font.ttf"], {})).toThrow(/--family/);
    expect(() => resolveFontAction(["add", "font.ttf"], { family: "Inter", weight: "99" })).toThrow(/weight/);
    expect(resolveFontAction(["add"], { google: "Inter", weight: "700" })).toEqual({ kind: "add", source: "google", family: "Inter", weight: 700 });
  });
});

describe("runFontCommand", () => {
  it("copies, lists, and removes an uploaded font", async () => {
    const { dir, path } = await projectFile();
    const source = join(dir, "Inter.ttf");
    await writeFile(source, "font-bytes");

    await expect(runFontCommand(path, ["add", source], { family: "Inter", weight: "700" })).resolves.toBe("Inter 700 uploaded assets/fonts/inter-700.ttf");
    expect(await readFile(join(dir, "assets/fonts/inter-700.ttf"), "utf8")).toBe("font-bytes");
    await expect(runFontCommand(path, ["list"], {})).resolves.toContain("Inter 700 uploaded");
    await expect(runFontCommand(path, ["rm", "Inter"], { weight: "700" })).resolves.toBe("");
    await expect(readFile(join(dir, "assets/fonts/inter-700.ttf"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await loadProjectFile(path)).fonts).toEqual([]);
  });

  it("materializes a Google font once from CSS and bytes", async () => {
    const { dir, path } = await projectFile();
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("@font-face { src: url(https://fonts.gstatic.com/s/inter/v1/inter.ttf) format('truetype'); }"))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));

    await runFontCommand(path, ["add"], { google: "Inter" }, { fetch });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await readFile(join(dir, "assets/fonts/inter-400.ttf"))).toEqual(Buffer.from([1, 2, 3]));
    expect((await loadProjectFile(path)).fonts).toEqual([{ family: "Inter", source: "google", path: "assets/fonts/inter-400.ttf", weight: 400 }]);
  });

  it("rejects unsupported font files before changing the project", async () => {
    const { dir, path } = await projectFile();
    const source = join(dir, "Inter.txt");
    await writeFile(source, "not a font");
    await expect(runFontCommand(path, ["add", source], { family: "Inter" })).rejects.toThrow(/Unsupported font file/);
    expect((await loadProjectFile(path)).fonts).toEqual([]);
  });
});
