// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { NodeConfig } from "@screenshot-studio/core/engine";
import { DEVICE_FRAME_PRESETS, type DeviceFrameElement } from "@screenshot-studio/core/model";
import { DeviceFramePresetThumbnail } from "./DeviceFramePresetThumbnail.js";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  elementToNodeConfig: vi.fn((element: DeviceFrameElement): NodeConfig => ({
    konva: "Rect" as const,
    config: { x: element.x, y: element.y, width: element.width, height: element.height },
  })),
  renderNodeConfigChild: vi.fn(() => null),
}));

vi.mock("react-konva", () => ({
  Layer: ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children),
  Stage: ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children),
}));
vi.mock("./EditorStage.js", () => ({
  renderNodeConfigChild: mocks.renderNodeConfigChild,
}));
vi.mock("@screenshot-studio/core/engine", () => ({
  elementToNodeConfig: mocks.elementToNodeConfig,
}));

describe("DeviceFramePresetThumbnail", () => {
  it("renders every catalog card through the default core recipe and existing stage adapter", () => {
    for (const preset of DEVICE_FRAME_PRESETS) {
      renderToStaticMarkup(React.createElement(DeviceFramePresetThumbnail, { preset }));
    }

    expect(mocks.elementToNodeConfig).toHaveBeenCalledTimes(DEVICE_FRAME_PRESETS.length);
    expect(mocks.elementToNodeConfig.mock.calls.map(([element]) => element)).toEqual(
      DEVICE_FRAME_PRESETS.map((preset) => expect.objectContaining({
        type: "device-frame",
        deviceType: preset.id,
        assetUrl: undefined,
        fit: "cover",
      })),
    );
    expect(mocks.renderNodeConfigChild).toHaveBeenCalledTimes(DEVICE_FRAME_PRESETS.length);
    for (const [index, preset] of DEVICE_FRAME_PRESETS.entries()) {
      expect(mocks.renderNodeConfigChild.mock.calls[index]).toEqual([
        mocks.elementToNodeConfig.mock.results[index]!.value,
        preset.id,
        false,
      ]);
    }
  });
});
