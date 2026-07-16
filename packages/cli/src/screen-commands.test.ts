// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { Project } from "@screenshot-studio/core/model";
import { parseStoreSpecs } from "@screenshot-studio/core/export";
import { updateProjectFile } from "./project-io.js";
import {
  addScreenToProject,
  formatScreenList,
  removeScreenFromProject,
  reorderScreenInProject,
  resolveScreenAction,
  runScreenCommand,
} from "./screen-commands.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(directory);
  return directory;
}

const specs = parseStoreSpecs({
  apple: {
    iphone: [
      { id: "6.9", label: "6.9", width: 1320, height: 2868, orientation: "portrait" },
      { id: "6.5", label: "6.5", width: 1284, height: 2778, orientation: "portrait" },
    ],
    ipad: [{ id: "13", label: "13", width: 2048, height: 2732, orientation: "portrait" }],
  },
  android: {
    phone: [{ id: "phone-portrait", label: "Phone", width: 1080, height: 1920, orientation: "portrait" }],
  },
});

function sampleProject(): Project {
  return {
    meta: { name: "CLI Project", schemaVersion: 1 },
    mode: "connected",
    platforms: ["apple"],
    locales: ["en"],
    fonts: [],
    screens: [
      {
        id: "hero",
        name: "Hero",
        platform: "apple",
        device: "iphone",
        locale: "en",
        direction: "ltr",
        artboard: { width: 1320, height: 2868 },
        background: { type: "solid", color: "#101827" },
        elements: [],
      },
      {
        id: "details",
        name: "Details",
        platform: "apple",
        device: "iphone",
        locale: "en",
        direction: "ltr",
        artboard: { width: 1320, height: 2868 },
        background: { type: "solid", color: "#101827" },
        elements: [],
      },
    ],
  };
}

