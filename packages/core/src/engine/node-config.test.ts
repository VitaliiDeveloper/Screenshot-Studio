// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { backgroundToNodeConfig, elementToNodeConfig, type ImageCache } from "./node-config.js";
import { ICON_PATHS } from "../model/icons.js";
import type { TextElement, ShapeElement, ScreenshotElement, ImageElement, IconElement, DeviceFrameElement, GroupElement } from "../model/schema.js";

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

describe("backgroundToNodeConfig", () => {
  it("maps solid and translated gradients with local deterministic points", () => {
    expect(backgroundToNodeConfig(
      { type: "solid", color: "#112233" },
      { x: 300, y: 40, width: 200, height: 100 },
    )).toMatchObject({
      konva: "Rect", config: { x: 300, y: 40, width: 200, height: 100, fill: "#112233" },
    });

    const gradient = backgroundToNodeConfig(
      { type: "linear-gradient", from: "#000000", to: "#FFFFFF", angle: 0 },
      { x: 300, y: 40, width: 200, height: 100 },
    );
    expect(gradient).toMatchObject({
      konva: "Rect",
      config: {
        x: 300, y: 40, width: 200, height: 100,
        fillLinearGradientStartPoint: { x: 0, y: 50 },
        fillLinearGradientEndPoint: { x: 200, y: 50 },
        fillLinearGradientColorStops: [0, "#000000", 1, "#FFFFFF"],
      },
    });
  });

  it("maps image contain/cover and preserves an alpha-bearing fallback before preload", () => {
    const image = { width: 400, height: 400 } as unknown as HTMLImageElement;
    const background = {
      type: "image" as const, assetUrl: "background.png", fit: "contain" as const, color: "#12345680",
    };
    const missing = backgroundToNodeConfig(background, { x: 20, y: 30, width: 200, height: 100 });
    expect(missing).toMatchObject({
      konva: "Rect", config: { x: 20, y: 30, width: 200, height: 100, fill: "#12345680" },
    });

    const contain = backgroundToNodeConfig(
      background,
      { x: 20, y: 30, width: 200, height: 100 },
      new Map([["background.png", image]]),
    );
    if (contain.konva !== "Group") throw new Error("expected Group");
    expect(contain.config).toMatchObject({ x: 20, y: 30, width: 200, height: 100 });
    expect(contain.children[0]).toMatchObject({
      konva: "Rect", config: { x: 0, y: 0, width: 200, height: 100, fill: "#12345680" },
    });
    expect(contain.children[1]).toMatchObject({
      konva: "Image", config: { x: 50, y: 0, width: 100, height: 100, image },
    });

    const cover = backgroundToNodeConfig(
      { ...background, fit: "cover" },
      { width: 200, height: 100 },
      new Map([["background.png", image]]),
    );
    if (cover.konva !== "Group") throw new Error("expected Group");
    expect(cover.children[1]).toMatchObject({
      konva: "Image",
      config: { width: 200, height: 100, cropX: 0, cropY: 100, cropWidth: 400, cropHeight: 200 },
    });
  });
});

