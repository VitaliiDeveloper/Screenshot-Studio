// SPDX-License-Identifier: Apache-2.0
import { constants } from "node:fs";
import { describe, expect, it } from "vitest";
import { withOptionalNoFollow } from "./open-flags.js";

describe("optional no-follow flags", () => {
  it("keeps reads portable when the platform does not expose O_NOFOLLOW", () => {
    expect(withOptionalNoFollow(constants.O_RDONLY, undefined)).toBe(constants.O_RDONLY);
    expect(withOptionalNoFollow(constants.O_RDONLY, 0x20_000)).toBe(
      constants.O_RDONLY | 0x20_000,
    );
  });
});
