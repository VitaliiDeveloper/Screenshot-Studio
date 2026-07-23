// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Screen } from "@screenshot-studio/core/model";
import type { ScreenTemplate } from "@screenshot-studio/core/templates";
import {
  compatibleTemplates,
  templateOutputFamilyLabel,
} from "./TemplateLibraryDialog";

function template(
  id: string,
  platform: ScreenTemplate["platform"],
  device: ScreenTemplate["device"],
): ScreenTemplate {
  return {
    id,
    name: id,
    platform,
    device,
    artboard: { width: 100, height: 100 },
    background: { type: "solid", color: "#FFFFFF" },
    elements: [],
  } as ScreenTemplate;
}

const wearScreen = {
  platform: "android",
  device: "wear",
} as Screen;

describe("TemplateLibraryDialog output compatibility", () => {
  it("shows only templates for the active destination/device family", () => {
    const templates = [
      template("macos-starter", "apple", "macos"),
      template("tvos-starter", "apple", "tvos"),
      template("visionos-starter", "apple", "visionos"),
      template("wear-os-starter", "android", "wear"),
    ];

    expect(compatibleTemplates(templates, wearScreen).map(({ id }) => id))
      .toEqual(["wear-os-starter"]);
  });

  it("uses shared destination and device labels for template metadata", () => {
    expect(templateOutputFamilyLabel(template("macos-starter", "apple", "macos")))
      .toBe("App Store · macOS");
    expect(templateOutputFamilyLabel(template("wear-os-starter", "android", "wear")))
      .toBe("Google Play · Wear OS");
  });
});
