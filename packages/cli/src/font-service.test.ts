// SPDX-License-Identifier: Apache-2.0
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  addGoogleFont,
  addUploadedFont,
  downloadGoogleFont,
  FontConflictError,
  FontInUseError,
  FontValidationError,
  GoogleFontError,
  removeFont,
} from "./font-service.js";
import { loadProjectFile } from "./project-io.js";
import {
  publishFileSafelyWithOwnership,
  quarantineRegularFileSafely,
} from "./safe-file-publisher.js";

const baseProject = {
  meta: { name: "Fonts", schemaVersion: 1 },
  fonts: [],
  preferredExportLayoutId: "default",
  layouts: [{
    id: "default", name: "Default", mode: "isolated",
    screens: [{
      id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
      artboard: { width: 660, height: 1434 },
      background: { type: "solid", color: "#111111" }, elements: [],
    }],
  }],
};

const temporaryDirectories: string[] = [];
let validTtf: Buffer;

beforeAll(async () => {
  validTtf = await readFile(new URL("../../../fixtures/sample/assets/fonts/Pacifico-Regular.ttf", import.meta.url));
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
});

async function projectFile(options: {
  fonts?: unknown[];
  elements?: unknown[];
} = {}) {
  const dir = await mkdtemp(join(tmpdir(), "font-service-"));
  temporaryDirectories.push(dir);
  const path = join(dir, "app-store-screenshots.json");
  await writeFile(path, JSON.stringify({
    ...baseProject,
    fonts: options.fonts ?? [],
    layouts: [{
      ...baseProject.layouts[0],
      screens: [{
        ...baseProject.layouts[0]!.screens[0],
        elements: options.elements ?? [],
      }],
    }],
  }));
  return { dir, path };
}

function textElement(id: string) {
  return {
    id,
    type: "text",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    content: id,
    fontFamily: "Inter",
    size: 24,
    weight: 400,
    lineHeight: 1.2,
    letterSpacing: 0,
    align: "left",
    color: "#ffffff",
  };
}

// Deep equality walks a 320 KB font byte by byte and costs hundreds of milliseconds.
const sameBytes = (expected: Buffer) => ({
  asymmetricMatch: (actual: unknown) => Buffer.isBuffer(actual) && actual.equals(expected),
});

function registeredFont(path = "assets/fonts/inter-400.ttf") {
  return { family: "Inter", weight: 400, source: "uploaded", path };
}

