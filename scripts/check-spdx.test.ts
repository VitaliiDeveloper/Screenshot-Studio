// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { checkSpdx, collectSourceFiles } from "./check-spdx.mjs";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "check-spdx-"));
  roots.push(path);
  return path;
}

async function source(rootPath: string, relativePath: string, contents = "export {};\n"): Promise<void> {
  const path = join(rootPath, relativePath);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, contents, "utf8");
}

describe("SPDX source collection", () => {
  it("skips generated and worktree directory names at every traversal depth", async () => {
    const rootPath = await root();
    await source(rootPath, "src/authored.ts");
    await source(rootPath, "nested/my-worktree-tools/kept.tsx");
    await source(rootPath, ".git/skipped.ts");
    await source(rootPath, "nested/.next/skipped.ts");
    await source(rootPath, "nested/node_modules/skipped.mjs");
    await source(rootPath, "packages/core/dist/skipped.ts");
    await source(rootPath, ".worktrees/branch/skipped.ts");
    await source(rootPath, "nested/worktrees/branch/skipped.tsx");
    await source(rootPath, "src/not-source.txt");

    const files = await collectSourceFiles(rootPath);
    expect(files.map((path) => relative(rootPath, path).split("\\").join("/")))
      .toEqual(["nested/my-worktree-tools/kept.tsx", "src/authored.ts"]);
  });

  it("checks relative paths and write mode preserves a shebang", async () => {
    const rootPath = await root();
    await source(rootPath, "bin/tool.mjs", "#!/usr/bin/env node\nconsole.log('ok');\n");
    await source(rootPath, "src/good.ts", "// SPDX-License-Identifier: Apache-2.0\nexport {};\n");

    const checked = await checkSpdx({ root: rootPath, write: false });
    expect(checked.missing).toEqual(["bin/tool.mjs"]);

    const written = await checkSpdx({ root: rootPath, write: true });
    expect(written.missing).toEqual([]);
    expect(written.updated).toEqual(["bin/tool.mjs"]);
    expect(await readFile(join(rootPath, "bin/tool.mjs"), "utf8")).toBe(
      "#!/usr/bin/env node\n// SPDX-License-Identifier: Apache-2.0\nconsole.log('ok');\n",
    );
  });
});
