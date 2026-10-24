// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ToolRail.tsx", import.meta.url), "utf8");

describe("ToolRail project navigation", () => {
  it("places the Projects home action at the bottom of the Workspace rail", () => {
    expect(source).toContain("House");
    expect(source).toContain('label="Projects"');
    expect(source).toContain("onOpenProjects");
    expect(source).toContain("projectsBusy");
    expect(source).toContain("mt-auto");
  });

  it("gives each resource its own rail entry instead of a Resources panel", () => {
    const labels = [...source.matchAll(/(?<![-\w])label="([^"]+)"/g)].map((match) => match[1]);
    expect(labels).toEqual([
      "Select tool",
      "Hand tool",
      "Layers panel",
      "Screen templates",
      "Design packs",
      "Fonts",
      "Project images",
      "Locales",
      "Agent panel",
      "Play",
      "Projects",
    ]);
    expect(source).not.toContain('"resources"');
    expect(source.match(/aria-haspopup="dialog"/g)).toHaveLength(6);
    expect(source).toContain('onClick={() => onOpenDialog("project-images")}');
  });

  it("keeps the Agent panel reachable and pauses resource dialogs and Projects during an agent run", () => {
    expect(source).toContain('active={panel === "agent"} onClick={() => onPanelToggle("agent")}');
    expect(source.match(/disabled=\{editingLocked\}/g)).toHaveLength(5);
    expect(source).toContain("disabled={projectsBusy || editingLocked}");
  });

  it("captions every rail item with text its accessible name contains", () => {
    const items = [...source.matchAll(/label="([^"]+)"\s+caption="([^"]+)"/g)];
    expect(items.map((match) => match[2])).toEqual([
      "Select", "Hand", "Layers", "Templates", "Packs", "Fonts", "Images", "Locales", "Agent", "Play", "Projects",
    ]);
    for (const [, label, caption] of items) expect(label!.toLowerCase()).toContain(caption!.toLowerCase());
  });
});
