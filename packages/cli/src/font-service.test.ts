// SPDX-License-Identifier: Apache-2.0
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  addGoogleFont,
  addUploadedFont,
  downloadGoogleFont,
  FontConflictError,
  GoogleFontError,
  removeFont,
} from "./font-service.js";
import { loadProjectFile } from "./project-io.js";

const baseProject = {
  meta: { name: "Fonts", schemaVersion: 5 },
  mode: "isolated",
  platforms: ["apple"],
  locales: ["en"],
  fonts: [],
  screens: [{
    id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
    artboard: { width: 660, height: 1434 },
    background: { type: "solid", color: "#111111" }, elements: [],
  }],
};

async function projectFile(fonts: unknown[] = []) {
  const dir = await mkdtemp(join(tmpdir(), "font-service-"));
  const path = join(dir, "app-store-screenshots.json");
  await writeFile(path, JSON.stringify({ ...baseProject, fonts }));
  return { dir, path };
}

describe("font-service safety", () => {
  it("rejects a duplicate Google identity before making a request", async () => {
    const { path } = await projectFile([{
      family: "Inter", weight: 400, source: "uploaded", path: "assets/fonts/inter-400.ttf",
    }]);
    const fetch = vi.fn();

    await expect(addGoogleFont(path, { family: "Inter", weight: 400 }, { fetch }))
      .rejects.toBeInstanceOf(FontConflictError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["no URLs", "@font-face { font-family: Inter; }", 0],
    ["multiple URLs", "@font-face { src: url(https://fonts.gstatic.com/a.ttf); } @font-face { src: url(https://fonts.gstatic.com/b.ttf); }", 2],
  ])("rejects Google CSS with %s", async (_name, css, count) => {
    const fetch = vi.fn().mockResolvedValue(new Response(css));
    await expect(downloadGoogleFont("Inter", 400, fetch))
      .rejects.toThrow(`returned ${count} font files`);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("pins a non-browser CSS request and rejects non-Google font hosts", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response("@font-face { src: url(https://example.com/inter.ttf); }"),
    );
    await expect(downloadGoogleFont("Inter", 400, fetch)).rejects.toBeInstanceOf(GoogleFontError);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("fonts.googleapis.com/css2"),
      { headers: { "user-agent": "ScreenshotStudio-FontIngest/1.0" } },
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses exclusive file creation and refuses a slug collision without overwriting", async () => {
    const { dir, path } = await projectFile();
    const target = join(dir, "assets/fonts/inter-400.ttf");
    await mkdir(join(dir, "assets/fonts"), { recursive: true });
    await writeFile(target, "existing", { flag: "wx" });
    const writeFontFile = vi.fn(writeFile);

    await expect(addUploadedFont(path, {
      family: "INTER", weight: 400, filename: "font.ttf", bytes: new Uint8Array([1, 2, 3]),
    }, { writeFontFile })).rejects.toBeInstanceOf(FontConflictError);

    expect(writeFontFile).toHaveBeenCalledWith(target, expect.any(Uint8Array), { flag: "wx" });
    expect(await readFile(target, "utf8")).toBe("existing");
    expect((await loadProjectFile(path)).fonts).toEqual([]);
  });

  it("rolls back the created file when the project write fails", async () => {
    const { dir, path } = await projectFile();
    const failure = new Error("project write failed");

    await expect(addUploadedFont(path, {
      family: "Inter", weight: 400, filename: "font.ttf", bytes: new Uint8Array([1, 2, 3]),
    }, { writeProjectFile: async () => { throw failure; } })).rejects.toBe(failure);

    await expect(readFile(join(dir, "assets/fonts/inter-400.ttf"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await loadProjectFile(path)).fonts).toEqual([]);
  });

  it("never deletes outside assets/fonts and keeps a shared managed path", async () => {
    const outside = await projectFile([{
      family: "Outside", weight: 400, source: "uploaded", path: "outside.ttf",
    }]);
    await writeFile(join(outside.dir, "outside.ttf"), "outside");
    await removeFont(outside.path, { family: "Outside", weight: 400 });
    expect(await readFile(join(outside.dir, "outside.ttf"), "utf8")).toBe("outside");

    const sharedPath = "assets/fonts/shared.ttf";
    const shared = await projectFile([
      { family: "One", weight: 400, source: "uploaded", path: sharedPath },
      { family: "Two", weight: 700, source: "uploaded", path: sharedPath },
    ]);
    await mkdir(join(shared.dir, "assets/fonts"), { recursive: true });
    await writeFile(join(shared.dir, sharedPath), "shared");
    await removeFont(shared.path, { family: "One", weight: 400 });
    expect(await readFile(join(shared.dir, sharedPath), "utf8")).toBe("shared");
  });
});
