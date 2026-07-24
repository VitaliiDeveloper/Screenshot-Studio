// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OUTPUT_DESTINATIONS } from "@screenshot-studio/core/export";
import { listStarterProjectTemplates, ProjectScaffoldInput } from "@screenshot-studio/core/scaffold";
import { ProjectCreationDialog, projectCreationPlatformOptions } from "./ProjectCreationDialog.js";

Object.assign(globalThis, { React });

function render(
  platform: "apple" | "android" | "web",
  device: "iphone" | "phone" | "wear" | "desktop" = platform === "apple" ? "iphone" : platform === "android" ? "phone" : "desktop",
  templates = listStarterProjectTemplates(),
) {
  const form = ProjectScaffoldInput.parse({
    name: "Starter", platform, device, layoutMode: "isolated", templateId: null,
  });
  return renderToStaticMarkup(React.createElement(ProjectCreationDialog, {
    state: {
      status: "editing",
      form,
    },
    templates,
    onClose: vi.fn(),
    onChange: vi.fn(),
    onSubmit: vi.fn(),
  }));
}

describe("ProjectCreationDialog starters", () => {
  it("derives destination labels and template short labels from the core catalog", () => {
    const base = listStarterProjectTemplates()[0]!;
    const template = {
      ...base,
      id: "all-platforms",
      name: "All platforms",
      supportedPlatforms: OUTPUT_DESTINATIONS.map(({ id }) => id),
      device: undefined,
    };
    const markup = render("apple", "iphone", [template]);

    expect(projectCreationPlatformOptions).toEqual(
      OUTPUT_DESTINATIONS.map(({ id, label }) => ({ value: id, label })),
    );
    expect(markup).toContain(`Supports ${OUTPUT_DESTINATIONS.map(({ shortLabel }) => shortLabel).join(", ")}`);
    expect(markup).not.toContain("Apple App Store");
  });

  it("shows only the selected device family's built-in starters plus Blank and generic starters", () => {
    const apple = render("apple");
    expect(apple).toContain("Blank");
    expect(apple).toContain("iPhone");
    expect(apple).not.toContain("Spacious portrait composition");
    expect(apple).not.toContain("Android phone");
    expect(apple).not.toContain("Web desktop");

    const android = render("android");
    expect(android).toContain("Android phone");
    expect(android).not.toContain("7-inch tablet portrait starter");
    expect(android).toContain("Play Feature Graphic");
    expect(android).not.toContain("iPad portrait");

    const web = render("web");
    expect(web).toContain("Web desktop");
    expect(web).not.toContain("Responsive mobile composition");
    expect(web).not.toContain("Play Feature Graphic");
    expect(web).toContain("Feature focus");
  });

  it("shows shared device-family labels, filters device-specific starters, and explains specialized output", () => {
    const wear = render("android", "wear");
    expect(wear).toContain("Device family");
    expect(wear).toContain("Wear OS");
    expect(wear).toContain("Specialized output");
    expect(wear).toContain("Feature focus");
    expect(wear).not.toContain("Google Play phone starter");

    expect(render("apple", "iphone")).toContain("iPhone");
  });
});
