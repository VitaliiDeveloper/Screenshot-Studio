import { describe, it, expect } from "vitest";
import { elementToNodeConfig, type ImageCache } from "./node-config.js";
import type { TextElement, ShapeElement, ScreenshotElement } from "../model/schema.js";

const baseText: TextElement = {
  id: "t1", type: "text", x: 10, y: 20, width: 300, height: 100,
  rotation: 5, opacity: 0.8, locked: false, visible: true,
  content: "Hi", fontFamily: "Pacifico", size: 96, weight: 600,
  lineHeight: 1.2, letterSpacing: 2, align: "center", color: "#FFFFFF",
};

const baseShape: ShapeElement = {
  id: "s1", type: "shape", x: 0, y: 0, width: 50, height: 40,
  rotation: 0, opacity: 1, locked: false, visible: true,
  kind: "rect", fill: "#FF0000", radius: 8,
};

describe("elementToNodeConfig", () => {
  it("maps a text element to a Konva Text config", () => {
    const result = elementToNodeConfig(baseText);
    expect(result.konva).toBe("Text");
    expect(result.config).toMatchObject({
      id: "t1", x: 10, y: 20, width: 300, height: 100,
      rotation: 5, opacity: 0.8, text: "Hi", fontFamily: "Pacifico",
      fontSize: 96, fontStyle: "600", lineHeight: 1.2,
      letterSpacing: 2, align: "center", fill: "#FFFFFF",
    });
  });

  it("maps a shape element to a Konva Rect config", () => {
    const result = elementToNodeConfig(baseShape);
    expect(result.konva).toBe("Rect");
    expect(result.config).toMatchObject({
      id: "s1", x: 0, y: 0, width: 50, height: 40,
      rotation: 0, opacity: 1, fill: "#FF0000", cornerRadius: 8,
    });
  });
});

const shot: ScreenshotElement = {
  id: "p1", type: "screenshot", x: 10, y: 20, width: 200, height: 100,
  rotation: 0, opacity: 1, locked: false, visible: true,
  assetUrl: "a.png", fit: "cover", cornerRadius: 12,
};

// A 400×400 stub image — only width/height are read by the mapper.
const stubImage = { width: 400, height: 400 } as unknown as HTMLImageElement;
const cache: ImageCache = new Map([["a.png", stubImage]]);

describe("elementToNodeConfig — screenshot", () => {
  it("maps a cover screenshot to an Image config with crop and cornerRadius", () => {
    const result = elementToNodeConfig(shot, cache);
    expect(result.konva).toBe("Image");
    expect(result.config).toMatchObject({
      id: "p1", x: 10, y: 20, width: 200, height: 100, cornerRadius: 12, image: stubImage,
    });
    // 200×100 box (2:1) over a 400×400 image → keep full width, crop to half height, centred.
    expect(result.config).toMatchObject({ cropX: 0, cropY: 100, cropWidth: 400, cropHeight: 200 });
  });

  it("maps a contain screenshot to a centred fitted box, no crop", () => {
    const result = elementToNodeConfig({ ...shot, fit: "contain" }, cache);
    expect(result.konva).toBe("Image");
    // 400×400 image in a 200×100 box → scale 0.25 → drawn 100×100, centred horizontally in 200.
    expect(result.config).toMatchObject({ x: 60, y: 20, width: 100, height: 100 });
    expect((result.config as Record<string, unknown>).cropWidth).toBeUndefined();
  });

  it("maps a missing image to a grey placeholder rect", () => {
    const result = elementToNodeConfig(shot, new Map());
    expect(result.konva).toBe("Rect");
    expect(result.config).toMatchObject({ id: "p1", width: 200, height: 100, cornerRadius: 12 });
  });
});
