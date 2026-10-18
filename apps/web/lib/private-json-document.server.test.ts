// SPDX-License-Identifier: Apache-2.0
import { constants } from "node:fs";
import { mkdtemp, open, readdir, readFile, rename, rm, stat, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writePrivateJsonDocument, type PrivateJsonDocumentWrite } from "./private-json-document.server.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function documentRoot(): Promise<{ root: string; targetPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "private-json-document-"));
  roots.push(root);
  const targetPath = join(root, "doc.json");
  await writeFile(targetPath, "previous", "utf8");
  return { root, targetPath };
}

function request(
  root: string,
  targetPath: string,
  overrides: Partial<PrivateJsonDocumentWrite> = {},
): PrivateJsonDocumentWrite {
  return {
    root,
    targetPath,
    stagePrefix: ".doc",
    label: "Doc",
    contents: "{\"next\":true}",
    openFile: (path, flags, mode) => open(path, flags, mode),
    rename,
    ...overrides,
  };
}

describe("writePrivateJsonDocument", () => {
  it("replaces the target through an exclusive 0600 prefixed stage", async () => {
    const { root, targetPath } = await documentRoot();
    const opened: Array<{ path: string; flags: number; mode: number }> = [];
    await writePrivateJsonDocument(request(root, targetPath, {
      openFile: (path, flags, mode) => {
        opened.push({ path, flags, mode });
        return open(path, flags, mode);
      },
    }));

    expect(await readFile(targetPath, "utf8")).toBe("{\"next\":true}");
    expect(await readdir(root)).toEqual(["doc.json"]);
    expect(opened).toHaveLength(1);
    expect(opened[0]!.path).toMatch(/[/\\]\.doc\.[0-9a-f-]{36}\.stage$/);
    expect(opened[0]!.flags & (constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY))
      .toBe(constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
    expect(opened[0]!.mode).toBe(0o600);
    if (process.platform !== "win32") expect((await stat(targetPath)).mode & 0o777).toBe(0o600);
  });

  it.each([
    ["stage write", { writeStage: async () => { throw new Error("injected write failure"); } }],
    ["rename", { rename: async () => { throw new Error("injected rename failure"); } }],
  ] as const)("removes its own stage and keeps the target when %s fails", async (_step, overrides) => {
    const { root, targetPath } = await documentRoot();
    await expect(writePrivateJsonDocument(request(root, targetPath, overrides))).rejects.toThrow(/injected/);
    expect(await readFile(targetPath, "utf8")).toBe("previous");
    expect(await readdir(root)).toEqual(["doc.json"]);
  });

  it("reports a stage close failure together with the write failure", async () => {
    const { root, targetPath } = await documentRoot();
    const failingHandle = {
      writeFile: async () => { throw new Error("injected write failure"); },
      sync: async () => undefined,
      close: async () => { throw new Error("injected close failure"); },
    } as unknown as FileHandle;
    const failure = await writePrivateJsonDocument(request(root, targetPath, {
      openFile: async () => failingHandle,
    })).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).message).toBe("Doc stage close failed");
    expect((failure as AggregateError).errors.map((error: Error) => error.message))
      .toEqual(["injected write failure", "injected close failure"]);
  });
});
