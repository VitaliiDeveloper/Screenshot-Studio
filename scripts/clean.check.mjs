// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { CLEAN_PATHS, clean } from "./clean.mjs";

const root = await mkdtemp(join(tmpdir(), "screenshot-studio-clean-"));
after(() => rm(root, { force: true, recursive: true }));

test("removes generated caches without removing projects or exports", async () => {
  await Promise.all([
    ...CLEAN_PATHS.map((path) => mkdir(join(root, path), { recursive: true })),
    mkdir(join(root, ".screenshot-studio", "projects"), { recursive: true }),
    mkdir(join(root, "export"), { recursive: true }),
  ]);

  await clean(root);

  for (const path of CLEAN_PATHS) {
    await assert.rejects(access(join(root, path)));
  }
  await access(join(root, ".screenshot-studio", "projects"));
  await access(join(root, "export"));
});
