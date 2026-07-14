// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Project } from "@screenshot-studio/core/model";

const fixturePath = resolve("fixtures/sample/app-store-screenshots.json");

describe("demo project layout", () => {
  it("keeps headlines clear of their supporting-copy layers", () => {
    const project = JSON.parse(readFileSync(fixturePath, "utf8")) as Project;
    const pairs = [
      ["headline", "hero-support"],
      ["save-fast-headline", "save-fast-support"],
      ["organized-headline", "organized-support"],
    ] as const;
    const elements = project.screens.flatMap((screen) => screen.elements);

    for (const [headlineId, supportId] of pairs) {
      const headline = elements.find((element) => element.id === headlineId)!;
      const support = elements.find((element) => element.id === supportId)!;
      expect(headline.y + headline.height).toBeLessThan(support.y);
    }
  });
});
