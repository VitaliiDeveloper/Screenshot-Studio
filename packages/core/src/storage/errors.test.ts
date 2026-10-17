// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { errorCode, errorText } from "./errors.js";

describe("errorCode", () => {
  it("returns only a string system error code", () => {
    expect(errorCode(Object.assign(new Error("missing"), { code: "ENOENT" }))).toBe("ENOENT");
    expect(errorCode(Object.assign(new Error("numeric"), { code: 1 }))).toBeUndefined();
    expect(errorCode(new Error("plain"))).toBeUndefined();
    expect(errorCode("ENOENT")).toBeUndefined();
    expect(errorCode(null)).toBeUndefined();
  });
});

describe("errorText", () => {
  it("uses an Error message and stringifies anything else", () => {
    expect(errorText(new Error("boom"))).toBe("boom");
    expect(errorText(42)).toBe("42");
  });
});
