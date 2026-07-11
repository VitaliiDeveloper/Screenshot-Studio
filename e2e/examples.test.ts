// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseProjectJson } from "../packages/core/src/model/index.js";
import { inspectPng } from "../packages/core/src/export/index.js";
import { exportScreenToPng, resolveTarget } from "../packages/cli/src/export.js";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";
import type { Element } from "../packages/core/src/model/index.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const storeSpecsPath = resolve(repoRoot, "store-specs.json");
const examples = [
  {
    name: "connected launch",
    projectPath: resolve(repoRoot, "examples/connected-launch/app-store-screenshots.json"),
    screenId: "hero",
    elementTypes: ["group", "icon", "image"],
  },
  {
    name: "RTL delivery",
    projectPath: resolve(repoRoot, "examples/rtl-delivery/app-store-screenshots.json"),
    screenId: "arabic-rtl",
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
  server = await startWebServer();
}, 180_000);

afterAll(async () => {
  await server?.stop();
});

describe("Phase 7 living examples", () => {
  for (const example of examples) {
    it(`validates and exports ${example.name}`, async () => {
      const source = await readFile(example.projectPath, "utf8");
      expect(JSON.parse(source).meta.schemaVersion).toBe(6);
      const project = parseProjectJson(source);
      const elementTypes = collectElementTypes(project.screens.flatMap(({ elements }) => elements));
      expect([...example.elementTypes].every((type) => elementTypes.has(type))).toBe(true);
      if (example.name === "RTL delivery") {
        expect(project.mode).toBe("connected");
        expect(project.screens.filter(({ locale }) => locale === "en")).toHaveLength(2);
        expect(project.screens.filter(({ locale }) => locale === "ar")).toHaveLength(2);
      }
      const screen = project.screens.find(({ id }) => id === example.screenId)!;
      const target = await resolveTarget(storeSpecsPath, screen.platform, screen.device, "6.9");
      const png = await exportScreenToPng({
        baseUrl: server.url,
        projectPath: example.projectPath,
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
