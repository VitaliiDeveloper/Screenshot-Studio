// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { ScreenTemplate, TemplatePack } from "@screenshot-studio/core/templates";
import {
  builtInTemplateEntries,
  filterTemplateEntries,
  templateOrientation,
  templateOutputFamilyLabel,
  templatePreviewPath,
  type TemplateFilters,
} from "./TemplateLibraryDialog";

function template(
  id: string,
  platform: ScreenTemplate["platform"],
  device: ScreenTemplate["device"],
  artboard = { width: 100, height: 200 },
): ScreenTemplate {
  return {
    id,
    name: id,
    platform,
    device,
    artboard,
    background: { type: "solid", color: "#FFFFFF" },
    elements: [],
  } as ScreenTemplate;
}

function pack(id: string, style: string, screens: ScreenTemplate[]): TemplatePack {
  return { id, name: id, description: id, platform: "apple", device: "iphone", style, screens };
}

const anything: TemplateFilters = { query: "", family: "all", style: "all", orientation: "all" };
const ids = (entries: { template: ScreenTemplate }[]) => entries.map(({ template }) => template.id);

describe("TemplateLibraryDialog catalog", () => {
  const entries = builtInTemplateEntries(
    [
      template("web-desktop", "web", "desktop", { width: 1920, height: 1080 }),
      template("iphone-starter", "apple", "iphone"),
    ],
    [
      pack("clean-iphone", "clean", [template("clean-iphone-hero", "apple", "iphone")]),
      pack("poster-iphone", "poster", [template("poster-iphone-cta", "apple", "iphone")]),
      pack("neutral-iphone-basics", "neutral-default", [template("neutral-iphone-hero", "apple", "iphone")]),
    ],
  );

  it("flattens starters and pack screens, attaching style and shipped previews", () => {
    expect(entries.map(({ template: { id }, style, preview }) => ({ id, style, preview }))).toEqual([
      { id: "web-desktop", style: undefined, preview: null },
      { id: "iphone-starter", style: undefined, preview: null },
      { id: "clean-iphone-hero", style: "clean", preview: "/template-previews/clean-iphone/hero.png" },
      { id: "poster-iphone-cta", style: "poster", preview: "/template-previews/poster-iphone/cta.png" },
      { id: "neutral-iphone-hero", style: "neutral-default", preview: null },
    ]);
  });

  it("only maps pack-prefixed screen ids to a preview file", () => {
    expect(templatePreviewPath("aurora-android-phone", "aurora-android-phone-feature-2"))
      .toBe("/template-previews/aurora-android-phone/feature-2.png");
    expect(templatePreviewPath("neutral-iphone-basics", "neutral-iphone-feature")).toBeNull();
  });

  it("classifies orientation from the artboard", () => {
    expect(templateOrientation(template("tall", "apple", "iphone"))).toBe("portrait");
    expect(templateOrientation(template("wide", "web", "desktop", { width: 300, height: 100 }))).toBe("landscape");
    expect(templateOrientation(template("square", "web", "desktop", { width: 100, height: 100 }))).toBe("landscape");
  });

  it("filters by output family, style, and orientation together", () => {
    expect(ids(filterTemplateEntries(entries, { ...anything, family: "apple/iphone" })))
      .toEqual(["iphone-starter", "clean-iphone-hero", "poster-iphone-cta", "neutral-iphone-hero"]);
    expect(ids(filterTemplateEntries(entries, { ...anything, style: "poster" }))).toEqual(["poster-iphone-cta"]);
    expect(ids(filterTemplateEntries(entries, { ...anything, orientation: "landscape" }))).toEqual(["web-desktop"]);
    expect(filterTemplateEntries(entries, { ...anything, family: "web/desktop", orientation: "portrait" })).toEqual([]);
  });

  it("searches names, output labels, and style names case-insensitively", () => {
    expect(ids(filterTemplateEntries(entries, { ...anything, query: "WEB" }))).toEqual(["web-desktop"]);
    expect(ids(filterTemplateEntries(entries, { ...anything, query: "poster cta" }))).toEqual(["poster-iphone-cta"]);
    expect(ids(filterTemplateEntries(entries, { ...anything, query: "Clean" }))).toEqual(["clean-iphone-hero"]);
    expect(ids(filterTemplateEntries(entries, { ...anything, query: "app store" }))).toHaveLength(4);
  });

  it("uses shared destination and device labels for template metadata", () => {
    expect(templateOutputFamilyLabel(template("macos-starter", "apple", "macos")))
      .toBe("App Store · macOS");
    expect(templateOutputFamilyLabel(template("wear-os-starter", "android", "wear")))
      .toBe("Google Play · Wear OS");
  });
});
