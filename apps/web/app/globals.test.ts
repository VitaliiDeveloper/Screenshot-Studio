// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = dirname(fileURLToPath(import.meta.url));
const systemFamilies = ["ui-sans-serif", "-apple-system", "BlinkMacSystemFont", "system-ui", "sans-serif"];

describe("editor chrome font stack", () => {
  it("names only the private UI family and system families so project fonts cannot restyle the UI", async () => {
    const globals = await readFile(resolve(appRoot, "globals.css"), "utf8");
    const stack = /@theme\s*\{[^}]*?--font-sans:\s*([^;]+);/.exec(globals)?.[1];

    expect(stack?.split(",").map((family) => family.trim())).toEqual(['"Screenshot Studio UI"', ...systemFamilies]);
    expect(/:root\s*\{[^}]*?font-family:\s*([^;]+);/.exec(globals)?.[1]).toBe("var(--font-sans)");
  });
});
