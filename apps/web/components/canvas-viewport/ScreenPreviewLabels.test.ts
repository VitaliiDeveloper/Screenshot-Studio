// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Screen } from "@screenshot-studio/core/model";
import { screenPreviewMetadata } from "./ScreenPreviewLabels.js";

const screen = (storeTargetId?: string) => ({
  platform: "apple",
  device: "iphone",
  locale: "en",
  artboard: { width: 603, height: 1311 },
  ...(storeTargetId ? { storeTargetId } : {}),
}) as Screen;

describe("screenPreviewMetadata", () => {
  it("names the store target and its export px instead of persisted ids", () => {
    expect(screenPreviewMetadata(screen("6.1"))).toBe('iPhone 5.8" · Portrait · 1125 × 2436 · en');
  });

  it("resolves a master to its family's lead target", () => {
    expect(screenPreviewMetadata(screen())).toBe('iPhone 6.3" · Portrait · 1206 × 2622 · en');
  });
});
