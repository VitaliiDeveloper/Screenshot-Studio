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
import type { ProjectLockOptions } from "@screenshot-studio/core/storage";
import { updateProjectFile } from "./project-io.js";
import {
  createTemplateScreen,
  listTemplates,
  loadTemplate,
  TemplateNotFoundError,
  TemplateValidationError,
} from "./template-service.js";

const temporaryRoots: string[] = [];

interface DefinitionHandle {
  stat: (options: { bigint: true }) => Promise<BigIntStats>;
  readFile: () => Promise<Buffer>;
  close: () => Promise<void>;
}

type LoadTemplateWithDependencies = (
  projectPath: string,
  id: unknown,
  dependencies: {
    openDefinition?: (path: string, flags: number) => Promise<DefinitionHandle>;
    lstatDefinitionPath?: (path: string, options: { bigint: true }) => Promise<BigIntStats>;
    realpathDefinitionPath?: (path: string) => Promise<string>;
  },
) => ReturnType<typeof loadTemplate>;

const loadTemplateWithDependencies = loadTemplate as unknown as LoadTemplateWithDependencies;

type ListTemplatesWithDependencies = (
  projectPath: string,
  dependencies: Parameters<LoadTemplateWithDependencies>[2],
) => ReturnType<typeof listTemplates>;

const listTemplatesWithDependencies = listTemplates as unknown as ListTemplatesWithDependencies;

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(directory);
  return directory;
}

function controlledLockWait(): {
  options: ProjectLockOptions;
  didWait: Promise<void>;
  release: () => void;
} {
  let markWait!: () => void;
  const didWait = new Promise<void>((resolve) => { markWait = resolve; });
  const waiters: Array<() => void> = [];
  return {
    didWait,
    options: {
      timeoutMs: 500,
      staleAfterMs: 10_000,
      dependencies: {
        sleep: () => {
          markWait();
          return new Promise<void>((resolve) => waiters.push(resolve));
        },
        scheduleHeartbeat: () => () => undefined,
      },
    },
    release: () => { waiters.splice(0).forEach((resolve) => resolve()); },
  };
}

async function fixture() {
  const dir = await temporaryDirectory("template-service-");
  const projectPath = join(dir, "app-store-screenshots.json");
  const template = {
    id: "accent-card", name: "Accent card", platform: "apple", device: "iphone",
    artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#111111" },
    elements: [{ id: "accent", type: "shape", role: "accent", x: 20, y: 20, width: 620, height: 20, rotation: 0, opacity: 1, locked: false, visible: true, kind: "rect", fill: "#38BDF8", radius: 10 }],
  };
  await mkdir(join(dir, "templates"));
  await writeFile(projectPath, JSON.stringify({
    meta: { name: "Templates", schemaVersion: 1 }, mode: "isolated", platforms: ["apple"], locales: ["en"], fonts: [],
    screens: [{ id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en", artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#000000" }, elements: [] }],
  }));
  await writeFile(join(dir, "templates/accent-card.json"), JSON.stringify(template));
  return { dir, projectPath, template };
}

