// SPDX-License-Identifier: Apache-2.0
import { constants, type BigIntStats } from "node:fs";
import {
  lstat,
  mkdtemp,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { updateProjectFile } from "./project-io.js";
import {
  applyThemeFile,
  listThemes,
  loadTheme,
  ThemeNotFoundError,
  ThemeValidationError,
} from "./theme-service.js";

const temporaryRoots: string[] = [];

interface DefinitionHandle {
  stat: (options: { bigint: true }) => Promise<BigIntStats>;
  readFile: () => Promise<Buffer>;
  close: () => Promise<void>;
}

type LoadThemeWithDependencies = (
  projectPath: string,
  id: unknown,
  dependencies: {
    openDefinition?: (path: string, flags: number) => Promise<DefinitionHandle>;
    lstatDefinitionPath?: (path: string, options: { bigint: true }) => Promise<BigIntStats>;
    realpathDefinitionPath?: (path: string) => Promise<string>;
  },
) => ReturnType<typeof loadTheme>;

const loadThemeWithDependencies = loadTheme as unknown as LoadThemeWithDependencies;

type ListThemesWithDependencies = (
  projectPath: string,
  dependencies: Parameters<LoadThemeWithDependencies>[2],
) => ReturnType<typeof listThemes>;

const listThemesWithDependencies = listThemes as unknown as ListThemesWithDependencies;

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(directory);
  return directory;
}

async function fixture() {
  const dir = await temporaryDirectory("theme-service-");
  const projectPath = join(dir, "app-store-screenshots.json");
  const project = {
    meta: { name: "Themes", schemaVersion: 1 }, mode: "isolated", platforms: ["apple"], locales: ["en"], fonts: [],
    screens: [{ id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en", artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#111111" }, elements: [{ id: "accent", type: "shape", role: "accent", x: 0, y: 0, width: 100, height: 10, rotation: 0, opacity: 1, locked: false, visible: true, kind: "rect", fill: "#FFFFFF", radius: 0 }] }],
  };
  const theme = { id: "midnight", name: "Midnight", colors: { heading: "#F8FAFC", body: "#CBD5E1", accent: "#38BDF8", surface: "#0F172A" }, fonts: {} };
  await mkdir(join(dir, "themes"));
  await writeFile(projectPath, JSON.stringify(project));
  await writeFile(join(dir, "themes/midnight.json"), JSON.stringify(theme));
  return { dir, projectPath, theme };
}

