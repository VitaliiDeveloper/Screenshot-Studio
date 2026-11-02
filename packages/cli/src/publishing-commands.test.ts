// SPDX-License-Identifier: Apache-2.0
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runPublishingCommand } from "./publishing-commands.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function exampleProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "publishing-command-"));
  roots.push(root);
  const path = join(root, "app-store-screenshots.json");
  await copyFile(new URL("../../../examples/connected-launch/app-store-screenshots.json", import.meta.url), path);
  return path;
}

describe("runPublishingCommand", () => {
  it("sets, shows and clears store identifiers through the validated project write", async () => {
    const path = await exampleProject();
    const original = await readFile(path, "utf8");

    expect(await runPublishingCommand(path, [], {})).toBe("google packageName=(not set)\napple appId=(not set)");
    await runPublishingCommand(path, ["set"], { "google-package": "com.example.launch", "apple-app-id": "123" });
    expect(JSON.parse(await readFile(path, "utf8")).publishing)
      .toEqual({ google: { packageName: "com.example.launch" }, apple: { appId: "123" } });
    expect(await runPublishingCommand(path, ["show"], { json: "true" }))
      .toBe('{"apple":{"appId":"123"},"google":{"packageName":"com.example.launch"}}');

    await runPublishingCommand(path, ["clear", "google"], {});
    await runPublishingCommand(path, ["clear", "apple"], {});
    expect(await readFile(path, "utf8")).toBe(original);
  });

  it("rejects an invalid identifier without writing", async () => {
    const path = await exampleProject();
    const original = await readFile(path, "utf8");
    await expect(runPublishingCommand(path, ["set"], { "google-package": "../edits" })).rejects.toThrow(/package name/);
    await expect(runPublishingCommand(path, ["set"], {})).rejects.toThrow(/requires --google-package or --apple-app-id/);
    await expect(runPublishingCommand(path, ["clear", "amazon"], {})).rejects.toThrow(/clear <google\|apple>/);
    await expect(runPublishingCommand(path, ["show"], { "google-package": "com.example.app" }))
      .rejects.toThrow("--google-package applies only to publishing set");
    expect(await readFile(path, "utf8")).toBe(original);
  });
});
