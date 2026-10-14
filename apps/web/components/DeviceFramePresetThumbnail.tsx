// SPDX-License-Identifier: Apache-2.0
"use client";

import { Layer, Stage } from "react-konva";
import {
  elementToNodeConfig,
  type NodeConfig,
} from "@screenshot-studio/core/engine";
import type {
  DeviceFrameElement,
  DeviceFramePreset,
} from "@screenshot-studio/core/model";
import { renderNodeConfigChild } from "./EditorStage";

const THUMBNAIL_WIDTH = 112;
const THUMBNAIL_HEIGHT = 84;
const THUMBNAIL_PADDING = 8;

type ElementToNodeConfig = (element: DeviceFrameElement) => NodeConfig;

export function deviceFrameThumbnailNodeConfig(
  preset: DeviceFramePreset,
  mapElement: ElementToNodeConfig = elementToNodeConfig,
): NodeConfig {
  const availableWidth = THUMBNAIL_WIDTH - THUMBNAIL_PADDING * 2;
  const availableHeight = THUMBNAIL_HEIGHT - THUMBNAIL_PADDING * 2;
  const width = Math.min(availableWidth, availableHeight * preset.recipe.spec.aspectRatio);
  const height = width / preset.recipe.spec.aspectRatio;
  const element: DeviceFrameElement = {
    id: `thumbnail-${preset.id}`,
    type: "device-frame",
    x: (THUMBNAIL_WIDTH - width) / 2,
    y: (THUMBNAIL_HEIGHT - height) / 2,
    width,
    height,
    rotation: 0,
    opacity: 1,
    locked: true,
    visible: true,
    deviceType: preset.id,
    assetUrl: undefined,
    fit: "cover",
  };
  return mapElement(element);
}

export function DeviceFramePresetThumbnail({ preset }: { preset: DeviceFramePreset }) {
  const nodeConfig = deviceFrameThumbnailNodeConfig(preset);
  return (
    <div
      aria-hidden="true"
      className="flex h-[84px] w-full items-center justify-center overflow-hidden rounded-lg bg-[var(--editor-color-surface-muted)]"
    >
      <Stage width={THUMBNAIL_WIDTH} height={THUMBNAIL_HEIGHT} listening={false}>
        <Layer listening={false}>
          {renderNodeConfigChild(nodeConfig, preset.id, false)}
        </Layer>
      </Stage>
    </div>
  );
}
