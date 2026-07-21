// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Project } from "@screenshot-studio/core/model";
import { buildWebSharePackage } from "./web-share.js";

const project: Project = {
  meta: { name: "Accessible <Launch>", schemaVersion: 1 },
  fonts: [],
  preferredExportLayoutId: "default",
  layouts: [{
    id: "default", name: "Default", mode: "isolated", screens: [{
      id: "hero", name: "Hero & proof", platform: "web", device: "desktop", locale: "en",
      direction: "ltr", artboard: { width: 1920, height: 1080 },
      background: { type: "solid", color: "#000000" }, elements: [],
    }],
  }],
};

describe("buildWebSharePackage", () => {
  it("creates a portable local-only accessible package around shared-renderer PNGs", () => {
    const png = Buffer.from([1, 2, 3]);
    const result = buildWebSharePackage(project, [{
      entry: { screen: project.layouts[0]!.screens[0]!, target: { id: "desktop-1920", label: "Desktop", width: 1920, height: 1080, orientation: "landscape" }, relativePath: "web/desktop/locale-en/01-hero.png" },
      png,
    }]);
    expect(result.screenshots[0]!.entry.relativePath).toBe("web-share/screenshots/web/desktop/locale-en/01-hero.png");
    expect(result.extraFiles.map(({ relativePath }) => relativePath)).toEqual([
      "web-share/index.html", "web-share/assets/styles.css", "web-share/og-image.png", "web-share/manifest.json",
    ]);
    const html = result.extraFiles[0]!.bytes.toString();
    expect(html).toContain('lang="en"');
    expect(html).toContain('aria-label="Screenshots"');
    expect(html).toContain("Accessible &lt;Launch&gt;");
    expect(html).not.toMatch(/https?:|cdn/i);
    expect(result.extraFiles[2]!.bytes).toEqual(png);
  });
});
