// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { COMMAND_FLAG_SPECS, parseCommandFlags } from "./command-flags.js";
import { runCopyCommand } from "./copy-commands.js";
import { parseCsv, formatCsv } from "./csv.js";
import { runElementCommand } from "./element-commands.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const common = { rotation: 0, opacity: 1, locked: false, visible: true };
const text = (id: string, content: string, extra = {}) => ({
  id, type: "text", ...common, x: 40, y: 60, width: 500, height: 120, content,
  fontFamily: "Screenshot Studio Sans", size: 48, weight: 400, lineHeight: 1.2, letterSpacing: 0,
  align: "left", color: "#FFFFFF", ...extra,
});

function screen(id: string, locale: string, copy: [string, string], rtl = false) {
  const prefix = locale === "en" ? "" : `${locale}-`;
  return {
    id, name: id.split("-")[0], platform: "apple", device: "iphone", locale, direction: rtl ? "rtl" : "ltr",
    artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#111111" },
    elements: [
      text(`${prefix}title`, copy[0], rtl ? { x: 120, align: "right" } : {}),
      {
        id: `${prefix}badge`, type: "group", ...common, x: 10, y: 10, width: 200, height: 60,
        children: [text(`${prefix}badge-label`, copy[1], rtl ? { x: 8, align: "right" } : {})],
      },
      { id: `${prefix}mockup`, type: "device-frame", ...common, x: 0, y: 300, width: 300, height: 600, deviceType: "iphone", fit: "cover" },
    ],
  };
}

type TestScreen = ReturnType<typeof screen>;

async function fixture(extraScreens: TestScreen[] = []) {
  const dir = await mkdtemp(join(tmpdir(), "copy-command-"));
  roots.push(dir);
  const projectPath = join(dir, "app-store-screenshots.json");
  await writeFile(projectPath, JSON.stringify({
    meta: { name: "Copy", schemaVersion: 1 }, fonts: [], preferredExportLayoutId: "default",
    layouts: [{
      id: "default", name: "Default", mode: "isolated",
      screens: [
        screen("hero", "en", ["Track every run", "4.9 stars"]),
        screen("more", "en", ["Share it", "Top rated"]),
        screen("hero-de", "de", ["Verfolge jeden Lauf", "4,9 Sterne"]),
        screen("more-de", "de", ["Teile es", "Bestbewertet"]),
        screen("hero-ar", "ar", ["تتبع كل جري", "٤٫٩ نجوم"], true),
        screen("more-ar", "ar", ["شاركه", "الأعلى تقييمًا"], true),
        ...extraScreens,
      ],
    }],
  }));
  return { dir, projectPath, copyPath: (name: string) => join(dir, name) };
}

const read = (path: string) => readFile(path, "utf8");

async function exportCsv(projectPath: string, file: string, flags: Record<string, string> = {}) {
  await runCopyCommand(projectPath, ["export"], { out: file, ...flags });
  return parseCsv(await read(file));
}

describe("copy export", () => {
  it("lists every base-locale text layer, group children included, with each locale's current copy", async () => {
    const { projectPath, copyPath } = await fixture();
    const records = await exportCsv(projectPath, copyPath("copy.csv"));
    expect(records).toEqual([
      ["screen", "element", "source", "de", "ar"],
      ["hero", "title", "Track every run", "Verfolge jeden Lauf", "تتبع كل جري"],
      ["hero", "badge-label", "4.9 stars", "4,9 Sterne", "٤٫٩ نجوم"],
      ["more", "title", "Share it", "Teile es", "شاركه"],
      ["more", "badge-label", "Top rated", "Bestbewertet", "الأعلى تقييمًا"],
    ]);
  });

  it("narrows to the requested locales and reports JSON", async () => {
    const { projectPath, copyPath } = await fixture();
    const out = JSON.parse(await runCopyCommand(projectPath, ["export"], { out: copyPath("copy.json"), locale: "ar", json: "true" }));
    expect(out).toMatchObject({ layout: "default", base: "en", locales: ["ar"], rows: 4 });
    const table = JSON.parse(await read(copyPath("copy.json")));
    expect(table.rows[0]).toEqual({ screen: "hero", element: "title", source: "Track every run", text: { ar: "تتبع كل جري" } });
  });

  it.each([
    [{ out: "copy.txt" }, /must end in .csv or .json/],
    [{ out: "copy.csv", locale: "en" }, /base locale/],
    [{ out: "copy.csv", locale: "fr" }, /Unknown locale "fr"/],
    [{}, /requires --out/],
  ] as Array<[Record<string, string>, RegExp]>)("rejects %j", async (flags, message) => {
    const { projectPath, dir } = await fixture();
    await expect(runCopyCommand(projectPath, ["export"], flags.out ? { ...flags, out: join(dir, flags.out) } : flags))
      .rejects.toThrow(message);
  });
});

