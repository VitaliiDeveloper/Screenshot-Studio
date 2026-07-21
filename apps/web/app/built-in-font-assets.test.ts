// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUILT_IN_FONT_IDENTITIES } from "@screenshot-studio/core/model";

const appRoot = dirname(fileURLToPath(import.meta.url));
const fontRoot = resolve(appRoot, "../public/fonts");
const fontFilename = "screenshot-studio-sans-regular-v1.ttf";

describe("built-in renderer font assets", () => {
  it("pins the renderer-owned default to exact checked-in bytes", async () => {
    const bytes = await readFile(resolve(fontRoot, fontFilename));

    expect(createHash("sha256").update(bytes).digest("hex"))
      .toBe("d2a8188db7fdd567bbd94017cec0622373d47206d45281b7c501f0775cdee83a");
  });

  it("keeps the core catalog aligned with the browser font face", async () => {
    const [css, globals, license] = await Promise.all([
      readFile(resolve(appRoot, "built-in-fonts.css"), "utf8"),
      readFile(resolve(appRoot, "globals.css"), "utf8"),
      readFile(resolve(fontRoot, "OFL.txt"), "utf8"),
    ]);
    const [font] = BUILT_IN_FONT_IDENTITIES;

    expect(BUILT_IN_FONT_IDENTITIES).toHaveLength(1);
    expect(css).toContain(`font-family: "${font.family}"`);
    expect(css).toContain(`font-weight: ${font.weight}`);
    expect(css).toContain(`url("/fonts/${fontFilename}")`);
    expect(css).not.toContain("node_modules");
    expect(globals).toContain('@import "./built-in-fonts.css";');
    expect(license).toContain("Copyright 2015-2021 Google LLC. All Rights Reserved.");
    expect(license).toContain("SIL OPEN FONT LICENSE Version 1.1");
  });
});
