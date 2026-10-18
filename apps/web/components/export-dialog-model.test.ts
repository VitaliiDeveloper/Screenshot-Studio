// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { parseProject } from "@screenshot-studio/core/model";
import {
  buildBundleEntries,
  DEFAULT_STORE_SPECS,
  findStoreTarget,
  parseStoreSpecs,
} from "@screenshot-studio/core/export";
import {
  allExportChecks,
  checkedExportEntries,
  exportButtonLabel,
  exportFileCount,
  exportLocaleRows,
  exportPathPreview,
  exportScopeIssues,
  exportSelectionSummary,
  exportSizeRows,
  launchExportArtifactDownload,
  parseExportOutcome,
} from "./export-dialog-model.js";

const token = "a".repeat(43);

function environment() {
  const anchor = {
    href: "",
    download: "",
    click: vi.fn(),
    remove: vi.fn(),
  };
  return {
    anchor,
    value: {
      origin: "http://localhost",
      createAnchor: vi.fn(() => anchor),
      appendAnchor: vi.fn(),
    },
  };
}

describe("export dialog artifact download", () => {
  it("launches a same-origin native anchor download with the server-approved filename", () => {
    const { anchor, value } = environment();

    const ticket = launchExportArtifactDownload({
      downloadUrl: `/api/export/artifacts/${token}`,
      expiresAt: "2026-07-15T00:05:00.000Z",
      filename: "app-store-screenshots-bundle.zip",
    }, value);

    expect(ticket.filename).toBe("app-store-screenshots-bundle.zip");
    expect(anchor.href).toBe(`http://localhost/api/export/artifacts/${token}`);
    expect(anchor.download).toBe("app-store-screenshots-bundle.zip");
    expect(value.appendAnchor).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
  });

  it("accepts an absolute URL only when it has the current origin and strict artifact path", () => {
    const { value } = environment();
    expect(() => launchExportArtifactDownload({
      downloadUrl: `http://localhost/api/export/artifacts/${token}`,
      expiresAt: "2026-07-15T00:05:00.000Z",
      filename: "app-store-screenshots-bundle.zip",
    }, value)).not.toThrow();
  });

  it("uses the Web Share package filename returned by the export profile", () => {
    const { anchor, value } = environment();
    launchExportArtifactDownload({
      downloadUrl: `/api/export/artifacts/${token}`,
      expiresAt: "2026-07-15T00:05:00.000Z",
      filename: "web-share-package.zip",
    }, value);

    expect(anchor.download).toBe("web-share-package.zip");
  });

  it.each([
    ["cross-origin", `https://attacker.example/api/export/artifacts/${token}`],
    ["credentials", `http://user:secret@localhost/api/export/artifacts/${token}`],
    ["wrong path", `http://localhost/api/project/${token}`],
    ["invalid token", "http://localhost/api/export/artifacts/not-a-token"],
    ["query", `http://localhost/api/export/artifacts/${token}?path=/etc/passwd`],
    ["hash", `http://localhost/api/export/artifacts/${token}#fragment`],
    ["invalid URL", "http://["],
  ])("rejects a %s download URL", (_label, downloadUrl) => {
    const { value } = environment();
    expect(() => launchExportArtifactDownload({
      downloadUrl,
      expiresAt: "2026-07-15T00:05:00.000Z",
      filename: "app-store-screenshots-bundle.zip",
    }, value)).toThrow(/download URL/i);
    expect(value.createAnchor).not.toHaveBeenCalled();
  });

  it("rejects malformed ticket metadata before creating an anchor", () => {
    const { value } = environment();
    expect(() => launchExportArtifactDownload({
      downloadUrl: `/api/export/artifacts/${token}`,
      expiresAt: "not-a-date",
      filename: "unsafe.html",
    }, value)).toThrow(/artifact ticket/i);
    expect(value.createAnchor).not.toHaveBeenCalled();
  });

  it("removes the temporary anchor even when the native click throws", () => {
    const { anchor, value } = environment();
    anchor.click.mockImplementation(() => { throw new Error("click failed"); });

    expect(() => launchExportArtifactDownload({
      downloadUrl: `/api/export/artifacts/${token}`,
      expiresAt: "2026-07-15T00:05:00.000Z",
      filename: "app-store-screenshots-bundle.zip",
    }, value)).toThrow("click failed");
    expect(anchor.remove).toHaveBeenCalledOnce();
  });
});