describe("copy import", () => {
  it("matches the same changes made with element set, leaving RTL geometry alone", async () => {
    const via = await fixture();
    const direct = await fixture();
    const records = await exportCsv(via.projectPath, via.copyPath("copy.csv"));
    records[1]![3] = "Laufe weiter";
    records[2]![4] = "٥ نجوم";
    records[3]![4] = "";
    await writeFile(via.copyPath("copy.csv"), formatCsv(records));
    const arBefore = JSON.parse(await read(via.projectPath)).layouts[0].screens[4];

    await expect(runCopyCommand(via.projectPath, ["import", via.copyPath("copy.csv")], {}))
      .resolves.toBe("Written 2, skipped 0, unchanged 5");
    await runElementCommand(direct.projectPath, ["set", "hero-de", "de-title"], { json: JSON.stringify({ content: "Laufe weiter" }) });
    await runElementCommand(direct.projectPath, ["set", "hero-ar", "ar-badge-label"], { json: JSON.stringify({ content: "٥ نجوم" }) });

    const imported = JSON.parse(await read(via.projectPath));
    expect(imported).toEqual(JSON.parse(await read(direct.projectPath)));
    const arAfter = imported.layouts[0].screens[4];
    const withoutCopy = (value: unknown) => JSON.parse(JSON.stringify(value, (key, item) => key === "content" ? undefined : item));
    expect(withoutCopy(arAfter)).toEqual(withoutCopy(arBefore));
    expect(arAfter.elements[1].children[0]).toMatchObject({ content: "٥ نجوم", x: 8, align: "right" });
  });

  it("round-trips copy with commas, quotes, and newlines through CSV", async () => {
    const { projectPath, copyPath } = await fixture();
    const awkward = 'Hello, "world"\nsecond line,';
    await runElementCommand(projectPath, ["text", "hero", "title", awkward], {});
    const records = await exportCsv(projectPath, copyPath("copy.csv"));
    expect(records[1]![2]).toBe(awkward);
    records[1]![3] = 'Hallo, "Welt"\r\nzweite Zeile,';
    await writeFile(copyPath("copy.csv"), formatCsv(records));
    await runCopyCommand(projectPath, ["import", copyPath("copy.csv")], {});
    expect((JSON.parse(await read(projectPath))).layouts[0].screens[2].elements[0].content).toBe('Hallo, "Welt"\r\nzweite Zeile,');
  });

  it("skips rows whose base text changed since export, and --force writes them", async () => {
    const { projectPath, copyPath } = await fixture();
    const records = await exportCsv(projectPath, copyPath("copy.csv"));
    records[1]![3] = "Neu";
    records[3]![3] = "Auch neu";
    await writeFile(copyPath("copy.csv"), formatCsv(records));
    await runElementCommand(projectPath, ["text", "hero", "title", "Run further"], {});

    const skipped = await runCopyCommand(projectPath, ["import", copyPath("copy.csv")], {});
    expect(skipped).toBe([
      "Skipped hero/title [de]: base text changed since export (use --force to write anyway)",
      "Written 1, skipped 1, unchanged 6",
    ].join("\n"));
    let project = JSON.parse(await read(projectPath));
    expect(project.layouts[0].screens[2].elements[0].content).toBe("Verfolge jeden Lauf");
    expect(project.layouts[0].screens[3].elements[0].content).toBe("Auch neu");

    const forced = JSON.parse(await runCopyCommand(projectPath, ["import", copyPath("copy.csv")], { force: "true", json: "true" }));
    expect(forced).toEqual({ written: 1, skipped: 0, unchanged: 7, warnings: [] });
    project = JSON.parse(await read(projectPath));
    expect(project.layouts[0].screens[2].elements[0].content).toBe("Neu");
  });

  it("errors on an unknown row key and writes nothing", async () => {
    const { projectPath, copyPath } = await fixture();
    const records = await exportCsv(projectPath, copyPath("copy.csv"));
    records[1]![3] = "Valid edit";
    records.push(["hero", "no-such-layer", "x", "y", ""], ["hero-de", "title", "x", "y", ""]);
    await writeFile(copyPath("copy.csv"), formatCsv(records));
    const before = await read(projectPath);
    await expect(runCopyCommand(projectPath, ["import", copyPath("copy.csv")], {}))
      .rejects.toThrow("Unknown base-locale text layers (nothing written): hero/no-such-layer, hero-de/title");
    expect(await read(projectPath)).toBe(before);
  });

  it("rejects unknown or base locale columns and malformed rows", async () => {
    const { projectPath, copyPath } = await fixture();
    const run = async (content: string, name = "bad.csv") => {
      await writeFile(copyPath(name), content);
      return runCopyCommand(projectPath, ["import", copyPath(name)], {});
    };
    await expect(run("screen,element,source,fr\r\nhero,title,Track every run,Cours\r\n")).rejects.toThrow('Unknown locale column "fr"');
    await expect(run("screen,element,source,en\r\n")).rejects.toThrow("base locale");
    await expect(run("screen,element,de\r\n")).rejects.toThrow(/header must start with/);
    await expect(run("screen,element,source,de\r\nhero,title\r\n")).rejects.toThrow(/row 2 has 2 columns; expected 4/);
  });

  it("skips a locale whose layer structure diverged instead of guessing", async () => {
    const { projectPath, copyPath } = await fixture();
    const project = JSON.parse(await read(projectPath));
    project.layouts[0].screens[2].elements.shift();
    await writeFile(projectPath, JSON.stringify(project));
    const records = await exportCsv(projectPath, copyPath("copy.csv"));
    expect(records[1]![3]).toBe("");
    records[1]![3] = "Laufe";
    await writeFile(copyPath("copy.csv"), formatCsv(records));
    await expect(runCopyCommand(projectPath, ["import", copyPath("copy.csv")], {})).resolves.toBe([
      "Skipped hero/title [de]: no matching text layer in de (layer structure differs)",
      "Written 0, skipped 1, unchanged 6",
    ].join("\n"));
  });

  it("round-trips the JSON format and keeps the file untouched when nothing changes", async () => {
    const { projectPath, copyPath } = await fixture();
    await runCopyCommand(projectPath, ["export"], { out: copyPath("copy.json") });
    const table = JSON.parse(await read(copyPath("copy.json")));
    table.rows[0].text.ar = "اجرِ أكثر";
    await writeFile(copyPath("copy.json"), JSON.stringify(table));
    const report = JSON.parse(await runCopyCommand(projectPath, ["import", copyPath("copy.json")], { json: "true" }));
    expect(report).toEqual({ written: 1, skipped: 0, unchanged: 7, warnings: [] });
    const written = await read(projectPath);
    await runCopyCommand(projectPath, ["import", copyPath("copy.json")], {});
    expect(await read(projectPath)).toBe(written);
  });

  it("shows usage for unknown subcommands and misplaced flags", async () => {
    const { projectPath } = await fixture();
    await expect(runCopyCommand(projectPath, ["wat"], {})).rejects.toThrow(/Usage: screenshots copy/);
    await expect(runCopyCommand(projectPath, ["import"], {})).rejects.toThrow(/Usage: screenshots copy/);
    await expect(runCopyCommand(projectPath, ["import", "x.csv"], { out: "y.csv" })).rejects.toThrow(/apply only to copy export/);
  });

  it("accepts its flags through the shared parser", () => {
    expect(parseCommandFlags(["import", "c.csv", "--force", "--json", "--layout", "default"], COMMAND_FLAG_SPECS.copy))
      .toEqual({ args: ["import", "c.csv"], flags: { force: "true", json: "true", layout: "default" } });
  });
});
