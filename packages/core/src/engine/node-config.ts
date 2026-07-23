// SPDX-License-Identifier: Apache-2.0
import type Konva from "konva";
import {
  assertNever,
  deviceFramePreset,
  ICON_PATHS,
  type Background,
  type Element,
  type LayoutDirection,
  type LinearGradientPaint,
  type MediaCrop,
} from "@screenshot-studio/core/model";

/**
 * The single element→Konva-props map: both the static export renderer (`renderScreen`) and the
 * interactive editor stage build nodes from this exact output. Pure and synchronous — it LOOKS
 * images up in a preloaded `images` cache, it never loads one, so the sync contract holds for both
 * render paths. A `device-frame` returns a `Group` of native shapes + the clipped content image;
 * interaction props (draggable, listeners) are the editor's concern and are added by the caller,
 * never here.
 */
export type ImageCache = Map<string, HTMLImageElement>;

export interface ElementRenderContext {
  images?: ImageCache;
  direction?: LayoutDirection;
}

export type NodeFilter = { kind: "blur"; radius: number };

export type NodeConfig =
  | { konva: "Text"; config: Konva.TextConfig }
  | { konva: "Rect"; config: Konva.RectConfig }
  | { konva: "Image"; config: Konva.ImageConfig; filter?: NodeFilter }
  | { konva: "Ellipse"; config: Konva.EllipseConfig }
  | { konva: "Path"; config: Konva.PathConfig }
  | { konva: "Group"; config: Konva.GroupConfig; children: NodeConfig[] };

interface Box {
  width: number;
  height: number;
}

