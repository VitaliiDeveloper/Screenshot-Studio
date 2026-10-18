// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = dirname(fileURLToPath(import.meta.url));
const systemFamilies = ["ui-sans-serif", "-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "sans-serif"];

describe("editor chrome font stack", () => {
  it("names only system families so project fonts cannot restyle the UI", async () => {
    const globals = await readFile(resolve(appRoot, "globals.css"), "utf8");
    const stack = /:root\s*\{[^}]*?font-family:\s*([^;]+);/.exec(globals)?.[1];

    expect(stack?.split(",").map((family) => family.trim())).toEqual(systemFamilies);
  });
});
