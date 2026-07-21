// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { listStarterProjectTemplates } from "@screenshot-studio/core/scaffold";
import { ProjectCreationDialog } from "./ProjectCreationDialog.js";

Object.assign(globalThis, { React });

function render(platform: "apple" | "android" | "web") {
  return renderToStaticMarkup(React.createElement(ProjectCreationDialog, {
    state: {
      status: "editing",
      form: { name: "Starter", platform, layoutMode: "isolated", templateId: null },
    },
    templates: listStarterProjectTemplates(),
    onClose: vi.fn(),
    onChange: vi.fn(),
    onSubmit: vi.fn(),
  }));
}

describe("ProjectCreationDialog starters", () => {
  it("shows only the selected platform's built-in starters plus Blank and generic starters", () => {
    const apple = render("apple");
    expect(apple).toContain("Blank");
    expect(apple).toContain("iPhone");
    expect(apple).toContain("iPad portrait");
    expect(apple).not.toContain("Android phone");
    expect(apple).not.toContain("Web desktop");

    const android = render("android");
    expect(android).toContain("Android phone");
    expect(android).toContain("Android tablet portrait");
    expect(android).toContain("Play Feature Graphic");
    expect(android).not.toContain("iPad portrait");

    const web = render("web");
    expect(web).toContain("Web desktop");
    expect(web).toContain("Web mobile");
    expect(web).not.toContain("Play Feature Graphic");
    expect(web).toContain("Feature focus");
  });
});
