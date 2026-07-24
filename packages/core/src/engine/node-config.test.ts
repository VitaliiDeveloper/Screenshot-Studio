// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { backgroundToNodeConfig, elementToNodeConfig, type ImageCache } from "./node-config.js";
import {
  ICON_PATHS,
  type DeviceFrameElement,
  type GroupElement,
  type IconElement,
  type ImageElement,
  type ScreenshotElement,
  type ShapeElement,
  type TextElement,
} from "@screenshot-studio/core/model";

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
      letterSpacing: 2, align: "center", verticalAlign: "top", direction: "ltr", fill: "#FFFFFF",
    });
  });

  it("maps persisted vertical text alignment through the shared renderer", () => {
    const result = elementToNodeConfig({ ...baseText, verticalAlign: "bottom" });

    expect(result.konva).toBe("Text");
    expect(result.config).toMatchObject({ verticalAlign: "bottom" });
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
    const result = elementToNodeConfig({ ...shot, blur: 12 }, { images: cache });
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
    expect(result.children[1]).toMatchObject({ filter: { kind: "blur", radius: 12 } });
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
    const result = elementToNodeConfig({ ...image, blur: 6 }, { images: cache });
    if (result.konva !== "Group") throw new Error("expected Group");
    expect(result.config).toMatchObject({ id: "decor", x: 10, y: 20, width: 200, height: 100 });
    expect(result.children[1]).toMatchObject({
      konva: "Image",
      config: { x: 50, y: 0, width: 100, height: 100, image: stubImage, cornerRadius: 12 },
      filter: { kind: "blur", radius: 6 },
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

  it("preserves the complete node-config boundary for all eight legacy presets", () => {
    const legacy: Record<string, {
      bezel: string;
      frameRadius: number;
      slot: readonly [number, number, number, number, number];
      notch?: readonly [number, number, number, number];
    }> = {
      iphone: { bezel: "#1A1A1C", frameRadius: 140, slot: [35, 28, 930, 944, 93], notch: [340, 22, 320, 18] },
      "android-phone": { bezel: "#202124", frameRadius: 110, slot: [28, 24, 944, 952, 70.8], notch: [482.5, 12, 35, 16] },
      tablet: { bezel: "#242426", frameRadius: 55, slot: [35, 35, 930, 930, 23.25] },
      desktop: { bezel: "#25262A", frameRadius: 25, slot: [25, 35, 950, 885, 11.4] },
      laptop: { bezel: "#202124", frameRadius: 22, slot: [30, 35, 940, 890, 9.4] },
      browser: { bezel: "#D1D5DB", frameRadius: 25, slot: [12, 80, 976, 902, 7.808] },
      tv: { bezel: "#17181B", frameRadius: 18, slot: [25, 25, 950, 920, 0.008 * 950] },
      watch: { bezel: "#1E1E20", frameRadius: 230, slot: [55, 45, 890, 910, 160.2] },
    };

    for (const [deviceType, expected] of Object.entries(legacy)) {
      const [x, y, width, height, cornerRadius] = expected.slot;
      const boxRatio = width / height;
      const cropWidth = boxRatio >= 1 ? 400 : 400 * boxRatio;
      const cropHeight = boxRatio >= 1 ? 400 / boxRatio : 400;
      const children = [
        {
          konva: "Rect",
          config: { x: 0, y: 0, width: 1000, height: 1000, fill: expected.bezel, cornerRadius: expected.frameRadius },
        },
        {
          konva: "Rect",
          config: { x, y, width, height, fill: "#000000", cornerRadius },
        },
        {
          konva: "Image",
          filter: undefined,
          config: {
            x, y, width, height, image: frameStub, cornerRadius,
            cropX: (400 - cropWidth) / 2,
            cropY: (400 - cropHeight) / 2,
            cropWidth,
            cropHeight,
          },
        },
      ];
      if (expected.notch) {
        const [notchX, notchY, notchWidth, notchHeight] = expected.notch;
        children.push({
          konva: "Rect",
          config: {
            x: notchX, y: notchY, width: notchWidth, height: notchHeight,
            fill: expected.bezel, cornerRadius: notchHeight / 2,
          },
        });
      }

      expect(elementToNodeConfig(
        { ...frame, deviceType: deviceType as DeviceFrameElement["deviceType"] },
        { images: frameCache },
      )).toEqual({
        konva: "Group",
        config: { id: "df1", x: 100, y: 50, rotation: 0, opacity: 1, width: 1000, height: 1000 },
        children,
      });
    }
  });

  it("composits body, slot background, clipped content image, and notch (box-local)", () => {
    const result = elementToNodeConfig({ ...frame, blur: 10 }, { images: frameCache });
    if (result.konva !== "Group") throw new Error("expected Group");
    expect(result.children.map((c) => c.konva)).toEqual(["Rect", "Rect", "Image", "Rect"]);

    // Frame body: full box, rounded silhouette.
    expect(result.children[0]!.config).toMatchObject({ x: 0, y: 0, width: 1000, height: 1000, cornerRadius: 140 });
    // Slot background: inset 3.5% x / 2.8% y, slot-rounded, opaque black.
    expect(result.children[1]!.config).toMatchObject({ x: 35, y: 28, width: 930, height: 944, cornerRadius: 93, fill: "#000000" });
    // Content image: fills the slot (cover), same slot rounding, the decoded image.
    expect(result.children[2]!.config).toMatchObject({ x: 35, y: 28, width: 930, height: 944, cornerRadius: 93, image: frameStub });
    expect(result.children[2]).toMatchObject({ filter: { kind: "blur", radius: 10 } });
    expect(result.children[0]).not.toHaveProperty("filter");
    // Notch: centred pill near the top.
    expect(result.children[3]!.config).toMatchObject({ x: 340, y: 22, width: 320, height: 18 });
  });

  it("shows a drop-target placeholder when the frame asset is missing", () => {
    const result = elementToNodeConfig(frame, { images: new Map() });
    if (result.konva !== "Group") throw new Error("expected Group");
    expect(result.children.map((c) => c.konva)).toEqual(["Rect", "Rect", "Rect", "Rect"]);
    expect(result.children[2]!.config).toMatchObject({ fill: "#374151", stroke: "#9CA3AF" });
  });

  it("renders light and dark modern bezels with the shared outer-silhouette shadow", () => {
    for (const [deviceType, fill] of [
      ["phone-modern-dark", "#151518"],
      ["phone-modern-light", "#E8E8EA"],
    ] as const) {
      const result = elementToNodeConfig(
        { ...frame, deviceType, width: 600, height: 1300 },
        { images: frameCache },
      );
      if (result.konva !== "Group") throw new Error("expected Group");
      expect(result.children[0]).toEqual({
        konva: "Rect",
        config: {
          x: 0, y: 0, width: 600, height: 1300, fill, cornerRadius: 0.14 * 600,
          shadowColor: "#000000", shadowOpacity: 0.24, shadowBlur: 0.035 * 600,
          shadowOffsetX: 0, shadowOffsetY: 23.4, shadowEnabled: true,
        },
      });
    }
  });

  it("paints inset outlines before clipped slot content", () => {
    const result = elementToNodeConfig(
      { ...frame, deviceType: "phone-outline", width: 600, height: 1300 },
      { images: frameCache },
    );
    if (result.konva !== "Group") throw new Error("expected Group");
    expect(result.children.map((child) => child.konva)).toEqual(["Rect", "Rect", "Rect", "Image"]);
    expect(result.children[1]).toEqual({
      konva: "Rect",
      config: {
        x: 4.8, y: 4.8, width: 590.4, height: 1290.4,
        stroke: "#313238", strokeWidth: 4.8,
        cornerRadius: 0.14 * 600 - (0.004 * 600 + 0.008 * 600 / 2),
      },
    });
  });

  it("renders pill and punch-hole cameras in box-local coordinates after content", () => {
    const pill = elementToNodeConfig(
      { ...frame, deviceType: "phone-modern-dark", width: 600, height: 1300 },
      { images: frameCache },
    );
    if (pill.konva !== "Group") throw new Error("expected Group");
    expect(pill.children.at(-1)).toEqual({
      konva: "Rect",
      config: { x: 225, y: 16.9, width: 150, height: 23.4, fill: "#09090B", cornerRadius: 11.7 },
    });

    const punchHole = elementToNodeConfig(
      { ...frame, deviceType: "phone-punch-hole-dark", width: 480, height: 1000 },
      { images: frameCache },
    );
    if (punchHole.konva !== "Group") throw new Error("expected Group");
    expect(punchHole.children.at(-1)).toEqual({
      konva: "Ellipse",
      config: {
        x: 240, y: 18,
        radiusX: 0.018 * 480 / 2,
        radiusY: 0.00864 * 1000 / 2,
        fill: "#08090A",
      },
    });

    const tablet = elementToNodeConfig(
      { ...frame, deviceType: "tablet-rounded-light", width: 750, height: 1000 },
      { images: frameCache },
    );
    if (tablet.konva !== "Group") throw new Error("expected Group");
    expect(tablet.children.at(-1)).toEqual({
      konva: "Ellipse",
      config: { x: 375, y: 14, radiusX: 3, radiusY: 3, fill: "#44464A" },
    });
  });

  it("renders laptop and display bases between the body and content", () => {
    for (const [deviceType, width, height, expected] of [
      ["laptop-silver", 800, 500, { x: 8, y: 482.5, width: 784, height: 17.5, fill: "#B8BDC3", cornerRadius: 8 }],
      ["display-stand", 800, 450, { x: 304, y: 432, width: 192, height: 18, fill: "#292B30", cornerRadius: 8 }],
    ] as const) {
      const result = elementToNodeConfig(
        { ...frame, deviceType, width, height },
        { images: frameCache },
      );
      if (result.konva !== "Group") throw new Error("expected Group");
      expect(result.children[1]).toEqual({ konva: "Rect", config: expected });
      expect(result.children[2]).toMatchObject({ konva: "Rect", config: { fill: "#000000" } });
    }
  });

  it("renders dark browser chrome and controls above slot content", () => {
    const result = elementToNodeConfig(
      { ...frame, deviceType: "browser-dark", width: 800, height: 500 },
      { images: frameCache },
    );
    if (result.konva !== "Group") throw new Error("expected Group");
    expect(result.children.slice(-5)).toEqual([
      {
        konva: "Rect",
        config: {
          x: 0,
          y: 0,
          width: 800,
          height: 34,
          fill: "#25262B",
          cornerRadius: [20, 20, 0, 0],
        },
      },
      { konva: "Ellipse", config: { x: 20, y: 17, radiusX: 4.8, radiusY: 4.8, fill: "#858992" } },
      { konva: "Ellipse", config: { x: 39.2, y: 17, radiusX: 4.8, radiusY: 4.8, fill: "#858992" } },
      { konva: "Ellipse", config: { x: 58.4, y: 17, radiusX: 4.8, radiusY: 4.8, fill: "#858992" } },
      { konva: "Rect", config: { x: 144, y: 9, width: 636, height: 16, fill: "#34363C", cornerRadius: 6.4 } },
    ]);
  });

  it("clips frameless screenshots without painting an opaque bezel", () => {
    const result = elementToNodeConfig(
      { ...frame, deviceType: "frameless-phone", width: 600, height: 1300 },
      { images: frameCache },
    );
    if (result.konva !== "Group") throw new Error("expected Group");
    expect(result.children[0]).toMatchObject({
      konva: "Rect",
      config: {
        x: 0, y: 0, width: 600, height: 1300, fill: "#000000", cornerRadius: 63,
        shadowColor: "#000000", shadowOpacity: 0.24, shadowBlur: 0.035 * 600,
        shadowOffsetX: 0, shadowOffsetY: 23.4, shadowEnabled: true,
      },
    });
    expect(result.children[1]).toMatchObject({
      konva: "Rect", config: { fill: "#00000000", cornerRadius: 63 },
    });
    expect(result.children[2]).toMatchObject({
      konva: "Rect", config: { x: 0, y: 0, width: 600, height: 1300, cornerRadius: 63 },
    });
    expect(result.children[3]).toMatchObject({
      konva: "Image", config: { x: 0, y: 0, width: 600, height: 1300, cornerRadius: 63 },
    });
  });

  it("keeps semantic missing-screen placeholders deterministic and clipped by the slot", () => {
    const result = elementToNodeConfig(
      {
        ...frame,
        deviceType: "tablet-rounded-light",
        assetUrl: undefined,
        width: 750,
        height: 1000,
      },
      { images: new Map() },
    );
    if (result.konva !== "Group") throw new Error("expected Group");
    expect(result.children[1]).toEqual({
      konva: "Rect",
      config: { x: 21, y: 28, width: 708, height: 944, fill: "#000000", cornerRadius: 17.7 },
    });
    expect(result.children[2]).toEqual({
      konva: "Rect",
      config: {
        x: 77.64, y: 28 + 944 * 0.42, width: 594.72, height: 151.04,
        fill: "#374151", stroke: "#9CA3AF", strokeWidth: 3,
        dash: [11.25, 7.5], cornerRadius: 17.7,
      },
    });
  });

  it("keeps the XR viewport outline-free with deterministic landscape clipping", () => {
    const result = elementToNodeConfig(
      { ...frame, deviceType: "xr-viewport", width: 1600, height: 900 },
      { images: frameCache },
    );
    if (result.konva !== "Group") throw new Error("expected Group");
    expect(result.children).toHaveLength(4);
    expect(result.children.every((child) => !("stroke" in child.config))).toBe(true);
    expect(result.children[2]).toMatchObject({
      konva: "Rect",
      config: { x: 0, y: 0, width: 1600, height: 900, cornerRadius: 128 },
    });
    expect(result.children[3]).toMatchObject({
      konva: "Image",
      config: { x: 0, y: 0, width: 1600, height: 900, cornerRadius: 128 },
    });
  });

  it("maps every added initial-set recipe through the shared device-frame composition", () => {
    const addedPresetIds = [
      "tablet-rounded-dark", "tablet-outline", "frameless-tablet", "browser-light",
      "browser-minimal", "frameless-browser", "laptop-dark", "display-minimal", "tv-flat",
      "watch-rounded", "frameless-watch",
    ] as const;

    for (const deviceType of addedPresetIds) {
      const result = elementToNodeConfig(
        { ...frame, deviceType, width: 600, height: 600 },
        { images: frameCache },
      );
      expect(result.konva, deviceType).toBe("Group");
      if (result.konva !== "Group") continue;
      expect(result.children.length, deviceType).toBeGreaterThanOrEqual(3);
      expect(result.children.every((child) => Object.values(child.config)
        .filter((value) => typeof value === "number")
        .every(Number.isFinite)), deviceType).toBe(true);
    }
  });

  it("renders the Wear insertion preset as square content without bezel or shadow", () => {
    const result = elementToNodeConfig(
      { ...frame, deviceType: "frameless-watch", width: 300, height: 300 },
      { images: frameCache },
    );
    if (result.konva !== "Group") throw new Error("expected Group");

    expect(result.children).toHaveLength(3);
    expect(result.children[0]).toEqual({
      konva: "Rect",
      config: {
        x: 0, y: 0, width: 300, height: 300, fill: "#00000000", cornerRadius: 0,
      },
    });
    expect(result.children[0]!.config).not.toHaveProperty("shadowEnabled");
    expect(result.children[1]).toMatchObject({
      konva: "Rect",
      config: { x: 0, y: 0, width: 300, height: 300, cornerRadius: 0 },
    });
    expect(result.children[2]).toMatchObject({
      konva: "Image",
      config: { x: 0, y: 0, width: 300, height: 300, cornerRadius: 0 },
    });
  });
});
