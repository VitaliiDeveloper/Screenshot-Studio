// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { systemFontRoots } from "@screenshot-studio/cli/system-fonts";
import { SYSTEM_FONT_ROOTS_ENV, systemFontRootsFromEnvironment } from "./system-fonts.server.js";

const override = JSON.stringify([{ dir: "/tmp/fonts", source: "system" }, { dir: "/tmp/mine", source: "user" }]);

describe("systemFontRootsFromEnvironment", () => {
  it("honours the root override outside production", () => {
    for (const NODE_ENV of ["development", "test", undefined]) {
      expect(systemFontRootsFromEnvironment({ [SYSTEM_FONT_ROOTS_ENV]: override, NODE_ENV } as NodeJS.ProcessEnv))
        .toEqual([{ dir: "/tmp/fonts", source: "system" }, { dir: "/tmp/mine", source: "user" }]);
    }
  });

  it("ignores the override in production and falls back to the OS folders", () => {
    expect(systemFontRootsFromEnvironment({ [SYSTEM_FONT_ROOTS_ENV]: override, NODE_ENV: "production" } as NodeJS.ProcessEnv))
      .toEqual(systemFontRoots());
    expect(systemFontRootsFromEnvironment({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toEqual(systemFontRoots());
  });

  it("names the variable when the override is not valid JSON", () => {
    expect(() => systemFontRootsFromEnvironment({ [SYSTEM_FONT_ROOTS_ENV]: "{nope", NODE_ENV: "test" } as NodeJS.ProcessEnv))
      .toThrow(/SCREENSHOT_STUDIO_SYSTEM_FONT_ROOTS must be a JSON array/);
  });

  it("fails loudly on a malformed override", () => {
    expect(() => systemFontRootsFromEnvironment({ [SYSTEM_FONT_ROOTS_ENV]: '[{"dir":1}]', NODE_ENV: "test" } as NodeJS.ProcessEnv))
      .toThrow(/JSON array/);
  });
});
