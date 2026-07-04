import type Konva from "konva";
import type { Element } from "../model/schema.js";

/**
 * The single element→Konva-props map (docs/specs/2026-07-04-phase1-slice2-screenshot-asset-parity-design.md
 * §1): both the static export renderer (`renderScreen`) and the interactive editor stage build nodes
 * from this exact output. Pure and synchronous — for `screenshot` it LOOKS UP a preloaded image in
 * `images`, it never loads one, so the sync contract holds for both render paths. Interaction props
 * (draggable, listeners) are the editor's concern and are added by the caller, never here.
 */
export type ImageCache = Map<string, HTMLImageElement>;

export type NodeConfig =
  | { konva: "Text"; config: Konva.TextConfig }
  | { konva: "Rect"; config: Konva.RectConfig }
  | { konva: "Image"; config: Konva.ImageConfig };

export function elementToNodeConfig(element: Element, images?: ImageCache): NodeConfig {
  const common = {
    id: element.id,
    x: element.x,
    y: element.y,
    rotation: element.rotation,
    opacity: element.opacity,
  };

  if (element.type === "text") {
    return {
      konva: "Text",
      config: {
        ...common,
        width: element.width,
        height: element.height,
        text: element.content,
        fontFamily: element.fontFamily,
        fontSize: element.size,
        // Konva folds fontStyle into the canvas font shorthand; a numeric weight string
        // ("600 96px Family") is valid CSS, so this maps custom weights directly.
        fontStyle: String(element.weight),
        lineHeight: element.lineHeight,
        letterSpacing: element.letterSpacing,
        align: element.align,
        fill: element.color,
      },
    };
  }

  if (element.type === "shape") {
    return {
      konva: "Rect",
      config: {
        ...common,
        width: element.width,
        height: element.height,
        fill: element.fill,
        cornerRadius: element.radius,
      },
    };
  }

  // screenshot
  const image = images?.get(element.assetUrl);
  if (!image) {
    // Missing/failed asset → a visible placeholder, never a crash or hang (editor.md §7).
    return {
      konva: "Rect",
      config: {
        ...common,
        width: element.width,
        height: element.height,
        fill: "#CCCCCC",
        cornerRadius: element.cornerRadius,
      },
    };
  }

  if (element.fit === "contain") {
    const scale = Math.min(element.width / image.width, element.height / image.height);
    const drawW = image.width * scale;
    const drawH = image.height * scale;
    return {
      konva: "Image",
      config: {
        ...common,
        x: element.x + (element.width - drawW) / 2,
        y: element.y + (element.height - drawH) / 2,
        width: drawW,
        height: drawH,
        image,
        cornerRadius: element.cornerRadius,
      },
    };
  }

  // cover: fill the box, crop the overflow (Konva object-fit-cover recipe, centred).
  const boxRatio = element.width / element.height;
  const imgRatio = image.width / image.height;
  let cropWidth: number;
  let cropHeight: number;
  if (boxRatio >= imgRatio) {
    cropWidth = image.width;
    cropHeight = image.width / boxRatio;
  } else {
    cropWidth = image.height * boxRatio;
    cropHeight = image.height;
  }
  return {
    konva: "Image",
    config: {
      ...common,
      width: element.width,
      height: element.height,
      image,
      cornerRadius: element.cornerRadius,
      cropX: (image.width - cropWidth) / 2,
      cropY: (image.height - cropHeight) / 2,
      cropWidth,
      cropHeight,
    },
  };
}
