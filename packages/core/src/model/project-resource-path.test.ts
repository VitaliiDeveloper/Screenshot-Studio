// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { isProjectRelativePath } from "./project-resource-path.js";

describe("isProjectRelativePath", () => {
  it.each(["assets/hero.png", "assets/Launch image 1.png", "assets/Привіт.png"])(
    "accepts portable project path %s",
    (value) => expect(isProjectRelativePath(value)).toBe(true),
  );

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
  ])("rejects unsafe project path %s", (value) => {
    expect(isProjectRelativePath(value)).toBe(false);
  });
});
