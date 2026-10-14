// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { Project } from "@screenshot-studio/core/model";
import { DEFAULT_STORE_SPECS } from "@screenshot-studio/core/export";
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

const specs = structuredClone(DEFAULT_STORE_SPECS);
specs.platforms.apple.families.iphone.targets = [
  { id: "6.9", label: "6.9", width: 1320, height: 2868, orientation: "portrait" },
  { id: "6.5", label: "6.5", width: 1284, height: 2778, orientation: "portrait" },
];
specs.platforms.apple.families.ipad.targets = [
  { id: "13", label: "13", width: 2048, height: 2732, orientation: "portrait" },
];
specs.platforms.android.families.phone.targets = [
  { id: "phone-portrait", label: "Phone", width: 1080, height: 1920, orientation: "portrait" },
];

function sampleProject(): Project {
  return {
    meta: { name: "CLI Project", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [
      {
        id: "default",
        name: "Default",
        mode: "connected",
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
    const screens = source.layouts[0]!.screens;
    screens.push({
      ...structuredClone(screens[0]!),
      id: "hero-65",
      variantOf: "hero",
      storeTargetId: "6.5",
    });
    expect(formatScreenList(source, "default")).toBe(
      "1 hero apple/iphone en Hero\n2 details apple/iphone en Details\n"
      + "3 hero-65 apple/iphone en Hero target=6.5 variant-of=hero",
    );
  });

  it("identifies an independent exact-size screen without claiming it is paired", () => {
    const source = sampleProject();
    source.layouts[0]!.screens.push({
      ...structuredClone(source.layouts[0]!.screens[0]!),
      id: "standalone-65",
      storeTargetId: "6.5",
    });

    expect(formatScreenList(source, "default")).toContain(
      "3 standalone-65 apple/iphone en Hero target=6.5",
    );
    expect(formatScreenList(source, "default")).not.toContain("standalone-65 apple/iphone en Hero target=6.5 variant-of=");
  });

  it("adds a lead-size screen to the selected layout", () => {
    const project = addScreenToProject(sampleProject(), "default", specs, {
      id: "ipad-hero",
      name: "iPad Hero",
      platform: "apple",
      device: "ipad",
      locale: "uk",
    });

    expect(project.layouts[0]!.screens.at(-1)).toMatchObject({
      id: "ipad-hero",
      name: "iPad Hero",
      platform: "apple",
      device: "ipad",
      locale: "uk",
      artboard: { width: 2048, height: 2732 },
      background: { type: "solid", color: "#FFFFFF" },
      elements: [],
    });
  });

  it("rejects a non-lead target for a new root screen", () => {
    expect(() => addScreenToProject(sampleProject(), "default", specs, {
      name: "Invalid root target",
      platform: "apple",
      device: "iphone",
      locale: "en",
      sizeId: "6.5",
    })).toThrow(/non-lead.*variant/i);
  });

  it("reports an unknown target before applying the non-lead root policy", () => {
    expect(() => addScreenToProject(sampleProject(), "default", specs, {
      name: "Unknown target",
      platform: "apple",
      device: "iphone",
      locale: "en",
      sizeId: "typo",
    })).toThrow(/Unknown size "typo".*Known: 6\.9, 6\.5/);
  });

  it("derives a unique id from the name when id is omitted", () => {
    const project = addScreenToProject(sampleProject(), "default", specs, {
      name: "Hero",
      platform: "android",
      device: "phone",
      locale: "en",
    });

    expect(project.layouts[0]!.screens.at(-1)?.id).toBe("hero-2");
  });

  it("passes an explicit direction when a lower-level screen starts a locale", () => {
    const project = addScreenToProject(sampleProject(), "default", specs, {
      name: "Arabic Hero",
      platform: "apple",
      device: "iphone",
      locale: "ar",
      direction: "rtl",
    });

    expect(project.layouts[0]!.screens.at(-1)).toMatchObject({ locale: "ar", direction: "rtl" });
  });

  it("removes a screen and refuses to remove the last one", () => {
    const project = removeScreenFromProject(sampleProject(), "default", "details");
    expect(project.layouts[0]!.screens.map((screen) => screen.id)).toEqual(["hero"]);
    expect(() => removeScreenFromProject(project, "default", "hero")).toThrow(/last root screen.*en/);
  });

  it("moves a screen to a 1-based position", () => {
    const project = reorderScreenInProject(sampleProject(), "default", "details", 1);
    expect(project.layouts[0]!.screens.map((screen) => screen.id)).toEqual(["details", "hero"]);
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
    expect(written.layouts[0]!.screens.map((screen) => screen.id)).toEqual(["android-hero", "hero"]);
  });

  it("preserves independent exact screens by default and supports an explicit cascade", async () => {
    const dir = await temporaryDirectory("screenshot-studio-screen-cascade-");
    const projectPath = join(dir, "app-store-screenshots.json");
    const specsPath = join(dir, "store-specs.json");
    const project = sampleProject();
    const screens = project.layouts[0]!.screens;
    screens.push({
      ...structuredClone(screens[1]!),
      id: "details-65",
      variantOf: "details",
      storeTargetId: "6.5",
      artboard: { width: 1284, height: 2778 },
    });
    const exact = `${JSON.stringify(project, null, 2)}\n`;
    await writeFile(projectPath, exact, "utf8");
    await writeFile(specsPath, `${JSON.stringify(specs, null, 2)}\n`, "utf8");

    await runScreenCommand(projectPath, specsPath, ["rm", "details"], {});
    let written = JSON.parse(await readFile(projectPath, "utf8")) as Project;
    expect(written.layouts[0]!.screens.map((screen) => screen.id)).toEqual(["hero", "details-65"]);
    expect(written.layouts[0]!.screens[1]!.variantOf).toBeUndefined();

    await writeFile(projectPath, exact, "utf8");
    await runScreenCommand(projectPath, specsPath, ["rm", "details"], { cascade: "true" });
    written = JSON.parse(await readFile(projectPath, "utf8")) as Project;
    expect(written.layouts[0]!.screens.map((screen) => screen.id)).toEqual(["hero"]);
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

    const addOptions = {
      platform: "android",
      device: "phone",
      locale: "en",
      name: "Queued screen",
    } as const;
    await expect(runScreenCommand(
      projectPath,
      specsPath,
      ["add"],
      addOptions,
      { timeoutMs: 0 },
    )).rejects.toThrow(/Timed out.*project mutation lock/i);

    releaseHeld();
    const heldResult = await heldOutcome;
    const commandResult = await runScreenCommand(
      projectPath,
      specsPath,
      ["add"],
      addOptions,
      { timeoutMs: 0 },
    );

    expect(heldResult.status).toBe("fulfilled");
    expect(commandResult).toContain("queued-screen android/phone en Queued screen");
    const written = JSON.parse(await readFile(projectPath, "utf8")) as Project;
    expect(written.meta.name).toBe("Held writer");
    expect(written.layouts[0]!.screens.some((screen) => screen.name === "Queued screen")).toBe(true);
  });
});