describe("template-service", () => {
  it("lists definitions in stable id order", async () => {
    const { dir, projectPath, template } = await fixture();
    await writeFile(join(dir, "templates/blank.json"), JSON.stringify({ ...template, id: "blank", name: "Blank" }));
    expect((await listTemplates(projectPath)).map((item) => item.id)).toEqual(["accent-card", "blank"]);
  });

  it("rejects mismatched filenames and ids", async () => {
    const { dir, projectPath, template } = await fixture();
    await writeFile(join(dir, "templates/wrong.json"), JSON.stringify({ ...template, id: "other" }));
    await expect(listTemplates(projectPath)).rejects.toBeInstanceOf(TemplateValidationError);
  });

  it("preserves the missing-file errno as the not-found cause", async () => {
    const { dir, projectPath } = await fixture();
    await rm(join(dir, "templates/accent-card.json"));

    const error = await loadTemplate(projectPath, "accent-card").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TemplateNotFoundError);
    expect((error as Error).cause).toMatchObject({ code: "ENOENT" });
  });

  it("preserves the missing-directory errno as the not-found cause", async () => {
    const { dir, projectPath } = await fixture();
    await rm(join(dir, "templates"), { recursive: true });

    const error = await loadTemplate(projectPath, "accent-card").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TemplateNotFoundError);
    expect((error as Error).cause).toMatchObject({ code: "ENOENT" });
    await expect(listTemplates(projectPath)).resolves.toEqual([]);
  });

  it("wraps an ENOENT race between leaf inspection and realpath as not found", async () => {
    const { projectPath } = await fixture();
    let missingError: unknown;

    const error = await loadTemplateWithDependencies(projectPath, "accent-card", {
      realpathDefinitionPath: async (path) => {
        if (path.endsWith("accent-card.json")) await rm(path);
        try {
          return await realpath(path);
        } catch (caught) {
          missingError = caught;
          throw caught;
        }
      },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TemplateNotFoundError);
    expect((error as Error).cause).toBe(missingError);
    expect(missingError).toMatchObject({ code: "ENOENT" });
  });

  it("keeps listed definition reads bound to the original directory identity", async () => {
    const { dir, projectPath, template } = await fixture();
    const templatesPath = join(dir, "templates");
    const heldDirectory = join(dir, "held-templates-list");
    let directoryInspections = 0;

    await expect(listTemplatesWithDependencies(projectPath, {
      lstatDefinitionPath: async (path, options) => {
        if (basename(path) === "templates" && ++directoryInspections === 3) {
          await rename(templatesPath, heldDirectory);
          await mkdir(templatesPath);
          await writeFile(
            join(templatesPath, "accent-card.json"),
            JSON.stringify({ ...template, name: "Replacement" }),
          );
        }
        return lstat(path, options);
      },
    })).rejects.toThrow(/template definitions directory changed while reading/i);
  });

  it("rejects a symlinked definitions directory outside the project root", async () => {
    const { dir, projectPath, template } = await fixture();
    const outside = await temporaryDirectory("template-service-outside-directory-");
    await writeFile(join(outside, "accent-card.json"), JSON.stringify(template));
    await rm(join(dir, "templates"), { recursive: true });
    await symlink(outside, join(dir, "templates"), "dir");

    await expect(listTemplates(projectPath))
      .rejects.toThrow(/template definitions directory.*symbolic link/i);
    await expect(loadTemplate(projectPath, "accent-card"))
      .rejects.toThrow(/template definitions directory.*symbolic link/i);
  });

  it("rejects a definition symlink outside the project root", async () => {
    const { dir, projectPath, template } = await fixture();
    const outside = await temporaryDirectory("template-service-outside-file-");
    const outsideTemplate = join(outside, "accent-card.json");
    await writeFile(outsideTemplate, JSON.stringify(template));
    await rm(join(dir, "templates/accent-card.json"));
    await symlink(outsideTemplate, join(dir, "templates/accent-card.json"));

    await expect(listTemplates(projectPath))
      .rejects.toThrow(/template definition.*symbolic link/i);
    await expect(loadTemplate(projectPath, "accent-card"))
      .rejects.toThrow(/template definition.*symbolic link/i);
  });

  it("does not follow a definition symlink introduced immediately before open", async () => {
    const { projectPath, template } = await fixture();
    const outside = await temporaryDirectory("template-service-open-race-");
    const outsideTemplate = join(outside, "accent-card.json");
    await writeFile(outsideTemplate, JSON.stringify({ ...template, name: "Outside" }));
    let openFlags = 0;

    await expect(loadTemplateWithDependencies(projectPath, "accent-card", {
      openDefinition: async (path, flags) => {
        openFlags = flags;
        await rm(path);
        await symlink(outsideTemplate, path);
        return open(path, flags);
      },
    })).rejects.toThrow(/template definition.*symbolic link/i);

    if (typeof constants.O_NOFOLLOW === "number") {
      expect(openFlags & constants.O_NOFOLLOW).not.toBe(0);
    }
  });

  it("rejects a moved inode reached through a leaf symlink when open ignores flags", async () => {
    const { projectPath } = await fixture();
    const outside = await temporaryDirectory("template-service-ignored-nofollow-");
    const movedTemplate = join(outside, "accent-card.json");
    let readCalled = false;

    await expect(loadTemplateWithDependencies(projectPath, "accent-card", {
      openDefinition: async (path) => {
        await rename(path, movedTemplate);
        await symlink(movedTemplate, path);
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
    })).rejects.toThrow(/template definition.*symbolic link/i);

    expect(readCalled).toBe(false);
  });

  it("rejects a definitions-directory swap before reading an opened file", async () => {
    const { dir, projectPath, template } = await fixture();
    const outside = await temporaryDirectory("template-service-directory-race-");
    await writeFile(
      join(outside, "accent-card.json"),
      JSON.stringify({ ...template, name: "Outside" }),
    );
    const heldDirectory = join(dir, "held-templates");
    let readCalled = false;

    await expect(loadTemplateWithDependencies(projectPath, "accent-card", {
      openDefinition: async (path, flags) => {
        await rename(join(dir, "templates"), heldDirectory);
        await symlink(outside, join(dir, "templates"), "dir");
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
    })).rejects.toThrow(/template definitions directory.*symbolic link/i);

    expect(readCalled).toBe(false);
  });

  it("preserves definition read and close failures", async () => {
    const { projectPath } = await fixture();
    const readError = new Error("template definition stat failed");
    const closeError = new Error("template definition close failed");
    const error = await loadTemplateWithDependencies(projectPath, "accent-card", {
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

  it("creates and persists a screen", async () => {
    const { projectPath } = await fixture();
    const result = await createTemplateScreen(projectPath, "accent-card", "uk");
    expect(result.screen).toMatchObject({ id: "accent-card", locale: "uk" });
    const saved = JSON.parse(await readFile(projectPath, "utf8"));
    expect(saved.screens).toHaveLength(2);
    expect(saved.locales).toEqual(["en", "uk"]);
  });

  it("resolves list, load, and create resources beside a symlinked project target", async () => {
    const { projectPath } = await fixture();
    const aliasDir = await temporaryDirectory("template-service-alias-");
    const aliasPath = join(aliasDir, "project-alias.json");
    await symlink(projectPath, aliasPath);

    expect((await listTemplates(aliasPath)).map((template) => template.id)).toEqual(["accent-card"]);
    await expect(loadTemplate(aliasPath, "accent-card"))
      .resolves.toMatchObject({ name: "Accent card" });
    await createTemplateScreen(aliasPath, "accent-card", "uk");

    const saved = JSON.parse(await readFile(projectPath, "utf8"));
    expect(saved.screens).toHaveLength(2);
    expect(saved.locales).toEqual(["en", "uk"]);
  });

  it("queues create behind the project lease while list remains lock-free", async () => {
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
    await expect(listTemplates(projectPath)).resolves.toHaveLength(1);

    const lockWait = controlledLockWait();
    const create = createTemplateScreen(projectPath, "accent-card", "uk", lockWait.options);
    const createOutcome = create.then(
      (value) => ({ status: "fulfilled" as const, value }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    const queueState = await Promise.race([
      lockWait.didWait.then(() => "waited" as const),
      createOutcome.then(() => "settled" as const),
    ]);

    releaseHeld();
    const heldResult = await heldOutcome;
    lockWait.release();
    const createResult = await createOutcome;

    expect(queueState).toBe("waited");
    expect(heldResult.status).toBe("fulfilled");
    expect(createResult.status).toBe("fulfilled");
    const saved = JSON.parse(await readFile(projectPath, "utf8"));
    expect(saved.meta.name).toBe("Held writer");
    expect(saved.screens).toHaveLength(2);
    expect(saved.locales).toEqual(["en", "uk"]);
  });
});
