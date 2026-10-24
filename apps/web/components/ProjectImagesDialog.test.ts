// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectImagesDialog, withImportedAsset } from "./ProjectImagesDialog";

const source = readFileSync(new URL("./ProjectImagesDialog.tsx", import.meta.url), "utf8");

describe("ProjectImagesDialog", () => {
  it("opens as a target-free library with search, import, and a disabled insert action", () => {
    const markup = renderToStaticMarkup(createElement(ProjectImagesDialog, {
      cacheAsset: async () => null,
      onClose: () => {},
    }));

    expect(markup).toContain('aria-label="Project images"');
    expect(markup).toContain('aria-label="Search project images"');
    expect(markup).toContain('accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"');
    expect(markup).toContain("Import image…");
    expect(markup).toContain("Scanning project images…");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*?Insert as image<\/button>/);
  });

  it("imports through the conditional, revision-advancing asset route", () => {
    expect(source).toMatch(/projectJsonRequest<[^>]+>\("\/api\/assets", \{\s+method: "POST",\s+conditional: true,\s+advanceRevision: true,/);
    expect(source).not.toContain("MediaAssetTarget");
  });

  it("adds an imported image to the sorted list without duplicating its path", () => {
    const logo = { path: "assets/logo.png", name: "logo.png", source: "assets" } as const;
    const hero = { path: "assets/hero.png", name: "hero.png", source: "assets" } as const;
    const shot = { path: "screenshots/home.png", name: "home.png", source: "screenshots" } as const;

    expect(withImportedAsset([shot, logo], hero).map(({ path }) => path)).toEqual([
      "assets/hero.png",
      "assets/logo.png",
      "screenshots/home.png",
    ]);
    expect(withImportedAsset([hero, logo], logo)).toHaveLength(2);
  });
});
