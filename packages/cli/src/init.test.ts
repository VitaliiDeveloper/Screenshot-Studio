// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseStoreSpecs } from "@screenshot-studio/core/export";
import {
  DEVICE_FRAME_IDS,
  parseProjectJson,
  SCREEN_DEVICES_BY_PLATFORM,
} from "@screenshot-studio/core/model";
import {
  createProjectScaffold,
  projectScaffoldFiles,
  recommendedDeviceForPlatform,
} from "@screenshot-studio/core/scaffold";
import { runInit } from "./init.js";

const storeSpecs = parseStoreSpecs(JSON.parse(
  await readFile(new URL("../../../store-specs.json", import.meta.url), "utf8"),
));

function parseGuideContract(source: string, contract: string): string[] {
  const start = `<!-- ${contract}:START -->`;
  const end = `<!-- ${contract}:END -->`;
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);
  expect(startIndex, `missing ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing ${end}`).toBeGreaterThan(startIndex);
  expect(source.lastIndexOf(start), `duplicate ${start}`).toBe(startIndex);
  expect(source.lastIndexOf(end), `duplicate ${end}`).toBe(endIndex);

  const boundedSection = source.slice(startIndex + start.length, endIndex).trim();
  const match = /^```text\n([\s\S]*?)\n```$/.exec(boundedSection);
  expect(match, `${contract} must contain exactly one bounded text block`).not.toBeNull();
  return match![1]!.split("\n");
}

const captureDestinationPaths = Object.entries(SCREEN_DEVICES_BY_PLATFORM)
  .flatMap(([platform, devices]) => devices.map(
    (device) => `screenshots/${platform}/${device}/{locale}/NN.png`,
  ));

