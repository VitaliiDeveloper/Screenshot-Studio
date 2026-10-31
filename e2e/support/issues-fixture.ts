// SPDX-License-Identifier: Apache-2.0
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createImageElement, createTextElement } from "@screenshot-studio/core/model";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** `check --render` asserts these ids; the editor Issues test asserts the summary built from their counts. */
export const ISSUES_FIXTURE_IDS = {
  blockers: ["missing-locale-screen:de:details", "missing-image:details:lost"],
  warnings: ["text-overflow:hero:clipped", "text-overflow:hero-de:de-title", "text-overflow:hero-de-69:de-title-69"],
};

// Three explicit lines of 100 px text at line height 1.2 need exactly 360 px. A 240 px box drops
// the third line; Fit text must land on 66 (3 × 79.2 = 237.6) because 67 needs 241.2 px.
function stackedText(id: string, y: number, height: number) {
  return { ...createTextElement({ x: 100, y }), id, content: "A\nB\nC", size: 100, width: 1000, height };
}

function screen(id: string, name: string, locale: string, elements: unknown[] = []) {
  return {
    id,
    name,
    platform: "apple",
    device: "iphone",
    locale,
    direction: "ltr",
    artboard: { width: 1206, height: 2622 },
    background: { type: "solid", color: "#ffffff" },
    elements,
  };
}

// The 6.9" size of the de Hero slot. The slot lives in a later locale so the first locale has no
// 6.9" row for the missing-locale check to compare against.
function variant(id: string, root: string, elements: unknown[]) {
  return { ...screen(id, "Hero", "de", elements), artboard: { width: 1320, height: 2868 }, variantOf: root, storeTargetId: "6.9" };
}

/** Writes the Issues fixture project into `directory` and returns its project path. */
export function writeIssuesFixture(directory: string): string {
  const projectPath = join(directory, "app-store-screenshots.json");
  mkdirSync(join(directory, "assets"));
  cpSync(resolve(repoRoot, "fixtures/sample/assets/demo-logistics-app.png"), join(directory, "assets", "replacement.png"));
  writeFileSync(projectPath, JSON.stringify({
    meta: { name: "Issues", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [{
      id: "default",
      name: "Default",
      mode: "isolated",
      screens: [
        screen("hero", "Hero", "en", [stackedText("clipped", 100, 240), stackedText("exact", 600, 360)]),
        screen("details", "Details", "en", [{ ...createImageElement({ assetUrl: "assets/lost.png" }), id: "lost" }]),
        screen("hero-de", "Hero", "de", [stackedText("de-title", 100, 240)]),
        variant("hero-de-69", "hero-de", [stackedText("de-title-69", 100, 240)]),
      ],
    }],
  }, null, 2));
  return projectPath;
}
