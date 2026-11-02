// SPDX-License-Identifier: Apache-2.0
import {
  assertNever,
  ICON_PATHS,
  type Background,
  type Element,
  type LinearGradientPaint,
} from "@screenshot-studio/core/model";
import { deviceFrameToNodeConfig } from "./device-frame-node.js";
import { computeImageFit, mediaFilter } from "./node-media.js";
import type { Box, ElementRenderContext, ImageCache, NodeConfig } from "./node-types.js";

/**
 * The single element→Konva-props map: both the static export renderer (`renderScreen`) and the
 * interactive editor stage build nodes from this exact output. Pure and synchronous — it LOOKS
 * images up in a preloaded `images` cache, it never loads one, so the sync contract holds for both
 * render paths. A `device-frame` returns a `Group` of native shapes + the clipped content image;
 * interaction props (draggable, listeners) are the editor's concern and are added by the caller,
 * never here.
 */
export type { ImageCache };

interface PositionedBox extends Box {
  x?: number;
  y?: number;
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
  const { images, direction = "ltr", zoom = 1 } = context;
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
              strokeWidth: element.strokeWidth * zoom,
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

    case "device-frame":
      return deviceFrameToNodeConfig(element, common, images);

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
