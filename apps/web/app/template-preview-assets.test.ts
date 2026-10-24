// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { inspectPng, parseStoreSpecs } from "@screenshot-studio/core/export";
import { listBuiltInTemplatePacks } from "@screenshot-studio/core/templates";
import { templatePreviewPath } from "@web/components/TemplateLibraryDialog";

const appRoot = dirname(fileURLToPath(import.meta.url));
const previewRoot = resolve(appRoot, "../public/template-previews");
const specs = parseStoreSpecs(JSON.parse(readFileSync(resolve(appRoot, "../../../store-specs.json"), "utf8")));

describe("template pack previews", () => {
  // Regenerate with TEMPLATE_PREVIEWS_OUT=1 and e2e/template-pack-parity.test.ts.
  it("ships an opaque 300 px wide preview for every styled pack screen", () => {
    const packs = listBuiltInTemplatePacks(specs).filter((pack) => pack.id !== "neutral-iphone-basics");
    expect(packs.length).toBeGreaterThan(0);
    for (const pack of packs) {
      for (const screen of pack.screens) {
        const path = templatePreviewPath(pack.id, screen.id);
        expect(path, screen.id).not.toBeNull();
        const file = resolve(previewRoot, path!.slice("/template-previews/".length));
        const info = inspectPng(readFileSync(file));
        expect(info.width, file).toBe(300);
        // The canvas truncates height × pixelRatio, computed as the generator passes it; 2880×1800 lands on .5.
        expect(info.height, file).toBe(Math.trunc(screen.artboard.height * (300 / screen.artboard.width)));
        expect(info.hasAlpha, file).toBe(false);
      }
    }
  // Decodes every shipped preview, which outlasts the 5 s default under coverage.
  }, 30_000);
});
