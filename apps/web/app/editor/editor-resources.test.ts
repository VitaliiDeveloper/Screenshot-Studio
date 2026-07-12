// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Project } from "@screenshot-studio/core/model";
import { missingImageUrls } from "./editor-resources";

const project = {
  meta: { name: "Resources", schemaVersion: 10 },
  mode: "isolated",
  platforms: ["apple"],
  locales: ["en"],
  fonts: [],
  screens: [{
    id: "screen",
    name: "Screen",
    platform: "apple",
    device: "iphone",
    locale: "en",
    direction: "ltr",
    artboard: { width: 100, height: 200 },
    background: { type: "image", assetUrl: "assets/background.png", fit: "cover", color: "#ffffff" },
    elements: [{
      id: "image",
      type: "image",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotation: 0,
      opacity: 1,
      locked: false,
      visible: true,
      assetUrl: "assets/image.png",
      fit: "contain",
      cornerRadius: 0,
    }],
  }],
} as Project;

describe("editor resources", () => {
  it("returns only project image URLs absent from the current cache", () => {
    const cache = new Map([["assets/background.png", {} as HTMLImageElement]]);
    expect(missingImageUrls(project, cache)).toEqual(["assets/image.png"]);
  });
});
