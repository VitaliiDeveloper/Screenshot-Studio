// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { isProjectRelativePath } from "./project-resource-path.js";

describe("isProjectRelativePath", () => {
  it.each([
    "assets/hero.png",
    "assets/Launch image 1.png",
    "assets/Привіт.png",
    "assets/.hidden.png",
    "assets/COM10.png",
    "assets/LPT0.png",
    "assets/console.png",
  ])("accepts portable project path %s", (value) => {
    expect(isProjectRelativePath(value)).toBe(true);
  });

  it.each([
    "/tmp/x.png",
    "../x.png",
    "assets/../x.png",
    "assets//x.png",
    "./assets/x.png",
    "C:/x.png",
    "C:\\x.png",
    "https://example.com/x.png",
    "file:assets/x.png",
    "assets\\x.png",
    "assets/\0x.png",
    "assets/CON.png",
    "assets/prn",
    "assets/AUX.tar.gz",
    "assets/NUL",
    "assets/COM1.png",
    "assets/com9",
    "assets/COM¹.txt",
    "assets/LPT1",
    "assets/lpt³.bin",
    "assets/x?.png",
    "assets/x*.png",
    "assets/a:b.png",
    'assets/a"b.png',
    "assets/a<b.png",
    "assets/a>b.png",
    "assets/a|b.png",
    "assets/x.",
    "assets/x ",
    "assets/folder./x.png",
    "assets/folder /x.png",
    "assets/\u0001x.png",
    "assets/x\u001fx.png",
  ])("rejects unsafe project path %s", (value) => {
    expect(isProjectRelativePath(value)).toBe(false);
  });
});