interface PositionedBox extends Box {
  x?: number;
  y?: number;
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

function mediaFilter(blur: number | undefined): NodeFilter | undefined {
  return blur && blur > 0 ? { kind: "blur", radius: blur } : undefined;
}

function gradientConfig(gradient: LinearGradientPaint, box: Box) {
  const radians = gradient.angle * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const halfProjection = (Math.abs(box.width * cos) + Math.abs(box.height * sin)) / 2;
  const centerX = box.width / 2;
  const centerY = box.height / 2;
  return {
    fillLinearGradientStartPoint: {
      x: centerX - cos * halfProjection,
      y: centerY - sin * halfProjection,
    },
    fillLinearGradientEndPoint: {
      x: centerX + cos * halfProjection,
      y: centerY + sin * halfProjection,
    },
    fillLinearGradientColorStops: [0, gradient.from, 1, gradient.to],
  };
}

/**
 * object-fit for a decoded image inside a box, RELATIVE to the box's (0,0). Shared by `screenshot`
 * (box = the element) and `device-frame` (box = the screen slot). Pure.
 */
function computeImageFit(
  image: HTMLImageElement,
  box: Box,
  fit: "cover" | "contain",
  crop?: MediaCrop,
): Fit {
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
  const zoom = crop?.zoom ?? 1;
  cropWidth /= zoom;
  cropHeight /= zoom;
  const focalX = (crop?.x ?? 0.5) * image.width;
  const focalY = (crop?.y ?? 0.5) * image.height;
  const cropX = Math.min(image.width - cropWidth, Math.max(0, focalX - cropWidth / 2));
  const cropY = Math.min(image.height - cropHeight, Math.max(0, focalY - cropHeight / 2));
  return {
    x: 0,
    y: 0,
    width: box.width,
    height: box.height,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
  };
}

/** Shared artboard-background mapping for the interactive and static renderers. */
export function backgroundToNodeConfig(
  background: Background,
  box: PositionedBox,
  images?: ImageCache,
): NodeConfig {
  const x = box.x ?? 0;
  const y = box.y ?? 0;
  switch (background.type) {
    case "solid":
      return {
        konva: "Rect",
        config: { x, y, width: box.width, height: box.height, fill: background.color },
      };
    case "linear-gradient": {
      return {
        konva: "Rect",
        config: {
          x,
          y,
          width: box.width,
          height: box.height,
          ...gradientConfig(background, box),
        },
      };
    }
    case "image": {
      const image = images?.get(background.assetUrl);
      const base: NodeConfig = {
        konva: "Rect",
        config: { x: 0, y: 0, width: box.width, height: box.height, fill: background.color },
      };
      if (!image) {
        return {
          konva: "Rect",
          config: { x, y, width: box.width, height: box.height, fill: background.color },
        };
      }
      const fit = computeImageFit(image, box, background.fit);
      return {
        konva: "Group",
        config: { x, y, width: box.width, height: box.height },
        children: [
          base,
          {
            konva: "Image",
            config: {
              x: fit.x,
              y: fit.y,
              width: fit.width,
              height: fit.height,
              image,
              cropX: fit.cropX,
              cropY: fit.cropY,
              cropWidth: fit.cropWidth,
              cropHeight: fit.cropHeight,
            },
          },
        ],
      };
    }
    default:
      return assertNever(background);
  }
}

export function elementToNodeConfig(
  element: Element,
  context: ElementRenderContext = {},
): NodeConfig {
  const { images, direction = "ltr" } = context;
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
          verticalAlign: element.verticalAlign ?? "top",
          direction,
          fill: element.color,
          ...(element.shadow ? {
            shadowColor: element.shadow.color,
            shadowBlur: element.shadow.blur,
            shadowOffsetX: element.shadow.offsetX,
            shadowOffsetY: element.shadow.offsetY,
            shadowOpacity: element.shadow.opacity,
            shadowEnabled: true,
          } : {}),
        },
      };

    case "shape": {
      const paint = {
        fill: element.gradient ? undefined : element.fill,
        ...(element.gradient ? gradientConfig(element.gradient, element) : {}),
        stroke: element.stroke?.color,
        strokeWidth: element.stroke?.width,
      };
      if (element.kind === "ellipse") {
        return {
          konva: "Group",
          config: { ...common, width: element.width, height: element.height },
          children: [{
            konva: "Ellipse",
            config: {
              x: element.width / 2,
              y: element.height / 2,
              radiusX: element.width / 2,
              radiusY: element.height / 2,
              ...paint,
            },
          }],
        };
      }
      return {
        konva: "Rect",
        config: {
          ...common,
          width: element.width,
          height: element.height,
          cornerRadius: element.radius,
          ...paint,
        },
      };
    }

    case "icon":
      return {
        konva: "Group",
        config: { ...common, width: element.width, height: element.height },
        children: [
          {
            konva: "Rect",
            config: { x: 0, y: 0, width: element.width, height: element.height, fill: "rgba(0,0,0,0)" },
          },
          {
            konva: "Path",
            config: {
              x: 0,
              y: 0,
              data: ICON_PATHS[element.icon],
              scaleX: element.width / 24,
              scaleY: element.height / 24,
              stroke: element.color,
              strokeWidth: element.strokeWidth,
              strokeScaleEnabled: false,
              lineCap: "round",
              lineJoin: "round",
            },
          },
        ],
      };

    case "screenshot":
    case "image": {
      const image = images?.get(element.assetUrl);
      if (!image) {
        // Missing/failed asset → a visible placeholder, never a crash or hang (docs/editor.md).
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
      const fit = computeImageFit(
        image,
        { width: element.width, height: element.height },
        element.fit,
        element.crop,
      );
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
            filter: mediaFilter(element.blur),
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
      const recipe = deviceFramePreset(element.deviceType).recipe;
      const spec = recipe.spec;
      const W = element.width;
      const H = element.height;
      const slotX = spec.slotInset.left * W;
      const slotY = spec.slotInset.top * H;
      const slotW = W - (spec.slotInset.left + spec.slotInset.right) * W;
      const slotH = H - (spec.slotInset.top + spec.slotInset.bottom) * H;
      const slotRadius = spec.slotCornerRadius * slotW;

      const shadowConfig = recipe.shadow ? {
        shadowColor: recipe.shadow.color,
        shadowOpacity: recipe.shadow.opacity,
        shadowBlur: recipe.shadow.blurFrac * W,
        shadowOffsetX: recipe.shadow.offsetXFrac * W,
        shadowOffsetY: recipe.shadow.offsetYFrac * H,
        shadowEnabled: true,
      } : {};
      const needsShadowBacking = spec.bezelColor === "#00000000" && recipe.shadow !== undefined;

      const children: NodeConfig[] = [];
      if (needsShadowBacking) {
        // A transparent silhouette cannot cast a canvas shadow. The opaque backing is fully covered
        // by the zero-inset clipped slot, so frameless recipes gain only the requested outer shadow.
        children.push({
          konva: "Rect",
          config: {
            x: 0,
            y: 0,
            width: W,
            height: H,
            fill: "#000000",
            cornerRadius: spec.frameCornerRadius * W,
            ...shadowConfig,
          },
        });
      }
      children.push({
        konva: "Rect",
        config: {
          x: 0,
          y: 0,
          width: W,
          height: H,
          fill: spec.bezelColor,
          cornerRadius: spec.frameCornerRadius * W,
          ...(!needsShadowBacking ? shadowConfig : {}),
        },
      });

      if (recipe.base) {
        const baseW = recipe.base.widthFrac * W;
        const baseH = recipe.base.heightFrac * H;
        children.push({
          konva: "Rect",
          config: {
            x: (W - baseW) / 2,
            y: H - recipe.base.bottomFrac * H - baseH,
            width: baseW,
            height: baseH,
            fill: recipe.base.color,
            cornerRadius: recipe.base.cornerRadiusFrac * W,
          },
        });
      }

      if (recipe.outline) {
        const strokeWidth = recipe.outline.widthFrac * W;
        const centerInset = recipe.outline.insetFrac * W + strokeWidth / 2;
        children.push({
          konva: "Rect",
          config: {
            x: centerInset,
            y: centerInset,
            width: W - centerInset * 2,
            height: H - centerInset * 2,
            stroke: recipe.outline.color,
            strokeWidth,
            cornerRadius: Math.max(0, spec.frameCornerRadius * W - centerInset),
          },
        });
      }

      children.push(
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
      );

      const image = element.assetUrl ? images?.get(element.assetUrl) : undefined;
      if (image) {
        const fit = computeImageFit(image, { width: slotW, height: slotH }, element.fit);
        children.push({
          konva: "Image",
          filter: mediaFilter(element.blur),
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
      } else {
        children.push({
          konva: "Rect",
          config: {
            x: slotX + slotW * 0.08,
            y: slotY + slotH * 0.42,
            width: slotW * 0.84,
            height: slotH * 0.16,
            fill: "#374151",
            stroke: "#9CA3AF",
            strokeWidth: Math.max(2, Math.min(W, H) * 0.004),
            dash: [Math.max(6, W * 0.015), Math.max(4, W * 0.01)],
            cornerRadius: Math.min(slotW, slotH) * 0.025,
          },
        });
      }

      if (spec.notch) {
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
      }

      if (recipe.camera) {
        const cameraW = recipe.camera.widthFrac * W;
        const cameraH = recipe.camera.heightFrac * H;
        if (recipe.camera.kind === "circle") {
          children.push({
            konva: "Ellipse",
            config: {
              x: recipe.camera.xFrac * W,
              y: recipe.camera.yFrac * H,
              radiusX: cameraW / 2,
              radiusY: cameraH / 2,
              fill: recipe.camera.color,
            },
          });
        } else {
          children.push({
            konva: "Rect",
            config: {
              x: recipe.camera.xFrac * W - cameraW / 2,
              y: recipe.camera.yFrac * H - cameraH / 2,
              width: cameraW,
              height: cameraH,
              fill: recipe.camera.color,
              cornerRadius: Math.min(cameraW, cameraH) / 2,
            },
          });
        }
      }

      if (recipe.browserChrome) {
        const chrome = recipe.browserChrome;
        children.push({
          konva: "Rect",
          config: {
            x: 0,
            y: 0,
            width: W,
            height: chrome.heightFrac * H,
            fill: chrome.backgroundColor,
          },
        });
        const controlRadius = chrome.controls.radiusFrac * W;
        const controlCenterGap = controlRadius * 2 + chrome.controls.gapFrac * W;
        for (let index = 0; index < chrome.controls.count; index += 1) {
          children.push({
            konva: "Ellipse",
            config: {
              x: chrome.controls.firstCenterXFrac * W + index * controlCenterGap,
              y: chrome.controls.centerYFrac * H,
              radiusX: controlRadius,
              radiusY: controlRadius,
              fill: chrome.controls.color,
            },
          });
        }
        const addressBar = chrome.addressBar;
        children.push({
          konva: "Rect",
          config: {
            x: addressBar.leftFrac * W,
            y: addressBar.topFrac * H,
            width: W - (addressBar.leftFrac + addressBar.rightFrac) * W,
            height: addressBar.heightFrac * H,
            fill: addressBar.color,
            cornerRadius: addressBar.radiusFrac * W,
          },
        });
      }

      return { konva: "Group", config: { ...common, width: W, height: H }, children };
    }

    case "group":
      return {
        konva: "Group",
        config: { ...common, width: element.width, height: element.height },
        children: element.children
          .filter((child) => child.visible)
          .map((child) => elementToNodeConfig(child, context)),
      };

    default:
      return assertNever(element);
  }
}
