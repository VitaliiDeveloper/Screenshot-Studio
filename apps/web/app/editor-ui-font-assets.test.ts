// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUILT_IN_FONT_IDENTITIES } from "@screenshot-studio/core/model";

const appRoot = dirname(fileURLToPath(import.meta.url));
const uiFontRoot = resolve(appRoot, "../public/fonts/ui");
const UI_FAMILY = "Screenshot Studio UI";

describe("editor UI font", () => {
  it("pins the checked-in Instrument Sans bytes and ships its license", async () => {
    const [bytes, license] = await Promise.all([
      readFile(resolve(uiFontRoot, "screenshot-studio-ui-variable-v1.ttf")),
      readFile(resolve(uiFontRoot, "OFL-Instrument-Sans.txt"), "utf8"),
    ]);

    expect(createHash("sha256").update(bytes).digest("hex"))
      .toBe("b24f1812584816958afcf22e22d08e44318c5e51651e25d2438efdde389b33b1");
    expect(license).toContain("Copyright 2022 The Instrument Sans Project Authors");
    expect(license).toContain("SIL OPEN FONT LICENSE Version 1.1");
  });

  it("styles the UI under a private family that stays out of the renderer catalog", async () => {
    const [face, globals, rendererFaces] = await Promise.all([
      readFile(resolve(appRoot, "editor-ui-font.css"), "utf8"),
      readFile(resolve(appRoot, "globals.css"), "utf8"),
      readFile(resolve(appRoot, "built-in-fonts.css"), "utf8"),
    ]);

    expect(face).toContain(`font-family: "${UI_FAMILY}";
  src: url("/fonts/ui/screenshot-studio-ui-variable-v1.ttf") format("truetype");`);
    expect(face).not.toContain("Instrument Sans");
    expect(globals).toContain('@import "./editor-ui-font.css";');
    expect(rendererFaces).not.toContain(UI_FAMILY);
    expect(BUILT_IN_FONT_IDENTITIES.map(({ family }) => family)).not.toContain(UI_FAMILY);
  });
});
