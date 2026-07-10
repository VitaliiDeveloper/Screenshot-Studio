// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { Project } from "@screenshot-studio/core/model";
import { parseStoreSpecs } from "@screenshot-studio/core/export";
import {
  addScreenToProject,
  formatScreenList,
  removeScreenFromProject,
  reorderScreenInProject,
  resolveScreenAction,
  runScreenCommand,
} from "./screen-commands.js";

const specs = parseStoreSpecs({
  apple: {
    iphone: [{ id: "6.9", label: "6.9", width: 1320, height: 2868, orientation: "portrait" }],
    ipad: [{ id: "13", label: "13", width: 2048, height: 2732, orientation: "portrait" }],
  },
  android: {
    phone: [{ id: "phone-portrait", label: "Phone", width: 1080, height: 1920, orientation: "portrait" }],
  },
});

function sampleProject(): Project {
  return {
    meta: { name: "CLI Project", schemaVersion: 2 },
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
    expect(formatScreenList(sampleProject())).toBe(
      "1 hero apple/iphone en Hero\n2 details apple/iphone en Details",
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
    expect(() => removeScreenFromProject(project, "hero")).toThrow(/last screen/);
  });

  it("moves a screen to a 1-based position", () => {
    const project = reorderScreenInProject(sampleProject(), "details", 1);
    expect(project.screens.map((screen) => screen.id)).toEqual(["details", "hero"]);
  });

  it("runs screen commands against a project file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "screenshot-studio-screen-command-"));
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
});
