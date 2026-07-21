// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import {
  applyCaptureImport,
  buildCaptureImportForm,
  previewCaptureImport,
  CaptureImportClientError,
  type CaptureImportTransport,
} from "@web/lib/capture-import-client.js";

function captureFile(path: string, contents = "png"): File {
  const file = new File([contents], path.split("/").at(-1)!, { type: "image/png" });
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

const currentDestination = {
  kind: "current-project" as const,
  projectId: "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  revision: `"${"1".repeat(64)}"`,
  projectName: "Current",
  layoutId: "primary",
};
const newDestination = {
  kind: "new-project" as const,
  name: "Captured launch",
  platform: "apple" as const,
  layoutMode: "connected" as const,
  templateId: null,
};
const preview = {
  receiving: { kind: "current-project" as const, projectName: "Current", layoutId: "primary", layoutName: "Primary" },
  summary: {
    screenCount: 1,
    assetCount: 0,
    platforms: [{ id: "apple", count: 1 }],
    devices: [{ id: "apple/iphone", count: 1 }],
    locales: [{ id: "en", count: 1 }],
  },
  screens: [{
    sourcePath: "screenshots/apple/iphone/en/01.png",
    screenId: "apple-iphone-en-01",
    elementId: "apple-iphone-en-01-screenshot",
    resourcePath: "assets/imports/apple-iphone-en-01-aabbccddeeff.png",
    platform: "apple" as const,
    device: "iphone" as const,
    locale: "en",
    width: 1320,
    height: 2868,
  }],
  resources: [{
    sourcePath: "screenshots/apple/iphone/en/01.png",
    destinationPath: "assets/imports/apple-iphone-en-01-aabbccddeeff.png",
    digest: "2".repeat(64),
  }],
  warnings: [],
  invalidEntries: [],
  canApply: true,
  confirmationFingerprint: "3".repeat(64),
};

describe("capture import client", () => {
  it("preserves browser-relative capture paths and strict current destination fields", () => {
    const form = buildCaptureImportForm({
      files: [
        captureFile("Selected/screenshots/apple/iphone/en/01.png"),
        captureFile("Selected/assets/icon.png", "asset"),
      ],
      destination: currentDestination,
    });

    expect(form.getAll("paths")).toEqual([
      "Selected/screenshots/apple/iphone/en/01.png",
      "Selected/assets/icon.png",
    ]);
    expect(form.get("destinationKind")).toBe("current-project");
    expect(form.get("layoutId")).toBe("primary");
    expect(form.has("name")).toBe(false);
    expect(form.has("projectId")).toBe(false);
  });

  it("previews with project and revision fences but never submits client-planned IDs", async () => {
    const transport = vi.fn<CaptureImportTransport>(async (endpoint, form, init) => {
      expect(endpoint).toBe("/api/capture-import/preview");
      expect(init.headers).toEqual(expect.objectContaining({
        "x-project-id": currentDestination.projectId,
        "if-match": currentDestination.revision,
      }));
      expect(form.has("confirmationFingerprint")).toBe(false);
      expect(form.has("screenId")).toBe(false);
      return Response.json({ preview });
    });

    await expect(previewCaptureImport({
      files: [captureFile("screenshots/apple/iphone/en/01.png")],
      destination: currentDestination,
    }, { transport })).resolves.toEqual(preview);
    expect(transport).toHaveBeenCalledOnce();
  });

  it("submits strict new-project scaffold fields and only the server confirmation on apply", async () => {
    const transport = vi.fn<CaptureImportTransport>(async (endpoint, form, init) => {
      expect(endpoint).toBe("/api/capture-import/apply");
      expect(init.headers).toBeUndefined();
      expect(form.get("name")).toBe("Captured launch");
      expect(form.get("platform")).toBe("apple");
      expect(form.get("layoutMode")).toBe("connected");
      expect(form.get("templateId")).toBe("");
      expect(form.get("confirmationFingerprint")).toBe(preview.confirmationFingerprint);
      return Response.json({
        project: {
          sessionId: "new-session",
          name: "Captured launch",
          sourceKind: "managed-project",
          capabilities: {},
        },
        imported: 1,
      }, { status: 201, headers: { "x-project-id": "project_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" } });
    });

    await expect(applyCaptureImport({
      files: [captureFile("screenshots/apple/iphone/en/01.png")],
      destination: newDestination,
    }, preview.confirmationFingerprint, { transport })).resolves.toMatchObject({
      projectId: "project_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      project: { sessionId: "new-session", name: "Captured launch" }, imported: 1,
    });
  });

  it("preserves actionable stale and validation errors and rejects malformed success", async () => {
    await expect(previewCaptureImport({
      files: [captureFile("screenshots/apple/iphone/en/01.png")],
      destination: currentDestination,
    }, {
      transport: async () => Response.json({ error: "Project changed", code: "preview-changed" }, {
        status: 409,
      }),
    })).rejects.toEqual(expect.objectContaining({
      message: "Project changed", code: "preview-changed", status: 409,
    }));
    await expect(previewCaptureImport({
      files: [captureFile("screenshots/apple/iphone/en/01.png")],
      destination: currentDestination,
    }, { transport: async () => Response.json({ preview: { canApply: true } }) }))
      .rejects.toBeInstanceOf(CaptureImportClientError);
    await expect(applyCaptureImport({
      files: [captureFile("screenshots/apple/iphone/en/01.png")],
      destination: newDestination,
    }, preview.confirmationFingerprint, {
      transport: async () => Response.json({
        project: { sessionId: "session", name: "Receiver", sourceKind: "managed-project", capabilities: {} },
        imported: 1,
      }),
    })).rejects.toBeInstanceOf(CaptureImportClientError);
  });
});