describe("font-service safety", () => {
  it("rejects a duplicate Google identity before making a request", async () => {
    const { path } = await projectFile({ fonts: [registeredFont()] });
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

  it("validates upload bytes before publishing or mutating project JSON", async () => {
    const { dir, path } = await projectFile();
    const originalJson = await readFile(path, "utf8");
    const publishFontFile = vi.fn(publishFileSafelyWithOwnership);

    await expect(addUploadedFont(path, {
      family: "Inter",
      weight: 400,
      filename: "font.ttf",
      bytes: Buffer.from("<!doctype html><title>not a font</title>"),
    }, { publishFontFile })).rejects.toBeInstanceOf(FontValidationError);

    expect(publishFontFile).not.toHaveBeenCalled();
    expect(await readFile(path, "utf8")).toBe(originalJson);
    await expect(readFile(join(dir, "assets/fonts/inter-400.ttf"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects invalid Google bytes as 422-class materialization without publishing", async () => {
    const { path } = await projectFile();
    const publishFontFile = vi.fn(publishFileSafelyWithOwnership);
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("@font-face { src: url(https://fonts.gstatic.com/s/inter/v1/inter.ttf); }"))
      .mockResolvedValueOnce(new Response("<!doctype html>"));

    await expect(addGoogleFont(path, { family: "Inter", weight: 400 }, {
      fetch,
      publishFontFile,
    })).rejects.toBeInstanceOf(GoogleFontError);

    expect(publishFontFile).not.toHaveBeenCalled();
    expect((await loadProjectFile(path)).fonts).toEqual([]);
  });

  it("publishes a valid add, rejects a duplicate, and safely removes the unused font", async () => {
    const { dir, path } = await projectFile();
    const publishFontFile = vi.fn(publishFileSafelyWithOwnership);
    const quarantineFontFile = vi.fn(quarantineRegularFileSafely);

    const added = await addUploadedFont(path, {
      family: "Inter",
      weight: 400,
      filename: "font.ttf",
      bytes: validTtf,
    }, { publishFontFile, quarantineFontFile });
    expect(added.fonts).toEqual([registeredFont()]);
    expect(publishFontFile).toHaveBeenCalledWith({
      root: await realpath(dir),
      relativePath: "assets/fonts/inter-400.ttf",
      bytes: sameBytes(validTtf),
    });

    await expect(addUploadedFont(path, {
      family: "Inter",
      weight: 400,
      filename: "font.ttf",
      bytes: validTtf,
    })).rejects.toBeInstanceOf(FontConflictError);

    const removed = await removeFont(path, { family: "Inter", weight: 400 }, {
      quarantineFontFile,
    });
    expect(removed.fonts).toEqual([]);
    expect(quarantineFontFile).toHaveBeenCalledWith(
      await realpath(dir),
      "assets/fonts/inter-400.ttf",
    );
    await expect(readFile(join(dir, "assets/fonts/inter-400.ttf"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.each([
    ["top-level", [textElement("top-level")], 1],
    ["grouped", [{
      id: "group",
      type: "group",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      rotation: 0,
      opacity: 1,
      locked: false,
      visible: true,
      children: [textElement("nested")],
    }], 1],
  ])("rejects removal of a %s text font inside the project lease", async (_kind, elements, usage) => {
    const { dir, path } = await projectFile({ fonts: [registeredFont()], elements });
    await mkdir(join(dir, "assets/fonts"), { recursive: true });
    await writeFile(join(dir, "assets/fonts/inter-400.ttf"), validTtf);
    const quarantineFontFile = vi.fn(quarantineRegularFileSafely);

    const operation = removeFont(path, { family: "Inter", weight: 400 }, { quarantineFontFile });
    await expect(operation).rejects.toMatchObject({
      family: "Inter",
      weight: 400,
      usage,
    });
    await expect(operation).rejects.toBeInstanceOf(FontInUseError);

    expect(quarantineFontFile).not.toHaveBeenCalled();
    expect((await loadProjectFile(path)).fonts).toEqual([registeredFont()]);
    expect((await readFile(join(dir, "assets/fonts/inter-400.ttf"))).equals(validTtf)).toBe(true);
  });

  it("preserves JSON when managed-resource deletion policy rejects a symlink", async () => {
    const { dir, path } = await projectFile({ fonts: [registeredFont()] });
    const sentinel = join(dir, "outside.ttf");
    await writeFile(sentinel, "outside");
    await mkdir(join(dir, "assets/fonts"), { recursive: true });
    await symlink(sentinel, join(dir, "assets/fonts/inter-400.ttf"));

    await expect(removeFont(path, { family: "Inter", weight: 400 })).rejects.toThrow(/symbolic link/i);

    expect(await readFile(sentinel, "utf8")).toBe("outside");
    expect((await loadProjectFile(path)).fonts).toEqual([registeredFont()]);
  });

  it("rejects Windows-separator project paths without deleting an outside sentinel", async () => {
    const { dir, path } = await projectFile({
      fonts: [registeredFont("assets\\fonts\\..\\..\\outside.ttf")],
    });
    const sentinel = join(dir, "outside.ttf");
    await writeFile(sentinel, "outside");

    await expect(removeFont(path, { family: "Inter", weight: 400 })).rejects.toThrow(/portable project-relative path/i);

    expect(await readFile(sentinel, "utf8")).toBe("outside");
  });

  it("keeps a shared managed resource when removing one unused identity", async () => {
    const sharedPath = "assets/fonts/shared.ttf";
    const { dir, path } = await projectFile({ fonts: [
      registeredFont(sharedPath),
      { family: "Other", weight: 700, source: "uploaded", path: sharedPath },
    ] });
    await mkdir(join(dir, "assets/fonts"), { recursive: true });
    await writeFile(join(dir, sharedPath), validTtf);
    const quarantineFontFile = vi.fn(quarantineRegularFileSafely);

    await removeFont(path, { family: "Inter", weight: 400 }, { quarantineFontFile });

    expect(quarantineFontFile).not.toHaveBeenCalled();
    expect((await readFile(join(dir, sharedPath))).equals(validTtf)).toBe(true);
  });

  it("rolls back a created resource when the project write fails", async () => {
    const { dir, path } = await projectFile();
    const failure = new Error("project write failed");

    await expect(addUploadedFont(path, {
      family: "Inter",
      weight: 400,
      filename: "font.ttf",
      bytes: validTtf,
    }, {
      fileDependencies: { openFile: async () => { throw failure; } },
    })).rejects.toBe(failure);

    await expect(readFile(join(dir, "assets/fonts/inter-400.ttf"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect((await loadProjectFile(path)).fonts).toEqual([]);
  });

  it("binds add rollback to the exact publication ownership", async () => {
    const { dir, path } = await projectFile();
    const ownership = { device: 1n, inode: 2n, revision: "exact-publication" };
    const publishFontFile = vi.fn(async () => ({
      path: join(dir, "assets/fonts/inter-400.ttf"),
      created: true,
      ownership,
    }));
    const removeFontFile = vi.fn(async () => true);

    await expect(addUploadedFont(path, {
      family: "Inter",
      weight: 400,
      filename: "font.ttf",
      bytes: validTtf,
    }, {
      publishFontFile,
      removeFontFile,
      fileDependencies: { openFile: async () => { throw new Error("write failed"); } },
    })).rejects.toThrow("write failed");

    expect(removeFontFile).toHaveBeenCalledWith(
      await realpath(dir),
      "assets/fonts/inter-400.ttf",
      ownership,
    );
  });

  it("restores a quarantined font on rollback and discards it only after commit", async () => {
    const rollbackProject = await projectFile({ fonts: [registeredFont()] });
    const commitProject = await projectFile({ fonts: [registeredFont()] });
    const restore = vi.fn(async () => undefined);
    const discard = vi.fn(async () => undefined);
    const quarantineFontFile = vi.fn(async () => ({
      path: "assets/fonts/inter-400.ttf",
      recoveryPath: ".font-recovery",
      bytes: validTtf,
      ownership: { device: 1n, inode: 2n, revision: "quarantined" },
      restore,
      discard,
    }));

    await expect(removeFont(rollbackProject.path, { family: "Inter", weight: 400 }, {
      quarantineFontFile,
      fileDependencies: { openFile: async () => { throw new Error("write failed"); } },
    })).rejects.toThrow("write failed");
    expect(restore).toHaveBeenCalledOnce();
    expect(discard).not.toHaveBeenCalled();

    await removeFont(commitProject.path, { family: "Inter", weight: 400 }, {
      quarantineFontFile,
    });
    expect(discard).toHaveBeenCalledOnce();
  });

  it("surfaces the recovery path when quarantined-font rollback cannot restore", async () => {
    const { path } = await projectFile({ fonts: [registeredFont()] });
    const recoveryPath = "/tmp/.font-removal-recovery";
    const quarantineFontFile = vi.fn(async () => ({
      path: "assets/fonts/inter-400.ttf",
      recoveryPath,
      bytes: validTtf,
      ownership: { device: 1n, inode: 2n, revision: "quarantined" },
      restore: async () => { throw new Error(`restore blocked; recovery retained at ${recoveryPath}`); },
      discard: async () => undefined,
    }));

    await expect(removeFont(path, { family: "Inter", weight: 400 }, {
      quarantineFontFile,
      fileDependencies: { openFile: async () => { throw new Error("write failed"); } },
    })).rejects.toThrow(recoveryPath);
    expect((await loadProjectFile(path)).fonts).toEqual([registeredFont()]);
  });

  it("surfaces the recovery path when post-commit quarantine discard fails", async () => {
    const { path } = await projectFile({ fonts: [registeredFont()] });
    const recoveryPath = "/tmp/.font-removal-recovery";
    const quarantineFontFile = vi.fn(async () => ({
      path: "assets/fonts/inter-400.ttf",
      recoveryPath,
      bytes: validTtf,
      ownership: { device: 1n, inode: 2n, revision: "quarantined" },
      restore: async () => undefined,
      discard: async () => { throw new Error(`discard blocked; recovery retained at ${recoveryPath}`); },
    }));

    await expect(removeFont(path, { family: "Inter", weight: 400 }, {
      quarantineFontFile,
    })).rejects.toThrow(recoveryPath);
    expect((await loadProjectFile(path)).fonts).toEqual([]);
  });

  it("restores a safely removed resource when the project write fails", async () => {
    const { dir, path } = await projectFile({ fonts: [registeredFont()] });
    await mkdir(join(dir, "assets/fonts"), { recursive: true });
    const target = join(dir, "assets/fonts/inter-400.ttf");
    await writeFile(target, validTtf);
    const failure = new Error("project write failed");

    await expect(removeFont(path, { family: "Inter", weight: 400 }, {
      fileDependencies: { openFile: async () => { throw failure; } },
    })).rejects.toBe(failure);

    expect((await readFile(target)).equals(validTtf)).toBe(true);
    expect((await loadProjectFile(path)).fonts).toEqual([registeredFont()]);
  });
});
