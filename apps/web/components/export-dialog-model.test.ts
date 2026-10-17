// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { parseProject } from "@screenshot-studio/core/model";
import { DEFAULT_STORE_SPECS } from "@screenshot-studio/core/export";
import {
  DEFAULT_EXPORT_FILTERS,
  exportButtonLabel,
  exportFileCount,
  launchExportArtifactDownload,
  normalizeExportFilters,
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

describe("export dialog layout filters", () => {
  const layout = parseProject({
    meta: { name: "Android only", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "android",
    layouts: [{
      id: "android",
      name: "Android",
      mode: "isolated",
      screens: [{
        id: "hero",
        name: "Hero",
        platform: "android",
        device: "phone",
        locale: "uk",
        direction: "ltr",
        artboard: { width: 1080, height: 1920 },
        background: { type: "solid", color: "#101827" },
        elements: [],
      }],
    }],
  }).layouts[0]!;

  it("drops stale filters that do not exist in the active layout", () => {
    expect(normalizeExportFilters(layout, {
      platform: "apple",
      device: "iphone",
      locale: "en",
    })).toEqual(DEFAULT_EXPORT_FILTERS);
  });

  it("drops a locale that exists in the layout but not for the selected platform and device", () => {
    const mixed = parseProject({
      meta: { name: "Mixed", schemaVersion: 1 },
      fonts: [],
      preferredExportLayoutId: "mixed",
      layouts: [{
        id: "mixed",
        name: "Mixed",
        mode: "isolated",
        screens: [
          layout.screens[0],
          { ...layout.screens[0], id: "iphone", platform: "apple", device: "iphone", locale: "en" },
        ],
      }],
    }).layouts[0]!;

    expect(normalizeExportFilters(mixed, {
      platform: "android",
      device: "phone",
      locale: "en",
    })).toEqual({ platform: "android", device: "phone", locale: "all" });
  });

  it("remounts filter and result state whenever the active layout changes", () => {
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