describe("export dialog store image selection", () => {
  const specs = parseStoreSpecs(JSON.parse(readFileSync("store-specs.json", "utf8")));
  const base = {
    name: "Hero",
    direction: "ltr",
    background: { type: "solid", color: "#101827" },
    elements: [],
  };
  const project = parseProject({
    meta: { name: "Selection", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "main",
    layouts: [{
      id: "main",
      name: "Main",
      mode: "isolated",
      screens: [
        { ...base, id: "en-iphone", platform: "apple", device: "iphone", locale: "en", artboard: { width: 1206, height: 2622 } },
        { ...base, id: "en-iphone-69", platform: "apple", device: "iphone", locale: "en", storeTargetId: "6.9", artboard: { width: 1320, height: 2868 } },
        { ...base, id: "uk-iphone", platform: "apple", device: "iphone", locale: "uk", artboard: { width: 1206, height: 2622 } },
        { ...base, id: "en-phone", name: "Phone", platform: "android", device: "phone", locale: "en", artboard: { width: 1080, height: 1920 } },
      ],
    }],
  });
  const entries = buildBundleEntries(project, "main", specs);
  const all = allExportChecks(entries);

  it("lists each exact size with its pixel target from store-specs.json", () => {
    const rows = exportSizeRows(entries, all, [], specs);

    expect(rows.map((row) => row.key)).toEqual(["apple/iphone/6.3", "apple/iphone/6.9", "android/phone/phone-portrait"]);
    for (const row of rows) {
      const [platform, device, sizeId] = row.key.split("/") as [string, string, string];
      const target = findStoreTarget(specs, platform, device, sizeId);
      expect([row.width, row.height]).toEqual([target.width, target.height]);
    }
    expect(rows[1]).toMatchObject({ label: 'App Store · iPhone 6.9" · Portrait', width: 1320, height: 2868, files: 1 });
    expect(rows[0]!.files).toBe(2);
  });

  it("previews the real bundle path of the checked files", () => {
    const checks = { sizes: new Set(["apple/iphone/6.3"]), locales: new Set(["uk"]) };
    const checked = checkedExportEntries(entries, checks);

    expect(checked.map((entry) => entry.relativePath))
      .toEqual(buildBundleEntries(project, "main", specs, { locale: "uk" }).map((entry) => entry.relativePath));
    expect(exportPathPreview(checkedExportEntries(entries, all))).toEqual([
      "apple/iphone/locale-en/size-6.3/01-hero-6.3.png",
      "apple/iphone/locale-en/size-6.9/01-hero-6.9.png",
      "apple/iphone/locale-uk/size-6.3/01-hero-6.3.png",
    ]);
    expect(exportSelectionSummary(checked)).toBe("1 file · 1 size × 1 locale");
    expect(exportSelectionSummary(checkedExportEntries(entries, all))).toBe("4 files · 3 sizes × 2 locales");
  });

  it("counts a locale's files for the checked sizes and its missing screens", () => {
    const checks = { sizes: new Set(["apple/iphone/6.3"]), locales: all.locales };
    const missing = {
      kind: "missing-locale-screen", id: "m", level: "blocker", layoutId: "main",
      locale: "uk", sourceLocale: "en", sourceScreenId: "en-iphone-69", allSizes: false,
    } as const;

    expect(exportLocaleRows(entries, checks, [missing])).toEqual([
      { locale: "en", files: 1, missingScreens: 0 },
      { locale: "uk", files: 1, missingScreens: 1 },
    ]);
  });

  it("keeps only the issues of the checked sizes and locales", () => {
    const missingLocale = {
      kind: "missing-locale-screen", id: "m", level: "blocker", layoutId: "main",
      locale: "uk", sourceLocale: "en", sourceScreenId: "en-iphone-69", allSizes: false,
    } as const;
    const missingImage = {
      kind: "missing-image", id: "i", level: "blocker", layoutId: "main",
      screenId: "en-phone", elementId: null, assetUrl: "assets/hero.png",
    } as const;
    const overflow = {
      kind: "text-overflow", id: "t", level: "warning", layoutId: "main", screenId: "en-iphone", elementId: "title",
    } as const;
    const issues = [missingLocale, missingImage, overflow];

    expect(exportScopeIssues(entries, all, issues)).toEqual(issues);
    expect(exportScopeIssues(entries, { sizes: all.sizes, locales: new Set(["en"]) }, issues))
      .toEqual([missingImage, overflow]);
    expect(exportScopeIssues(entries, { sizes: new Set(["apple/iphone/6.3"]), locales: all.locales }, issues))
      .toEqual([overflow]);
    expect(exportScopeIssues(entries, { sizes: new Set(["apple/iphone/6.3"]), locales: all.locales }, [
      { ...missingLocale, allSizes: true },
    ])).toHaveLength(1);
    expect(exportSizeRows(entries, all, issues, specs).map(({ blockers, warnings }) => [blockers, warnings]))
      .toEqual([[0, 1], [0, 0], [1, 0]]);
  });

  it("reads the finished export's counts and failed files defensively", () => {
    const failure = { screenId: "uk-iphone", relativePath: "apple/iphone/locale-uk/size-6.3/01-hero-6.3.png", message: "boom" };

    expect(parseExportOutcome({ written: 3, total: 4, stopped: false, failures: [failure, { screenId: 1 }] }, 4))
      .toEqual({ written: 3, total: 4, stopped: false, failures: [failure] });
    expect(parseExportOutcome({}, 4)).toEqual({ written: 4, total: 4, stopped: false, failures: [] });
    expect(parseExportOutcome({ written: 9, total: 2, stopped: true }, 4)).toMatchObject({ written: 2, stopped: true });
  });

  it("remounts selection and result state whenever the active layout changes", () => {
    const source = readFileSync(new URL("./toolbar/Toolbar.tsx", import.meta.url), "utf8");

    expect(source).toContain('key={activeLayout?.id ?? "no-layout"}');
  });
});

describe("export file count", () => {
  const sample = parseProject(JSON.parse(readFileSync("fixtures/sample/app-store-screenshots.json", "utf8")));

  it("counts one file per screen in the store bundle with default filters", () => {
    expect(exportFileCount(sample, "default", DEFAULT_STORE_SPECS)).toBe(6);
  });

  it("returns null without a project or layout, or when the bundle cannot be built", () => {
    expect(exportFileCount(null, "default", DEFAULT_STORE_SPECS)).toBeNull();
    expect(exportFileCount(sample, null, DEFAULT_STORE_SPECS)).toBeNull();
    expect(exportFileCount(sample, "missing-layout", DEFAULT_STORE_SPECS)).toBeNull();
  });

  it("names the button with the count", () => {
    expect(exportButtonLabel(null)).toBe("Export");
    expect(exportButtonLabel(1)).toBe("Export, 1 file");
    expect(exportButtonLabel(12)).toBe("Export, 12 files");
  });
});
