import { describe, it, expect } from "vitest";
import { collectScreenshotUrls } from "./index.js";
import type { Project } from "../model/schema.js";

function project(urls: string[]): Project {
  return {
    meta: { name: "T", schemaVersion: 1 },
    platforms: ["apple"], locales: ["en"], fonts: [],
    screens: [{
      id: "s", name: "S", platform: "apple", device: "iphone", locale: "en",
      artboard: { width: 660, height: 1434 },
      background: { type: "solid", color: "#000000" },
      elements: urls.map((assetUrl, i) => ({
        id: `img${i}`, type: "screenshot", x: 0, y: 0, width: 10, height: 10,
        rotation: 0, opacity: 1, locked: false, visible: true,
        assetUrl, fit: "cover", cornerRadius: 0,
      })),
    }],
  };
}

describe("collectScreenshotUrls", () => {
  it("returns every screenshot url, de-duplicated", () => {
    expect(collectScreenshotUrls(project(["a.png", "b.png", "a.png"])).sort()).toEqual(["a.png", "b.png"]);
  });

  it("returns empty when there are no screenshots", () => {
    expect(collectScreenshotUrls(project([]))).toEqual([]);
  });
});
