// SPDX-License-Identifier: Apache-2.0
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LauncherExamples } from "./LauncherExamples.js";

describe("LauncherExamples", () => {
  it("renders four keyboard-reachable workflows with current terminology", () => {
    const markup = renderToStaticMarkup(createElement(LauncherExamples, { onSelect: vi.fn() }));
    for (const copy of [
      "Separate images feature project",
      "Panorama launch deck",
      "RTL and multi-locale delivery",
      "Imported screenshot story",
      "Create separate images example",
      "Create panorama example",
      "Import locale example",
      "Import screenshot example",
    ]) expect(markup).toContain(copy);
    expect(markup.match(/<button/g)).toHaveLength(4);
    expect(markup).not.toContain("special demo model");
  });
});
