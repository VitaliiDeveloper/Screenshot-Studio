// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseProject, type Project } from "@screenshot-studio/core/model";
import {
  formatLayoutList,
  resolveLayoutAction,
  resolveMutationLayout,
  runLayoutCommand,
} from "./layout-commands.js";

it("exports layout CLI parsing, formatting, and persistence", async () => {
  const commands = await import("./layout-commands.js").catch(() => ({}));

  expect(commands).toEqual(expect.objectContaining({
    resolveLayoutAction: expect.any(Function),
    formatLayoutList: expect.any(Function),
    resolveMutationLayout: expect.any(Function),
    runLayoutCommand: expect.any(Function),
  }));
});

function project(): Project {
  return parseProject({
    meta: { name: "Layouts", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "launch",
    layouts: [{
      id: "launch",
      name: "Launch Campaign",
      mode: "isolated",
      screens: [{
        id: "hero",
        name: "Hero",
        platform: "apple",
        device: "iphone",
        locale: "en",
        direction: "rtl",
        artboard: { width: 1320, height: 2868 },
        background: { type: "linear-gradient", from: "#112233", to: "#445566", angle: 90 },
        elements: [],
      }],
    }],
  });
}

describe("layout command parsing", () => {
  it("parses the approved lifecycle forms", () => {
    expect(resolveLayoutAction(["list"], {})).toEqual({ kind: "list" });
    expect(resolveLayoutAction(["add", "Feature Focus"], { mode: "isolated" })).toEqual({
      kind: "add", name: "Feature Focus", mode: "isolated",
    });
    expect(resolveLayoutAction(["duplicate", "Launch Campaign"], { name: "Launch Copy" })).toEqual({
      kind: "duplicate", reference: "Launch Campaign", name: "Launch Copy",
    });
    expect(resolveLayoutAction(["rename", "Launch Campaign", "App Store Launch"], {})).toEqual({
      kind: "rename", reference: "Launch Campaign", name: "App Store Launch",
    });
    expect(resolveLayoutAction(["prefer", "Launch Campaign"], {})).toEqual({
      kind: "prefer", reference: "Launch Campaign",
    });
    expect(resolveLayoutAction(["mode", "Launch Campaign"], { mode: "connected" })).toEqual({
      kind: "mode", reference: "Launch Campaign", mode: "connected",
    });
    expect(resolveLayoutAction(["rm", "Launch Campaign"], {})).toEqual({
      kind: "rm", reference: "Launch Campaign",
    });
  });

  it("requires a valid mode for add and mode changes", () => {
    expect(() => resolveLayoutAction(["add", "Feature"], {})).toThrow("layout add requires --mode");
    expect(() => resolveLayoutAction(["add", "Feature"], { mode: "other" })).toThrow(
      "Layout mode must be isolated or connected",
    );
    expect(() => resolveLayoutAction(["mode", "Feature"], {})).toThrow(
      "layout mode requires --mode",
    );
  });
});

describe("layout mutation selection", () => {
  it("infers the only layout and requires --layout when multiple exist", () => {
    expect(resolveMutationLayout(project()).id).toBe("launch");
    const multiple = parseProject({
      ...project(),
      layouts: [
        ...project().layouts,
        { ...structuredClone(project().layouts[0]!), id: "feature", name: "Feature" },
      ],
    });
    expect(() => resolveMutationLayout(multiple)).toThrow(
      "This project has multiple layouts; pass --layout <id-or-name>",
    );
    expect(resolveMutationLayout(multiple, "Feature").id).toBe("feature");
  });
});

describe("runLayoutCommand", () => {
  it("persists add, duplicate, rename, prefer, and remove in array order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "layout-command-"));
    const path = join(dir, "app-store-screenshots.json");
    await writeFile(path, `${JSON.stringify(project(), null, 2)}\n`);

    await runLayoutCommand(path, ["add", "Feature Focus"], { mode: "connected" });
    let persisted = parseProject(JSON.parse(await readFile(path, "utf8")));
    const added = persisted.layouts[1]!;
    expect(added).toMatchObject({ name: "Feature Focus", mode: "connected" });
    expect(added.screens).toHaveLength(1);
    expect(added.screens[0]).toMatchObject({
      platform: "apple",
      device: "iphone",
      locale: "en",
      direction: "rtl",
      artboard: { width: 1320, height: 2868 },
      background: { type: "solid", color: "#101827" },
      elements: [],
    });

    await runLayoutCommand(path, ["duplicate", "Launch Campaign"], { name: "Launch Copy" });
    persisted = parseProject(JSON.parse(await readFile(path, "utf8")));
    expect(persisted.layouts.map((layout) => layout.name)).toEqual([
      "Launch Campaign", "Launch Copy", "Feature Focus",
    ]);

    await runLayoutCommand(path, ["rename", "Launch Copy", "App Store Launch"], {});
    await runLayoutCommand(path, ["mode", "App Store Launch"], { mode: "connected" });
    await runLayoutCommand(path, ["prefer", "App Store Launch"], {});
    await runLayoutCommand(path, ["rm", "Feature Focus"], {});
    persisted = parseProject(JSON.parse(await readFile(path, "utf8")));
    expect(persisted.layouts.map((layout) => layout.name)).toEqual([
      "Launch Campaign", "App Store Launch",
    ]);
    expect(persisted.preferredExportLayoutId).toBe(persisted.layouts[1]!.id);
    expect(persisted.layouts[1]!.mode).toBe("connected");
    expect(formatLayoutList(persisted)).toContain("preferred");
  });
});
