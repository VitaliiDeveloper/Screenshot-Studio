// SPDX-License-Identifier: Apache-2.0
import { deviceFramePreset, type DeviceFrameElement } from "@screenshot-studio/core/model";
import { computeImageFit, mediaFilter } from "./node-media.js";
import type { ImageCache, NodeConfig } from "./node-types.js";

export function deviceFrameToNodeConfig(
  element: DeviceFrameElement,
  common: Pick<DeviceFrameElement, "id" | "x" | "y" | "rotation" | "opacity">,
  images: ImageCache | undefined,
): NodeConfig {
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
        cornerRadius: [
          spec.frameCornerRadius * W,
          spec.frameCornerRadius * W,
          0,
          0,
        ],
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