describe("theme-service", () => {
  it("lists definitions in stable id order", async () => {
    const { dir, projectPath, theme } = await fixture();
    await writeFile(join(dir, "themes/amber.json"), JSON.stringify({ ...theme, id: "amber", name: "Amber" }));
    expect((await listThemes(projectPath)).map((item) => item.id)).toEqual(["amber", "midnight"]);
  });

  it("rejects mismatched filenames and ids", async () => {
    const { dir, projectPath, theme } = await fixture();
    await writeFile(join(dir, "themes/wrong.json"), JSON.stringify({ ...theme, id: "other" }));
    await expect(listThemes(projectPath)).rejects.toBeInstanceOf(ThemeValidationError);
  });

  it("preserves the missing-file errno as the not-found cause", async () => {
    const { dir, projectPath } = await fixture();
    await rm(join(dir, "themes/midnight.json"));

    const error = await loadTheme(projectPath, "midnight").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ThemeNotFoundError);
    expect((error as Error).cause).toMatchObject({ code: "ENOENT" });
  });

  it("preserves the missing-directory errno as the not-found cause", async () => {
    const { dir, projectPath } = await fixture();
    await rm(join(dir, "themes"), { recursive: true });

    const error = await loadTheme(projectPath, "midnight").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ThemeNotFoundError);
    expect((error as Error).cause).toMatchObject({ code: "ENOENT" });
    await expect(listThemes(projectPath)).resolves.toEqual([]);
  });

  it("wraps an ENOENT race between leaf inspection and realpath as not found", async () => {
    const { projectPath } = await fixture();
    let missingError: unknown;

    const error = await loadThemeWithDependencies(projectPath, "midnight", {
      realpathDefinitionPath: async (path) => {
        if (path.endsWith("midnight.json")) await rm(path);
        try {
          return await realpath(path);
        } catch (caught) {
          missingError = caught;
          throw caught;
        }
      },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ThemeNotFoundError);
    expect((error as Error).cause).toBe(missingError);
    expect(missingError).toMatchObject({ code: "ENOENT" });
  });

  it("keeps listed definition reads bound to the original directory identity", async () => {
    const { dir, projectPath, theme } = await fixture();
    const themesPath = join(dir, "themes");
    const heldDirectory = join(dir, "held-themes-list");
    let directoryInspections = 0;

    await expect(listThemesWithDependencies(projectPath, {
      lstatDefinitionPath: async (path, options) => {
        if (basename(path) === "themes" && ++directoryInspections === 3) {
          await rename(themesPath, heldDirectory);
          await mkdir(themesPath);
          await writeFile(
            join(themesPath, "midnight.json"),
            JSON.stringify({ ...theme, name: "Replacement" }),
          );
        }
        return lstat(path, options);
      },
    })).rejects.toThrow(/theme definitions directory changed while reading/i);
  });

  it("rejects a symlinked definitions directory outside the project root", async () => {
    const { dir, projectPath, theme } = await fixture();
    const outside = await temporaryDirectory("theme-service-outside-directory-");
    await writeFile(join(outside, "midnight.json"), JSON.stringify(theme));
    await rm(join(dir, "themes"), { recursive: true });
    await symlink(outside, join(dir, "themes"), "dir");

    await expect(listThemes(projectPath))
      .rejects.toThrow(/theme definitions directory.*symbolic link/i);
    await expect(loadTheme(projectPath, "midnight"))
      .rejects.toThrow(/theme definitions directory.*symbolic link/i);
  });

  it("rejects a definition symlink outside the project root", async () => {
    const { dir, projectPath, theme } = await fixture();
    const outside = await temporaryDirectory("theme-service-outside-file-");
    const outsideTheme = join(outside, "midnight.json");
    await writeFile(outsideTheme, JSON.stringify(theme));
    await rm(join(dir, "themes/midnight.json"));
    await symlink(outsideTheme, join(dir, "themes/midnight.json"));

    await expect(listThemes(projectPath))
      .rejects.toThrow(/theme definition.*symbolic link/i);
    await expect(loadTheme(projectPath, "midnight"))
      .rejects.toThrow(/theme definition.*symbolic link/i);
  });

  it("does not follow a definition symlink introduced immediately before open", async () => {
    const { projectPath, theme } = await fixture();
    const outside = await temporaryDirectory("theme-service-open-race-");
    const outsideTheme = join(outside, "midnight.json");
    await writeFile(outsideTheme, JSON.stringify({ ...theme, name: "Outside" }));
    let openFlags = 0;

    await expect(loadThemeWithDependencies(projectPath, "midnight", {
      openDefinition: async (path, flags) => {
        openFlags = flags;
        await rm(path);
        await symlink(outsideTheme, path);
        return open(path, flags);
      },
    })).rejects.toThrow(/theme definition.*symbolic link/i);

    if (typeof constants.O_NOFOLLOW === "number") {
      expect(openFlags & constants.O_NOFOLLOW).not.toBe(0);
    }
  });

  it("rejects a moved inode reached through a leaf symlink when open ignores flags", async () => {
    const { projectPath } = await fixture();
    const outside = await temporaryDirectory("theme-service-ignored-nofollow-");
    const movedTheme = join(outside, "midnight.json");
    let readCalled = false;

    await expect(loadThemeWithDependencies(projectPath, "midnight", {
      openDefinition: async (path) => {
        await rename(path, movedTheme);
        await symlink(movedTheme, path);
        const handle = await open(path, constants.O_RDONLY);
        return {
          stat: (options) => handle.stat(options),
          readFile: async () => {
            readCalled = true;
            return handle.readFile();
          },
          close: () => handle.close(),
        };
      },
    })).rejects.toThrow(/theme definition.*symbolic link/i);

    expect(readCalled).toBe(false);
  });

  it("rejects a definitions-directory swap before reading an opened file", async () => {
    const { dir, projectPath, theme } = await fixture();
    const outside = await temporaryDirectory("theme-service-directory-race-");
    await writeFile(join(outside, "midnight.json"), JSON.stringify({ ...theme, name: "Outside" }));
    const heldDirectory = join(dir, "held-themes");
    let readCalled = false;

    await expect(loadThemeWithDependencies(projectPath, "midnight", {
      openDefinition: async (path, flags) => {
        await rename(join(dir, "themes"), heldDirectory);
        await symlink(outside, join(dir, "themes"), "dir");
        const handle = await open(path, flags);
        return {
          stat: (options) => handle.stat(options),
          readFile: async () => {
            readCalled = true;
            return handle.readFile();
          },
          close: () => handle.close(),
        };
      },
    })).rejects.toThrow(/theme definitions directory.*symbolic link/i);

    expect(readCalled).toBe(false);
  });

  it("preserves definition read and close failures", async () => {
    const { projectPath } = await fixture();
    const readError = new Error("theme definition stat failed");
    const closeError = new Error("theme definition close failed");
    const error = await loadThemeWithDependencies(projectPath, "midnight", {
      openDefinition: async () => ({
        stat: async () => { throw readError; },
        readFile: async () => Buffer.from("unused"),
        close: async () => { throw closeError; },
      }),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([readError, closeError]);
    expect((error as Error).message).toMatch(/stat failed.*close failed/i);
  });

  it("loads and applies a theme through the shared service", async () => {
    const { projectPath } = await fixture();
    expect((await loadTheme(projectPath, "midnight")).name).toBe("Midnight");
    await applyThemeFile(projectPath, "midnight");
    const saved = JSON.parse(await readFile(projectPath, "utf8"));
    expect(saved.screens[0].elements[0].fill).toBe("#38BDF8");
  });

  it("resolves list, load, and apply resources beside a symlinked project target", async () => {
    const { projectPath } = await fixture();
    const aliasDir = await temporaryDirectory("theme-service-alias-");
    const aliasPath = join(aliasDir, "project-alias.json");
    await symlink(projectPath, aliasPath);

    expect((await listThemes(aliasPath)).map((theme) => theme.id)).toEqual(["midnight"]);
    await expect(loadTheme(aliasPath, "midnight")).resolves.toMatchObject({ name: "Midnight" });
    await applyThemeFile(aliasPath, "midnight");

    const saved = JSON.parse(await readFile(projectPath, "utf8"));
    expect(saved.screens[0].elements[0].fill).toBe("#38BDF8");
  });

  it("queues apply behind the project lease while list remains lock-free", async () => {
    const { projectPath } = await fixture();
    let releaseHeld!: () => void;
    const heldMayFinish = new Promise<void>((resolve) => { releaseHeld = resolve; });
    let heldEntered!: () => void;
    const heldDidEnter = new Promise<void>((resolve) => { heldEntered = resolve; });

    const held = updateProjectFile(projectPath, async (project) => {
      heldEntered();
      await heldMayFinish;
      return {
        project: { ...project, meta: { ...project.meta, name: "Held writer" } },
        value: undefined,
      };
    });
    const heldOutcome = held.then(
      () => ({ status: "fulfilled" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    await heldDidEnter;
    await expect(listThemes(projectPath)).resolves.toHaveLength(1);

    const apply = applyThemeFile(projectPath, "midnight");
    const applyOutcome = apply.then(
      (value) => ({ status: "fulfilled" as const, value }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    const queueState = await Promise.race([
      applyOutcome.then(() => "settled" as const),
      new Promise<"waited">((resolve) => setTimeout(() => resolve("waited"), 100)),
    ]);

    releaseHeld();
    const heldResult = await heldOutcome;
    const applyResult = await applyOutcome;

    expect(queueState).toBe("waited");
    expect(heldResult.status).toBe("fulfilled");
    expect(applyResult.status).toBe("fulfilled");
    const saved = JSON.parse(await readFile(projectPath, "utf8"));
    expect(saved.meta.name).toBe("Held writer");
    expect(saved.screens[0].elements[0].fill).toBe("#38BDF8");
  });
});
