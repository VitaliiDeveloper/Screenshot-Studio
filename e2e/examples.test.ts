// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseProjectJson, SCHEMA_VERSION, elementLeaves } from "@screenshot-studio/core/model";
import { inspectPng } from "@screenshot-studio/core/export";
import { readProjectSnapshot } from "@screenshot-studio/core/storage";
import { exportScreenToPng, resolveTarget } from "@screenshot-studio/cli/export";
import { startWebServer, type RunningServer } from "@screenshot-studio/cli/server";
import type { Element } from "@screenshot-studio/core/model";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const storeSpecsPath = resolve(repoRoot, "store-specs.json");
const examples = [
  {
    name: "connected launch",
    projectPath: resolve(repoRoot, "examples/connected-launch/app-store-screenshots.json"),
    screenId: "frame-gallery-web",
    targetId: "desktop-1920",
    elementTypes: ["group", "icon", "image"],
  },
  {
    name: "RTL delivery",
    projectPath: resolve(repoRoot, "examples/rtl-delivery/app-store-screenshots.json"),
    screenId: "arabic-rtl",
    targetId: "6.9",
    elementTypes: ["group", "icon"],
  },
] as const;

function collectElementTypes(elements: Element[]): Set<Element["type"]> {
  const types = new Set<Element["type"]>();
  for (const element of elements) {
    types.add(element.type);
    if (element.type === "group") {
      for (const type of collectElementTypes(element.children)) types.add(type);
    }
  }
  return types;
}

let server: RunningServer;

beforeAll(async () => {
  server = await startWebServer(undefined, { storeSpecsPath: resolve(repoRoot, "store-specs.json") });
}, 180_000);

afterAll(async () => {
  await server?.stop();
});

describe("living examples", () => {
  for (const example of examples) {
    it(`validates and exports ${example.name}`, async () => {
      const source = await readFile(example.projectPath, "utf8");
      expect(JSON.parse(source).meta.schemaVersion).toBe(SCHEMA_VERSION);
      const project = parseProjectJson(source);
      const elementTypes = collectElementTypes(project.layouts[0].screens.flatMap(({ elements }) => elements));
      expect([...example.elementTypes].every((type) => elementTypes.has(type))).toBe(true);
      const leaves = project.layouts[0].screens.flatMap(({ elements }) => elements.flatMap(elementLeaves));
      expect(project.layouts[0].screens.some(({ background }) => background.type === "linear-gradient")).toBe(true);
      expect(leaves.some((leaf) => leaf.type === "text" && leaf.shadow)).toBe(true);
      expect(leaves.some((leaf) => leaf.type === "shape" && leaf.kind === "ellipse" && leaf.gradient)).toBe(true);
      if (example.name === "connected launch") {
        expect(new Set(project.layouts[0].screens.map(({ platform }) => platform))).toEqual(
          new Set(["apple", "android", "web"]),
        );
        expect(project.layouts[0].screens.some(({ background }) => background.type === "image")).toBe(true);
        expect(leaves.some((leaf) => (leaf.type === "image" || leaf.type === "screenshot") && leaf.crop)).toBe(true);
        const framePresetIds = new Set(leaves
          .filter((leaf) => leaf.type === "device-frame")
          .map(({ deviceType }) => deviceType));
        const requiredFramePresetIds = [
          "iphone",
          "phone-modern-dark",
          "phone-punch-hole-dark",
          "browser",
          "browser-dark",
          "laptop-silver",
        ] as const;
        expect(requiredFramePresetIds.every((presetId) => framePresetIds.has(presetId))).toBe(true);
      }
      if (example.name === "RTL delivery") {
        expect(project.layouts[0]!.mode).toBe("connected");
        expect(project.layouts[0].screens.filter(({ locale }) => locale === "en")).toHaveLength(2);
        expect(project.layouts[0].screens.filter(({ locale }) => locale === "ar")).toHaveLength(2);
      }
      const screen = project.layouts[0].screens.find(({ id }) => id === example.screenId)!;
      const target = await resolveTarget(
        storeSpecsPath,
        screen.platform,
        screen.device,
        example.targetId,
      );
      const png = await exportScreenToPng({
        baseUrl: server.url,
        projectPath: example.projectPath,
        projectRevision: (await readProjectSnapshot(example.projectPath)).revision,
        layoutId: project.layouts[0]!.id,
        screenId: example.screenId,
        target,
      });

      expect(inspectPng(png)).toEqual({
        width: target.width,
        height: target.height,
        hasAlpha: false,
      });
    }, 180_000);
  }
});