describe("elementToNodeConfig", () => {
  it("maps a text element to a Konva Text config", () => {
    const result = elementToNodeConfig(baseText);
    expect(result.konva).toBe("Text");
    expect(result.config).toMatchObject({
      id: "t1", x: 10, y: 20, width: 300, height: 100,
      rotation: 5, opacity: 0.8, text: "Hi", fontFamily: "Pacifico",
      fontSize: 96, fontStyle: "600", lineHeight: 1.2,
      letterSpacing: 2, align: "center", direction: "ltr", fill: "#FFFFFF",
    });
  });

  it("maps explicit rtl direction without changing physical alignment", () => {
    const result = elementToNodeConfig({ ...baseText, align: "right" }, { direction: "rtl" });

    expect(result.konva).toBe("Text");
    expect(result.config).toMatchObject({ direction: "rtl", align: "right" });
  });

  it("maps strict text shadow literals to Konva props", () => {
    const result = elementToNodeConfig({
      ...baseText,
      shadow: { color: "#000000", blur: 12, offsetX: 3, offsetY: 6, opacity: 0.4 },
    });
    expect(result.config).toMatchObject({
      shadowColor: "#000000", shadowBlur: 12, shadowOffsetX: 3, shadowOffsetY: 6,
      shadowOpacity: 0.4, shadowEnabled: true,
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

  it("maps ellipse, gradient, and stroke through one logical group", () => {
    const result = elementToNodeConfig({
      ...baseShape,
      kind: "ellipse",
      gradient: { from: "#000000", to: "#FFFFFF", angle: 0 },
      stroke: { color: "#FF00FF", width: 3 },
    });
    if (result.konva !== "Group") throw new Error("expected Group");
    expect(result.config).toMatchObject({ id: "s1", x: 0, y: 0, width: 50, height: 40 });
    expect(result.children[0]).toMatchObject({
      konva: "Ellipse",
      config: {
        x: 25, y: 20, radiusX: 25, radiusY: 20,
        stroke: "#FF00FF", strokeWidth: 3,
        fillLinearGradientStartPoint: { x: 0, y: 20 },
        fillLinearGradientEndPoint: { x: 50, y: 20 },
        fillLinearGradientColorStops: [0, "#000000", 1, "#FFFFFF"],
      },
    });
  });
});

describe("elementToNodeConfig — trusted vector icon", () => {
  const icon: IconElement = {
    id: "icon", type: "icon", x: 20, y: 30, width: 120, height: 240,
    rotation: 10, opacity: 0.75, locked: false, visible: true,
    icon: "heart", color: "#FF3366", strokeWidth: 4,
  };

  it("maps the strict id to a logical box plus a deterministic core Path", () => {
    const result = elementToNodeConfig(icon);
    if (result.konva !== "Group") throw new Error("expected Group");
    expect(result.config).toMatchObject({ id: "icon", x: 20, y: 30, width: 120, height: 240 });
    expect(result.children[0]).toMatchObject({
      konva: "Rect", config: { x: 0, y: 0, width: 120, height: 240, fill: "rgba(0,0,0,0)" },
    });
    expect(result.children[1]).toMatchObject({
      konva: "Path",
      config: {
        data: ICON_PATHS.heart, scaleX: 5, scaleY: 10,
        stroke: "#FF3366", strokeWidth: 4, strokeScaleEnabled: false,
        lineCap: "round", lineJoin: "round",
      },
    });
  });
});

describe("elementToNodeConfig — persisted group", () => {
  const group: GroupElement = {
    id: "group", type: "group", x: 120, y: 80, width: 300, height: 180,
    rotation: 15, opacity: 0.75, locked: false, visible: true,
    children: [
      { ...baseShape, id: "visible", x: 10, y: 20, opacity: 0.5 },
      { ...baseText, id: "hidden", x: 100, y: 80, visible: false },
    ],
  };

  it("maps parent transforms and visible children in local z-order", () => {
    const result = elementToNodeConfig(group);
    if (result.konva !== "Group") throw new Error("expected Group");
    expect(result.config).toMatchObject({
      id: "group", x: 120, y: 80, width: 300, height: 180, rotation: 15, opacity: 0.75,
    });
    expect(result.children).toHaveLength(1);
    expect(result.children[0]).toMatchObject({
      konva: "Rect",
      config: { id: "visible", x: 10, y: 20, opacity: 0.5, fill: "#FF0000" },
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
  it("maps a cover screenshot to a logical Group with crop and cornerRadius", () => {
    const result = elementToNodeConfig(shot, { images: cache });
    expect(result.konva).toBe("Group");
    if (result.konva !== "Group") throw new Error("expected Group");
    expect(result.config).toMatchObject({
      id: "p1", x: 10, y: 20, width: 200, height: 100,
    });
    expect(result.children.map((child) => child.konva)).toEqual(["Rect", "Image"]);
    expect(result.children[0]!.config).toMatchObject({ x: 0, y: 0, width: 200, height: 100, fill: "rgba(0,0,0,0)" });
    // 200×100 box (2:1) over a 400×400 image → keep full width, crop to half height, centred.
    expect(result.children[1]!.config).toMatchObject({
      x: 0, y: 0, width: 200, height: 100, cornerRadius: 12, image: stubImage,
      cropX: 0, cropY: 100, cropWidth: 400, cropHeight: 200,
    });
  });

  it("maps a contain screenshot to a centred fitted box, no crop", () => {
    const result = elementToNodeConfig({ ...shot, fit: "contain" }, { images: cache });
    expect(result.konva).toBe("Group");
    if (result.konva !== "Group") throw new Error("expected Group");
    // 400×400 image in a 200×100 box → scale 0.25 → drawn 100×100, centred horizontally in 200.
    expect(result.children[1]!.config).toMatchObject({ x: 50, y: 0, width: 100, height: 100 });
    expect((result.children[1]!.config as Record<string, unknown>).cropWidth).toBeUndefined();
  });

  it("applies normalized focal point and zoom only to cover", () => {
    const cropped = elementToNodeConfig({
      ...shot,
      crop: { x: 1, y: 0, zoom: 2 },
    }, { images: cache });
    if (cropped.konva !== "Group") throw new Error("expected Group");
    expect(cropped.children[1]!.config).toMatchObject({
      cropX: 200, cropY: 0, cropWidth: 200, cropHeight: 100,
    });

    const contained = elementToNodeConfig({
      ...shot,
      fit: "contain",
      crop: { x: 1, y: 0, zoom: 4 },
    }, { images: cache });
    if (contained.konva !== "Group") throw new Error("expected Group");
    expect(contained.children[1]!.config).toMatchObject({ x: 50, y: 0, width: 100, height: 100 });
    expect((contained.children[1]!.config as Record<string, unknown>).cropWidth).toBeUndefined();
  });

  it("maps a missing image to a grey placeholder rect", () => {
    const result = elementToNodeConfig(shot, { images: new Map() });
    expect(result.konva).toBe("Rect");
    expect(result.config).toMatchObject({ id: "p1", width: 200, height: 100, cornerRadius: 12 });
  });
});

describe("elementToNodeConfig — decorative image", () => {
  const image: ImageElement = {
    ...shot,
    id: "decor",
    type: "image",
    fit: "contain",
  };

  it("uses the shared deterministic contain mapping and preserves alpha-bearing image input", () => {
    const result = elementToNodeConfig(image, { images: cache });
    if (result.konva !== "Group") throw new Error("expected Group");
    expect(result.config).toMatchObject({ id: "decor", x: 10, y: 20, width: 200, height: 100 });
    expect(result.children[1]).toMatchObject({
      konva: "Image",
      config: { x: 50, y: 0, width: 100, height: 100, image: stubImage, cornerRadius: 12 },
    });
  });

  it("uses the screenshot placeholder contract when the asset is unavailable", () => {
    expect(elementToNodeConfig(image, { images: new Map() })).toMatchObject({
      konva: "Rect",
      config: { id: "decor", fill: "#CCCCCC", cornerRadius: 12 },
    });
  });
});

const frame: DeviceFrameElement = {
  id: "df1", type: "device-frame", x: 100, y: 50, width: 1000, height: 1000,
  rotation: 0, opacity: 1, locked: false, visible: true,
  deviceType: "iphone", assetUrl: "hero.png", fit: "cover",
};

// A 400×400 stub — only width/height are read by the mapper.
const frameStub = { width: 400, height: 400 } as unknown as HTMLImageElement;
const frameCache: ImageCache = new Map([["hero.png", frameStub]]);

describe("elementToNodeConfig — device-frame", () => {
  it("maps to a Group carrying the element box, positioned by x/y", () => {
    const result = elementToNodeConfig(frame, { images: frameCache });
    expect(result.konva).toBe("Group");
    expect(result.config).toMatchObject({ id: "df1", x: 100, y: 50, width: 1000, height: 1000 });
  });

  it("maps every trusted preset, with notch only where specified", () => {
    for (const deviceType of ["iphone", "android-phone", "tablet", "desktop", "tv", "watch"] as const) {
      const result = elementToNodeConfig({ ...frame, deviceType }, { images: frameCache });
      if (result.konva !== "Group") throw new Error("expected Group");
      expect(result.children[0]).toMatchObject({ konva: "Rect" });
      expect(result.children[1]).toMatchObject({ konva: "Rect", config: { fill: "#000000" } });
      expect(result.children[2]).toMatchObject({ konva: "Image", config: { image: frameStub } });
      expect(result.children).toHaveLength(deviceType === "iphone" || deviceType === "android-phone" ? 4 : 3);
    }
  });

  it("composits body, slot background, clipped content image, and notch (box-local)", () => {
    const result = elementToNodeConfig(frame, { images: frameCache });
    if (result.konva !== "Group") throw new Error("expected Group");
    expect(result.children.map((c) => c.konva)).toEqual(["Rect", "Rect", "Image", "Rect"]);

    // Frame body: full box, rounded silhouette.
    expect(result.children[0]!.config).toMatchObject({ x: 0, y: 0, width: 1000, height: 1000, cornerRadius: 140 });
    // Slot background: inset 3.5% x / 2.8% y, slot-rounded, opaque black.
    expect(result.children[1]!.config).toMatchObject({ x: 35, y: 28, width: 930, height: 944, cornerRadius: 93, fill: "#000000" });
    // Content image: fills the slot (cover), same slot rounding, the decoded image.
    expect(result.children[2]!.config).toMatchObject({ x: 35, y: 28, width: 930, height: 944, cornerRadius: 93, image: frameStub });
    // Notch: centred pill near the top.
    expect(result.children[3]!.config).toMatchObject({ x: 340, y: 22, width: 320, height: 18 });
  });

  it("drops the content image when the asset is missing (frame + slot bg + notch remain)", () => {
    const result = elementToNodeConfig(frame, { images: new Map() });
    if (result.konva !== "Group") throw new Error("expected Group");
    expect(result.children.map((c) => c.konva)).toEqual(["Rect", "Rect", "Rect"]);
  });
});
