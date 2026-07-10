import { describe, it, expect } from "vitest";
import { collectImageUrls } from "./index.js";
import type { Project, Element } from "../model/schema.js";

function project(elements: Element[]): Project {
  return {
    meta: { name: "T", schemaVersion: 2 },
    mode: "isolated",
    platforms: ["apple"], locales: ["en"], fonts: [],
    screens: [{
      id: "s", name: "S", platform: "apple", device: "iphone", locale: "en", direction: "ltr",
      artboard: { width: 660, height: 1434 },
      background: { type: "solid", color: "#000000" },
      elements,
    }],
  };
}

const shot = (id: string, assetUrl: string): Element => ({
  id, type: "screenshot", x: 0, y: 0, width: 10, height: 10,
  rotation: 0, opacity: 1, locked: false, visible: true,
  assetUrl, fit: "cover", cornerRadius: 0,
});

const framed = (id: string, assetUrl: string): Element => ({
  id, type: "device-frame", x: 0, y: 0, width: 10, height: 20,
  rotation: 0, opacity: 1, locked: false, visible: true,
  deviceType: "iphone", assetUrl, fit: "cover",
});

describe("collectImageUrls", () => {
  it("returns every screenshot url, de-duplicated", () => {
    expect(collectImageUrls(project([shot("a", "a.png"), shot("b", "b.png"), shot("c", "a.png")])).sort())
      .toEqual(["a.png", "b.png"]);
  });

  it("includes device-frame content urls and dedups across element types", () => {
    expect(collectImageUrls(project([shot("a", "a.png"), framed("f", "b.png"), framed("g", "a.png")])).sort())
      .toEqual(["a.png", "b.png"]);
  });

  it("returns empty when there are no image-bearing elements", () => {
    expect(collectImageUrls(project([]))).toEqual([]);
  });
});
