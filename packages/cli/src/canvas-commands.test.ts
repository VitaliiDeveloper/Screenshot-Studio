// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Project } from "@screenshot-studio/core/model";
import type { ProjectLockOptions } from "@screenshot-studio/core/storage";
import {
  loadProjectFile,
  loadProjectSnapshot,
  updateProjectFile,
} from "./project-io.js";
import { resolveCanvasAction, runCanvasCommand } from "./canvas-commands.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function controlledLockWait(): {
  options: ProjectLockOptions;
  didWait: Promise<void>;
  release: () => void;
} {
  let markWait!: () => void;
  const didWait = new Promise<void>((resolve) => { markWait = resolve; });
  const waiters: Array<() => void> = [];
  return {
    didWait,
    options: {
      timeoutMs: 500,
      staleAfterMs: 10_000,
      dependencies: {
        sleep: () => {
          markWait();
          return new Promise<void>((resolve) => waiters.push(resolve));
        },
        scheduleHeartbeat: () => () => undefined,
      },
    },
    release: () => { waiters.splice(0).forEach((resolve) => resolve()); },
  };
}

function project(): Project {
  return {
    meta: { name: "Canvas", schemaVersion: 1 },
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
  temporaryRoots.push(directory);
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

  it("keeps exact bytes and revision when setting the active mode", async () => {
    const path = await projectFile();
    const exactBytes = `${JSON.stringify(project())}  \n`;
    await writeFile(path, exactBytes);
    const before = await loadProjectSnapshot(path);

    await expect(runCanvasCommand(path, ["mode", "isolated"]))
      .resolves.toBe("Canvas mode: isolated");

    expect(await readFile(path, "utf8")).toBe(exactBytes);
    expect((await loadProjectSnapshot(path)).revision).toBe(before.revision);
  });

  it("queues mode mutation behind the project lease while show remains lock-free", async () => {
    const path = await projectFile();
    let releaseHeld!: () => void;
    const heldMayFinish = new Promise<void>((resolve) => { releaseHeld = resolve; });
    let heldEntered!: () => void;
    const heldDidEnter = new Promise<void>((resolve) => { heldEntered = resolve; });

    const held = updateProjectFile(path, async (current) => {
      heldEntered();
      await heldMayFinish;
      return {
        project: { ...current, meta: { ...current.meta, name: "Held writer" } },
        value: undefined,
      };
    });
    const heldOutcome = held.then(
      () => ({ status: "fulfilled" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    await heldDidEnter;
    await expect(runCanvasCommand(path, ["mode"])).resolves.toBe("Canvas mode: isolated");

    const lockWait = controlledLockWait();
    const command = runCanvasCommand(path, ["mode", "connected"], lockWait.options);
    const commandOutcome = command.then(
      (value) => ({ status: "fulfilled" as const, value }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    const queueState = await Promise.race([
      lockWait.didWait.then(() => "waited" as const),
      commandOutcome.then(() => "settled" as const),
    ]);

    releaseHeld();
    const heldResult = await heldOutcome;
    lockWait.release();
    const commandResult = await commandOutcome;

    expect(queueState).toBe("waited");
    expect(heldResult.status).toBe("fulfilled");
    expect(commandResult.status).toBe("fulfilled");
    const saved = await loadProjectFile(path);
    expect(saved.meta.name).toBe("Held writer");
    expect(saved.mode).toBe("connected");
  });
});
