import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Project } from "@screenshot-studio/core/model";
import { resolveCanvasAction, runCanvasCommand } from "./canvas-commands.js";

function project(): Project {
  return {
    meta: { name: "Canvas", schemaVersion: 2 },
    mode: "isolated",
    platforms: ["apple"],
    locales: ["en"],
    fonts: [],
    screens: [{
      id: "hero",
      name: "Hero",
      platform: "apple",
      device: "iphone",
      locale: "en",
      direction: "ltr",
      artboard: { width: 100, height: 200 },
      background: { type: "solid", color: "#000000" },
      elements: [],
    }],
  };
}

async function projectFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "canvas-command-"));
  const path = join(directory, "app-store-screenshots.json");
  await writeFile(path, `${JSON.stringify(project(), null, 2)}\n`);
  return path;
}

describe("canvas commands", () => {
  it("parses show/set and rejects invalid modes", () => {
    expect(resolveCanvasAction(["mode"])).toEqual({ kind: "show" });
    expect(resolveCanvasAction(["mode", "connected"]))
      .toEqual({ kind: "set", mode: "connected" });
    expect(() => resolveCanvasAction(["mode", "free"])).toThrow(/isolated or connected/);
    expect(() => resolveCanvasAction(["list"])).toThrow(/canvas mode/);
  });

  it("shows and persists an explicit mode change", async () => {
    const path = await projectFile();
    await expect(runCanvasCommand(path, ["mode"])).resolves.toBe("Canvas mode: isolated");
    await expect(runCanvasCommand(path, ["mode", "connected"]))
      .resolves.toBe("Canvas mode: connected");
    expect(JSON.parse(await readFile(path, "utf8")).mode).toBe("connected");
  });

  it("refuses a lossy switch back to isolated without rewriting the file", async () => {
    const path = await projectFile();
    const connected = project();
    connected.mode = "connected";
    connected.screens[0]!.elements = [{
      id: "bridge", type: "shape", x: 90, y: 10, width: 20, height: 20,
      rotation: 0, opacity: 1, locked: false, visible: true,
      kind: "rect", fill: "#FF0000", radius: 0,
    }];
    const before = `${JSON.stringify(connected, null, 2)}\n`;
    await writeFile(path, before);

    await expect(runCanvasCommand(path, ["mode", "isolated"]))
      .rejects.toThrow(/bridge.*crosses/);
    await expect(readFile(path, "utf8")).resolves.toBe(before);
  });
});