describe("screen commands", () => {
  it("resolves screen subcommands from args and flags", () => {
    expect(resolveScreenAction(["list"], {})).toEqual({ kind: "list" });
    expect(resolveScreenAction(["rm", "hero"], {})).toEqual({ kind: "rm", id: "hero" });
    expect(resolveScreenAction(["rm", "hero"], { cascade: "true" })).toEqual({
      kind: "rm", id: "hero", cascadeVariants: true,
    });
    expect(resolveScreenAction(["reorder", "hero"], { to: "2" })).toEqual({
      kind: "reorder",
      id: "hero",
      to: 2,
    });
    expect(resolveScreenAction(["add"], { platform: "apple", device: "iphone", locale: "en" })).toEqual({
      kind: "add",
      options: { platform: "apple", device: "iphone", locale: "en" },
    });
    expect(resolveScreenAction(["add"], {
      platform: "apple",
      device: "iphone",
      locale: "ar",
      direction: "rtl",
    })).toEqual({
      kind: "add",
      options: { platform: "apple", device: "iphone", locale: "ar", direction: "rtl" },
    });
  });

  it("rejects malformed screen subcommands", () => {
    expect(() => resolveScreenAction([], {})).toThrow(/Usage: screenshots screen/);
    expect(() => resolveScreenAction(["rm"], {})).toThrow(/screen rm <id>/);
    expect(() => resolveScreenAction(["reorder", "hero"], {})).toThrow(/--to/);
    expect(() => resolveScreenAction(["add"], { platform: "apple", device: "iphone" })).toThrow(/--locale/);
    expect(() => resolveScreenAction(["add"], {
      platform: "apple", device: "iphone", locale: "ar", direction: "auto",
    })).toThrow(/ltr or rtl/);
  });

  it("formats screens in export order", () => {
    const source = sampleProject();
    source.screens.push({
      ...structuredClone(source.screens[0]!),
      id: "hero-65",
      variantOf: "hero",
      storeTargetId: "6.5",
    });
    expect(formatScreenList(source)).toBe(
      "1 hero apple/iphone en Hero\n2 details apple/iphone en Details\n"
      + "3 hero-65 apple/iphone en Hero target=6.5 variant-of=hero",
    );
  });

  it("adds a lead-size screen and recomputes manifests", () => {
    const project = addScreenToProject(sampleProject(), specs, {
      id: "ipad-hero",
      name: "iPad Hero",
      platform: "apple",
      device: "ipad",
      locale: "uk",
    });

    expect(project.platforms).toEqual(["apple"]);
    expect(project.locales).toEqual(["en", "uk"]);
    expect(project.screens.at(-1)).toMatchObject({
      id: "ipad-hero",
      name: "iPad Hero",
      platform: "apple",
      device: "ipad",
      locale: "uk",
      artboard: { width: 2048, height: 2732 },
      background: { type: "solid", color: "#101827" },
      elements: [],
    });
  });

  it("rejects a non-lead target for a new root screen", () => {
    expect(() => addScreenToProject(sampleProject(), specs, {
      name: "Invalid root target",
      platform: "apple",
      device: "iphone",
      locale: "en",
      sizeId: "6.5",
    })).toThrow(/non-lead.*variant/i);
  });

  it("reports an unknown target before applying the non-lead root policy", () => {
    expect(() => addScreenToProject(sampleProject(), specs, {
      name: "Unknown target",
      platform: "apple",
      device: "iphone",
      locale: "en",
      sizeId: "typo",
    })).toThrow(/Unknown size "typo".*Known: 6\.9, 6\.5/);
  });

  it("derives a unique id from the name when id is omitted", () => {
    const project = addScreenToProject(sampleProject(), specs, {
      name: "Hero",
      platform: "android",
      device: "phone",
      locale: "en",
    });

    expect(project.platforms).toEqual(["apple", "android"]);
    expect(project.screens.at(-1)?.id).toBe("hero-2");
  });

  it("passes an explicit direction when a lower-level screen starts a locale", () => {
    const project = addScreenToProject(sampleProject(), specs, {
      name: "Arabic Hero",
      platform: "apple",
      device: "iphone",
      locale: "ar",
      direction: "rtl",
    });

    expect(project.screens.at(-1)).toMatchObject({ locale: "ar", direction: "rtl" });
  });

  it("removes a screen and refuses to remove the last one", () => {
    const project = removeScreenFromProject(sampleProject(), "details");
    expect(project.screens.map((screen) => screen.id)).toEqual(["hero"]);
    expect(() => removeScreenFromProject(project, "hero")).toThrow(/last root screen.*en/);
  });

  it("moves a screen to a 1-based position", () => {
    const project = reorderScreenInProject(sampleProject(), "details", 1);
    expect(project.screens.map((screen) => screen.id)).toEqual(["details", "hero"]);
  });

  it("runs screen commands against a project file", async () => {
    const dir = await temporaryDirectory("screenshot-studio-screen-command-");
    const projectPath = join(dir, "app-store-screenshots.json");
    const specsPath = join(dir, "store-specs.json");
    await writeFile(projectPath, `${JSON.stringify(sampleProject(), null, 2)}\n`, "utf8");
    await writeFile(specsPath, `${JSON.stringify(specs, null, 2)}\n`, "utf8");

    const listBefore = await runScreenCommand(projectPath, specsPath, ["list"], {});
    expect(listBefore).toContain("1 hero apple/iphone en Hero");

    await runScreenCommand(projectPath, specsPath, ["add"], {
      platform: "android",
      device: "phone",
      locale: "en",
      name: "Android Hero",
    });
    await runScreenCommand(projectPath, specsPath, ["reorder", "android-hero"], { to: "1" });
    await runScreenCommand(projectPath, specsPath, ["rm", "details"], {});

    const written = JSON.parse(await readFile(projectPath, "utf8")) as Project;
    expect(written.platforms).toEqual(["android", "apple"]);
    expect(written.screens.map((screen) => screen.id)).toEqual(["android-hero", "hero"]);
  });

  it("requires cascade acknowledgement and atomically removes a root with its variants", async () => {
    const dir = await temporaryDirectory("screenshot-studio-screen-cascade-");
    const projectPath = join(dir, "app-store-screenshots.json");
    const specsPath = join(dir, "store-specs.json");
    const project = sampleProject();
    project.screens.push({
      ...structuredClone(project.screens[1]!),
      id: "details-65",
      variantOf: "details",
      storeTargetId: "6.5",
      artboard: { width: 1284, height: 2778 },
    });
    const exact = `${JSON.stringify(project, null, 2)}\n`;
    await writeFile(projectPath, exact, "utf8");
    await writeFile(specsPath, `${JSON.stringify(specs, null, 2)}\n`, "utf8");

    await expect(runScreenCommand(projectPath, specsPath, ["rm", "details"], {}))
      .rejects.toThrow(/has 1 store target variant.*cascade/i);
    expect(await readFile(projectPath, "utf8")).toBe(exact);

    await runScreenCommand(projectPath, specsPath, ["rm", "details"], { cascade: "true" });
    const written = JSON.parse(await readFile(projectPath, "utf8")) as Project;
    expect(written.screens.map((screen) => screen.id)).toEqual(["hero"]);
  });

  it("queues mutation behind the project lease while list remains lock-free", async () => {
    const dir = await temporaryDirectory("screenshot-studio-screen-coordination-");
    const projectPath = join(dir, "app-store-screenshots.json");
    const specsPath = join(dir, "store-specs.json");
    await writeFile(projectPath, `${JSON.stringify(sampleProject(), null, 2)}\n`, "utf8");
    await writeFile(specsPath, `${JSON.stringify(specs, null, 2)}\n`, "utf8");
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
    await expect(runScreenCommand(projectPath, specsPath, ["list"], {}))
      .resolves.toContain("1 hero apple/iphone en Hero");

    const command = runScreenCommand(projectPath, specsPath, ["add"], {
      platform: "android",
      device: "phone",
      locale: "en",
      name: "Queued screen",
    });
    const commandOutcome = command.then(
      (value) => ({ status: "fulfilled" as const, value }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    const queueState = await Promise.race([
      commandOutcome.then(() => "settled" as const),
      new Promise<"waited">((resolve) => setTimeout(() => resolve("waited"), 100)),
    ]);

    releaseHeld();
    const heldResult = await heldOutcome;
    const commandResult = await commandOutcome;

    expect(queueState).toBe("waited");
    expect(heldResult.status).toBe("fulfilled");
    expect(commandResult.status).toBe("fulfilled");
    const written = JSON.parse(await readFile(projectPath, "utf8")) as Project;
    expect(written.meta.name).toBe("Held writer");
    expect(written.screens.some((screen) => screen.name === "Queued screen")).toBe(true);
  });
});
