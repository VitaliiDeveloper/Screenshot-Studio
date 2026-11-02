// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { packEntries, ProjectPackErrors } from "./ThemeManagerDialog";

const source = readFileSync(new URL("./ThemeManagerDialog.tsx", import.meta.url), "utf8");

describe("ThemeManagerDialog project packs", () => {
  it("lists project packs after the built-ins with their own source", () => {
    expect(packEntries([{ id: "clean" }], [{ id: "house" }])).toEqual([
      { pack: { id: "clean" }, source: "built-in" },
      { pack: { id: "house" }, source: "project-pack" },
    ]);
  });

  it("reports each broken pack file inline and nothing when all packs load", () => {
    expect(renderToStaticMarkup(createElement(ProjectPackErrors, { errors: [] }))).toBe("");
    const markup = renderToStaticMarkup(createElement(ProjectPackErrors, {
      errors: [{ file: "packs/broken/screen-pack.json", message: "not valid JSON" }],
    }));
    expect(markup).toContain('role="status"');
    expect(markup).toContain("<code>packs/broken/screen-pack.json</code>: not valid JSON");
  });

  it("applies project packs through the same routes as built-in packs", () => {
    expect(source).toContain('onClick={() => apply(pack.id, source)}');
    expect(source).toContain('source: source === "built-in" ? "built-in-pack" : source');
  });
});
