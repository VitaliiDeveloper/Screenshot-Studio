// SPDX-License-Identifier: Apache-2.0
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Project } from "@screenshot-studio/core/model";
import { loadProjectFile, writeProjectFile } from "./project-io.js";
import {
  formatLocaleList,
  resolveLocaleAction,
  runLocaleCommand,
} from "./locale-commands.js";

function project(): Project {
  return {
    meta: { name: "Locales", schemaVersion: 3 },
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
        artboard: { width: 1000, height: 2000 },
        background: { type: "solid", color: "#101827" },
        elements: [{
          id: "headline",
          type: "text",
          x: 100,
          y: 80,
          width: 400,
          height: 160,
          rotation: 0,
          opacity: 1,
          locked: false,
          visible: true,
          content: "Ship fast",
          fontFamily: "Inter",
          size: 72,
          weight: 700,
          lineHeight: 1.2,
          letterSpacing: 0,
          align: "left",
          color: "#FFFFFF",
        }],
      },
      {
        id: "details",
        name: "Details",
        platform: "apple",
        device: "iphone",
        locale: "en",
        direction: "ltr",
        artboard: { width: 1000, height: 2000 },
        background: { type: "solid", color: "#101827" },
        elements: [],
      },
    ],
  };
}

describe("locale command parsing", () => {
  it("resolves list, add, direction, and rm actions", () => {
    expect(resolveLocaleAction(["list"], {})).toEqual({ kind: "list" });
    expect(resolveLocaleAction(["add", "ar"], { from: "en", direction: "rtl" })).toEqual({
      kind: "add",
      source: "en",
      target: "ar",
      direction: "rtl",
    });
    expect(resolveLocaleAction(["direction", "ar"], { to: "ltr" })).toEqual({
      kind: "direction",
      locale: "ar",
      direction: "ltr",
    });
    expect(resolveLocaleAction(["rm", "ar"], {})).toEqual({ kind: "rm", locale: "ar" });
  });

  it("rejects incomplete commands and invalid directions", () => {
    expect(() => resolveLocaleAction(["add"], { from: "en" })).toThrow(/locale add <target>/);
    expect(() => resolveLocaleAction(["add", "ar"], {})).toThrow(/--from/);
    expect(() => resolveLocaleAction(["add", "ar"], { from: "en", direction: "auto" }))
      .toThrow(/ltr or rtl/);
    expect(() => resolveLocaleAction(["direction", "ar"], {})).toThrow(/--to/);
    expect(() => resolveLocaleAction(["rm"], {})).toThrow(/locale rm <locale>/);
    expect(() => resolveLocaleAction([], {})).toThrow(/locale <list\|add\|direction\|rm>/);
  });
});

describe("locale command workflow", () => {
  it("formats locale direction and screen count in manifest order", () => {
    expect(formatLocaleList(project())).toBe("en ltr 2 screens");
  });

  it("adds, converts, and removes persisted locale sets through core", async () => {
    const dir = await mkdtemp(join(tmpdir(), "screenshot-studio-locales-"));
    const projectPath = join(dir, "app-store-screenshots.json");
    await writeProjectFile(projectPath, project());

    await runLocaleCommand(projectPath, ["add", "ar"], {
      from: "en",
      direction: "rtl",
    });
    const rtl = await loadProjectFile(projectPath);
    const arabic = rtl.screens.filter((screen) => screen.locale === "ar");

    expect(rtl.locales).toEqual(["en", "ar"]);
    expect(arabic).toHaveLength(2);
    expect(arabic.map((screen) => screen.id)).not.toEqual(["hero", "details"]);
    expect(arabic.every((screen) => screen.direction === "rtl")).toBe(true);
    expect(arabic[0]!.elements[0]).toMatchObject({ x: 500, align: "right" });

    await runLocaleCommand(projectPath, ["direction", "ar"], { to: "ltr" });
    const ltr = await loadProjectFile(projectPath);
    expect(ltr.screens.find((screen) => screen.locale === "ar")!.elements[0])
      .toMatchObject({ x: 100, align: "left" });

    await runLocaleCommand(projectPath, ["rm", "en"], {});
    const remaining = await loadProjectFile(projectPath);
    expect(remaining.locales).toEqual(["ar"]);
    expect(remaining.screens.every((screen) => screen.locale === "ar")).toBe(true);
  });

  it("defaults a cloned locale to the source direction and protects the last locale", async () => {
    const dir = await mkdtemp(join(tmpdir(), "screenshot-studio-locales-default-"));
    const projectPath = join(dir, "app-store-screenshots.json");
    await writeProjectFile(projectPath, project());

    await runLocaleCommand(projectPath, ["add", "uk"], { from: "en" });
    expect((await loadProjectFile(projectPath)).screens
      .filter((screen) => screen.locale === "uk")
      .every((screen) => screen.direction === "ltr")).toBe(true);

    await runLocaleCommand(projectPath, ["rm", "uk"], {});
    await expect(runLocaleCommand(projectPath, ["rm", "en"], {})).rejects.toThrow(/last locale/);
  });
});
