// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";

export function readTokensCss(): Promise<string> {
  return readFile(new URL("./tokens.css", import.meta.url), "utf8");
}

/** The custom properties declared directly inside the first block that starts with `selector` at or after `from`. */
export function tokenBlock(css: string, selector: string, from = 0): Map<string, string> {
  const start = css.indexOf(`${selector} {`, from);
  if (start < 0) return new Map();
  const block = css.slice(start, css.indexOf("}", start));
  const tokens = new Map<string, string>();
  for (const match of block.matchAll(/(--editor-[a-z0-9-]+):\s*([^;]+);/g)) {
    tokens.set(match[1] ?? "", (match[2] ?? "").trim());
  }
  return tokens;
}
