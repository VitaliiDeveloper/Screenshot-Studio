import type Konva from "konva";
import type { Element } from "../model/schema.js";
import { assertNever } from "../model/assert-never.js";
import { DEVICE_FRAME_SPECS } from "../model/device-frames.js";

/**
 * The single element→Konva-props map (docs/specs/2026-07-04-phase1-slice3-device-frame-design.md §1):
 * both the static export renderer (`renderScreen`) and the interactive editor stage build nodes from
 * this exact output. Pure and synchronous — it LOOKS images up in a preloaded `images` cache, it never
 * loads one, so the sync contract holds for both render paths. A `device-frame` returns a `Group` of
 * native shapes + the clipped content image; interaction props (draggable, listeners) are the editor's
 * concern and are added by the caller, never here.
 */
export type ImageCache = Map<string, HTMLImageElement>;

export type NodeConfig =
  | { konva: "Text"; config: Konva.TextConfig }
  | { konva: "Rect"; config: Konva.RectConfig }
  | { konva: "Image"; config: Konva.ImageConfig }
  | { konva: "Group"; config: Konva.GroupConfig; children: NodeConfig[] };

interface Box {
  width: number;
  height: number;
}

interface Fit {
  x: number;
  y: number;
  width: number;
  height: number;
  cropX?: number;
  cropY?: number;
  cropWidth?: number;
  cropHeight?: number;
}

/**
 * object-fit for a decoded image inside a box, RELATIVE to the box's (0,0). Shared by `screenshot`
 * (box = the element) and `device-frame` (box = the screen slot). Pure.
 */
function computeImageFit(image: HTMLImageElement, box: Box, fit: "cover" | "contain"): Fit {
  if (fit === "contain") {
    const scale = Math.min(box.width / image.width, box.height / image.height);
    const drawW = image.width * scale;
    const drawH = image.height * scale;
    return { x: (box.width - drawW) / 2, y: (box.height - drawH) / 2, width: drawW, height: drawH };
  }
  // cover: fill the box, crop the overflow (Konva object-fit-cover recipe, centred).
  const boxRatio = box.width / box.height;
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
    x: 0,
    y: 0,
    width: box.width,
    height: box.height,
    cropX: (image.width - cropWidth) / 2,
    cropY: (image.height - cropHeight) / 2,
    cropWidth,
    cropHeight,
  };
}

export function elementToNodeConfig(element: Element, images?: ImageCache): NodeConfig {
  const common = {
    id: element.id,
    x: element.x,
    y: element.y,
    rotation: element.rotation,
    opacity: element.opacity,
  };

  switch (element.type) {
    case "text":
      return {
        konva: "Text",
        config: {
          ...common,
          width: element.width,
          height: element.height,
          text: element.content,
          fontFamily: element.fontFamily,
          // Konva folds fontStyle into the canvas font shorthand; a numeric weight string
          // ("600 96px Family") is valid CSS, so this maps custom weights directly.
          fontSize: element.size,
          fontStyle: String(element.weight),
          lineHeight: element.lineHeight,
          letterSpacing: element.letterSpacing,
          align: element.align,
          fill: element.color,
        },
      };

    case "shape":
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

    case "screenshot": {
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
      const fit = computeImageFit(image, { width: element.width, height: element.height }, element.fit);
      return {
        konva: "Group",
        config: { ...common, width: element.width, height: element.height },
        children: [
          // Transparent logical box keeps contain-mode letterboxing selectable in the editor.
          // It is visually inert in the shared export renderer.
          {
            konva: "Rect",
            config: {
              x: 0,
              y: 0,
              width: element.width,
              height: element.height,
              fill: "rgba(0,0,0,0)",
              cornerRadius: element.cornerRadius,
            },
          },
          {
            konva: "Image",
            config: {
              x: fit.x,
              y: fit.y,
              width: fit.width,
              height: fit.height,
              image,
              cornerRadius: element.cornerRadius,
              cropX: fit.cropX,
              cropY: fit.cropY,
              cropWidth: fit.cropWidth,
              cropHeight: fit.cropHeight,
            },
          },
        ],
      };
    }

    case "device-frame": {
      // Group of native shapes + content image in BOX-LOCAL coords; body and slot share one spec.
      const spec = DEVICE_FRAME_SPECS[element.deviceType];
      const W = element.width;
      const H = element.height;
      const slotX = spec.slotInset.left * W;
      const slotY = spec.slotInset.top * H;
      const slotW = W - (spec.slotInset.left + spec.slotInset.right) * W;
      const slotH = H - (spec.slotInset.top + spec.slotInset.bottom) * H;
      const slotRadius = spec.slotCornerRadius * slotW;

      const children: NodeConfig[] = [
        {
          konva: "Rect",
          config: {
            x: 0,
            y: 0,
            width: W,
            height: H,
            fill: spec.bezelColor,
            cornerRadius: spec.frameCornerRadius * W,
          },
        },
        {
          konva: "Rect",
          config: {
            x: slotX,
            y: slotY,
            width: slotW,
            height: slotH,
            fill: "#000000",
            cornerRadius: slotRadius,
          },
        },
      ];

      const image = images?.get(element.assetUrl);
      if (image) {
        const fit = computeImageFit(image, { width: slotW, height: slotH }, element.fit);
        children.push({
          konva: "Image",
          config: {
            x: slotX + fit.x,
            y: slotY + fit.y,
            width: fit.width,
            height: fit.height,
            image,
            cornerRadius: slotRadius,
            cropX: fit.cropX,
            cropY: fit.cropY,
            cropWidth: fit.cropWidth,
            cropHeight: fit.cropHeight,
          },
        });
      }

      const notchW = spec.notch.widthFrac * W;
      const notchH = spec.notch.heightFrac * H;
      children.push({
        konva: "Rect",
        config: {
          x: (W - notchW) / 2,
          y: spec.notch.topFrac * H,
          width: notchW,
          height: notchH,
          fill: spec.bezelColor,
          cornerRadius: notchH / 2,
        },
      });

      return { konva: "Group", config: { ...common, width: W, height: H }, children };
    }

    default:
      return assertNever(element);
  }
}