describe("runInit", () => {
  it("creates a valid project, standard directories, and agent workflow guides", async () => {
    const dir = await mkdtemp(join(tmpdir(), "screenshot-studio-init-"));

    await runInit(dir, "Launch Deck", storeSpecs);

    const bytes = await readFile(join(dir, "app-store-screenshots.json"), "utf8");
    const raw = JSON.parse(bytes) as Record<string, unknown>;
    const project = parseProjectJson(bytes);
    expect(project.meta.name).toBe("Launch Deck");
    expect(Object.keys(raw).sort()).toEqual(["fonts", "layouts", "meta", "preferredExportLayoutId"]);
    expect(project).toMatchObject({ preferredExportLayoutId: "default", meta: { schemaVersion: 1 } });
    expect(project.layouts[0]).toMatchObject({ id: "default", name: "Default", mode: "isolated" });
    expect(project.layouts[0]!.screens).toHaveLength(1);
    expect(project.layouts[0]!.screens[0]!.artboard).toEqual({ width: 1206, height: 2622 });
    expect(bytes).toBe(new TextDecoder().decode(projectScaffoldFiles(createProjectScaffold({
      name: "Launch Deck",
      platform: "apple",
      device: recommendedDeviceForPlatform("apple"),
      layoutMode: "isolated",
      templateId: null,
    }, storeSpecs))[0]!.bytes));

    for (const path of [
      "screenshots/apple/iphone/en",
      "assets/fonts",
      "assets/icons",
      "themes",
      "templates",
      "export",
    ]) {
      expect((await stat(join(dir, path))).isDirectory()).toBe(true);
    }

    const agentGuide = await readFile(join(dir, "AGENTS.md"), "utf8");
    const sourceAgentGuide = await readFile(new URL("./project-agent-guide.md", import.meta.url), "utf8");
    expect(agentGuide).toBe(sourceAgentGuide);
    expect(parseGuideContract(agentGuide, "DEVICE_FRAME_IDS")).toEqual(DEVICE_FRAME_IDS);
    expect(parseGuideContract(agentGuide, "SCREEN_CAPTURE_DESTINATIONS")).toEqual(captureDestinationPaths);
    expect(agentGuide).toContain("strict v1 JSON");
    expect(agentGuide).toContain("mode: isolated | connected");
    expect(agentGuide).toContain("platform/device/locale/`storeTargetId` group");
    expect(agentGuide).toContain("must not be mistaken for duplicate roots");
    expect(agentGuide).toContain("RGB or alpha-bearing RGBA fallback/letterbox `color`");
    expect(agentGuide).toContain("## Recipe: generate or refresh copy");
    expect(agentGuide).toContain("## Recipe: lay out slides");
    expect(agentGuide).toContain("## Recipe: translate a locale");
    expect(agentGuide).toContain("screenshots locale add ar --from en --direction rtl");
    expect(agentGuide).toContain("## Recipe: import PNG captures");
    expect(agentGuide).toContain('screenshots import . --layout "Feature campaign"');
    expect(agentGuide).toMatch(/commits Project plus\s+copied resources atomically/);
    expect(agentGuide).toContain("## Recipe: choose a style");
    expect(agentGuide).toContain("screenshots template add <pack-id> --pack --locale <locale>");
    expect(agentGuide).toContain("screenshots theme set <design-pack-id> --built-in");
    expect(agentGuide).toContain("## Recipe: process a local asset");
    expect(agentGuide).toContain("screenshots asset auto-crop");
    expect(agentGuide).toContain("screenshots asset remove-background");

    await expect(readFile(join(dir, "CLAUDE.md"), "utf8")).resolves.toContain("@AGENTS.md");
  });

  it("uses the runtime catalog recommendation for the project and capture directory", async () => {
    const customSpecs = structuredClone(storeSpecs);
    Object.assign(customSpecs.platforms.apple.families.iphone, { recommended: false });
    Object.assign(customSpecs.platforms.apple.families.ipad, { recommended: true });
    const dir = await mkdtemp(join(tmpdir(), "screenshot-studio-init-custom-catalog-"));

    await runInit(dir, "Tablet launch", customSpecs);

    const project = parseProjectJson(await readFile(join(dir, "app-store-screenshots.json"), "utf8"));
    expect(project.layouts[0]!.screens[0]).toMatchObject({ platform: "apple", device: "ipad" });
    expect((await stat(join(dir, "screenshots/apple/ipad/en"))).isDirectory()).toBe(true);
  });

  it("keeps the connected-launch guide exhaustive over strict device-frame ids", async () => {
    const guide = await readFile(
      new URL("../../../examples/connected-launch/AGENTS.md", import.meta.url),
      "utf8",
    );

    expect(parseGuideContract(guide, "DEVICE_FRAME_IDS")).toEqual(DEVICE_FRAME_IDS);
  });

  it("refuses to overwrite an existing agent control file before writing the project", async () => {
    const dir = await mkdtemp(join(tmpdir(), "screenshot-studio-init-conflict-"));
    const existingGuide = "# Existing project instructions\n";
    await writeFile(join(dir, "AGENTS.md"), existingGuide, "utf8");

    await expect(runInit(dir, undefined, storeSpecs)).rejects.toThrow(/Refusing to overwrite existing .*AGENTS\.md/);
    await expect(readFile(join(dir, "AGENTS.md"), "utf8")).resolves.toBe(existingGuide);
    await expect(readFile(join(dir, "app-store-screenshots.json"), "utf8")).rejects.toThrow();
  });

  it("keeps the existing project-file overwrite guard", async () => {
    const dir = await mkdtemp(join(tmpdir(), "screenshot-studio-init-project-conflict-"));
    const existingProject = "{}\n";
    await writeFile(join(dir, "app-store-screenshots.json"), existingProject, "utf8");

    await expect(runInit(dir, undefined, storeSpecs)).rejects.toThrow(/Refusing to overwrite existing .*app-store-screenshots\.json/);
    await expect(readFile(join(dir, "app-store-screenshots.json"), "utf8")).resolves.toBe(existingProject);
    await expect(readFile(join(dir, "AGENTS.md"), "utf8")).rejects.toThrow();
  });
});
