// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUILT_IN_FONT_IDENTITIES } from "@screenshot-studio/core/model";
import { readFontkitMetadata } from "@screenshot-studio/cli/system-fonts";

const appRoot = dirname(fileURLToPath(import.meta.url));
const fontRoot = resolve(appRoot, "../public/fonts");

const FONT_FILES = [
  {
    family: "Screenshot Studio Sans",
    weight: 400,
    filename: "screenshot-studio-sans-regular-v1.ttf",
    format: "truetype",
    sha256: "d2a8188db7fdd567bbd94017cec0622373d47206d45281b7c501f0775cdee83a",
  },
  {
    family: "Screenshot Studio Display",
    weight: 400,
    filename: "screenshot-studio-display-regular-v1.woff2",
    format: "woff2",
    sha256: "3a9463a58c3e7ba1e3cd65b5dbff91a35c508ff78a104cd1121feff83efeb787",
  },
  {
    family: "Screenshot Studio Display",
    weight: 600,
    filename: "screenshot-studio-display-semibold-v1.woff2",
    format: "woff2",
    sha256: "d9f63a82b826fb0117c92715c3a52a2d2247bc321bc39341420bf52d91e8277a",
  },
  {
    family: "Screenshot Studio Display",
    weight: 800,
    filename: "screenshot-studio-display-extrabold-v1.woff2",
    format: "woff2",
    sha256: "97eeee5a6f4f22fef1f607cf8836104d65968f03e59bc068a7586bf18364a8a7",
  },
] as const;

const DISPLAY_FILES = FONT_FILES.filter(({ family }) => family === "Screenshot Studio Display");

function fontFaces(css: string): string[] {
  return css.split("@font-face").slice(1);
}

describe("built-in renderer font assets", () => {
  it.each(FONT_FILES)("pins $filename to exact checked-in bytes", async ({ filename, sha256 }) => {
    const bytes = await readFile(resolve(fontRoot, filename));

    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
  });

  it("keeps the core catalog aligned with the browser font faces", async () => {
    const [css, globals] = await Promise.all([
      readFile(resolve(appRoot, "built-in-fonts.css"), "utf8"),
      readFile(resolve(appRoot, "globals.css"), "utf8"),
    ]);
    const faces = fontFaces(css);

    expect(BUILT_IN_FONT_IDENTITIES.map(({ family, weight }) => ({ family, weight })))
      .toEqual(FONT_FILES.map(({ family, weight }) => ({ family, weight })));
    expect(faces).toHaveLength(FONT_FILES.length);
    for (const font of FONT_FILES) {
      expect(faces).toContainEqual(expect.stringContaining(`font-family: "${font.family}";
  src: url("/fonts/${font.filename}") format("${font.format}");
  font-style: normal;
  font-weight: ${font.weight};`));
    }
    expect(css).not.toContain("node_modules");
    expect(globals).toContain('@import "./built-in-fonts.css";');
  });

  it("ships the license of each built-in family", async () => {
    const [noto, inter] = await Promise.all([
      readFile(resolve(fontRoot, "OFL.txt"), "utf8"),
      readFile(resolve(fontRoot, "OFL-Inter.txt"), "utf8"),
    ]);

    expect(noto).toContain("Copyright 2015-2021 Google LLC. All Rights Reserved.");
    expect(noto).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(inter).toContain("Copyright (c) 2016 The Inter Project Authors");
    expect(inter).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(inter.split("\n")[0]).not.toMatch(/Reserved Font Name/i);
  });

  it.each(DISPLAY_FILES)("$filename is a static, embeddable $weight face with Cyrillic and Latin Extended-A", async ({ filename, weight }) => {
    const [metadata] = readFontkitMetadata(await readFile(resolve(fontRoot, filename)), filename);

    expect(metadata).toMatchObject({
      family: "Inter Display",
      weight,
      italic: false,
      variable: false,
      collection: false,
      restrictedEmbedding: false,
      coverage: { latin: true, latinExtA: true, cyrillic: true, greek: true },
    });
  });
});
