// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { parseStoreSpecs } from "@screenshot-studio/core/export";
import { parseProjectJson } from "@screenshot-studio/core/model";
import { createProjectScaffold } from "@screenshot-studio/core/scaffold";
import { describe, expect, it } from "vitest";
import { launcherExampleWorkflows } from "@web/components/project-launcher/launcher-examples.js";

describe("launcher example workflows", () => {
  it("exposes exactly the four closure workflows with unambiguous actions", () => {
    expect(launcherExampleWorkflows.map(({ id, action }) => [id, action])).toEqual([
      ["isolated-project", "create-project"],
      ["connected-deck", "create-project"],
      ["rtl-multi-locale", "project-import"],
      ["imported-screenshots", "capture-import"],
    ]);
    expect(JSON.stringify(launcherExampleWorkflows)).not.toContain("/Users/");
    expect(JSON.stringify(launcherExampleWorkflows)).not.toContain("app-store-screenshots.json");
  });

  it("keeps create examples on the current strict scaffold and living examples on the current schema", () => {
    const specs = parseStoreSpecs(JSON.parse(readFileSync(
      new URL("../../../../store-specs.json", import.meta.url),
      "utf8",
    )));
    for (const example of launcherExampleWorkflows) {
      if (example.action !== "create-project") continue;
      expect(() => createProjectScaffold({
        name: example.title,
        ...example.creation,
      }, specs)).not.toThrow();
    }

    const connected = parseProjectJson(readFileSync(
      new URL("../../../../examples/connected-launch/app-store-screenshots.json", import.meta.url),
      "utf8",
    ));
    const rtl = parseProjectJson(readFileSync(
      new URL("../../../../examples/rtl-delivery/app-store-screenshots.json", import.meta.url),
      "utf8",
    ));
    expect(connected.layouts[0]?.mode).toBe("connected");
    expect(connected.layouts.flatMap(({ screens }) => screens)
      .some(({ elements }) => elements.some(({ type }) => type === "screenshot"))).toBe(true);
    expect(new Set(rtl.layouts.flatMap(({ screens }) => screens.map(({ locale }) => locale))))
      .toEqual(new Set(["en", "ar"]));
  });
});
