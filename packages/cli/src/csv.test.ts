// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { formatCsv, parseCsv } from "./csv.js";

describe("csv", () => {
  it("quotes only fields with commas, quotes, or line breaks, and ends records with CRLF", () => {
    expect(formatCsv([["plain", "a,b", 'say "hi"', "one\ntwo", "cr\rhere", ""]]))
      .toBe('plain,"a,b","say ""hi""","one\ntwo","cr\rhere",\r\n');
  });

  it("round-trips awkward copy", () => {
    const records = [["a", 'He said, "go"\r\nnow', ""], ["", "", ""], ["тест", "مرحبا, \"بك\"", "x"]];
    expect(parseCsv(formatCsv(records))).toEqual(records);
  });

  it("reads LF and CR separators, a byte-order mark, and skips blank lines", () => {
    expect(parseCsv("﻿a,b\n\nc,d\re,f")).toEqual([["a", "b"], ["c", "d"], ["e", "f"]]);
    expect(parseCsv("a,\"\"\n")).toEqual([["a", ""]]);
  });

  it.each([
    ['a,"unterminated', /ends inside a quoted field/],
    ['a,"b"c', /text after a closing quote/],
    ['a,b"c"', /stray quote/],
  ])("rejects malformed input %j", (input, message) => {
    expect(() => parseCsv(input)).toThrow(message);
  });
});
