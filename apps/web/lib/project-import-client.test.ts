// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import {
  ProjectImportClientError,
  buildProjectImportForm,
  importProject,
  type BrowserProjectImportSource,
  type ProjectImportTransportOptions,
} from "./project-import-client.js";

function browserFile(name: string, contents: string, relativePath?: string): File {
  const file = new Blob([contents], { type: "application/octet-stream" }) as File;
  Object.defineProperties(file, {
    name: { value: name },
    webkitRelativePath: { value: relativePath ?? "" },
  });
  return file;
}

describe("project import client", () => {
  it("aligns browser folder files with their portable picker paths", () => {
    const form = buildProjectImportForm({
      kind: "folder",
      files: [
        browserFile("app-store-screenshots.json", "{}", "Selected/app-store-screenshots.json"),
        browserFile("hero.png", "image", "Selected/screenshots/hero.png"),
      ],
    });

    expect(form.get("kind")).toBe("folder");
    expect(form.getAll("paths")).toEqual([
      "Selected/app-store-screenshots.json",
      "Selected/screenshots/hero.png",
    ]);
    expect(form.getAll("files")).toHaveLength(2);
  });

  it("requires exactly one ZIP or JSON file", () => {
    const one = browserFile("project.zip", "zip");
    expect(buildProjectImportForm({ kind: "archive", file: one }).getAll("paths"))
      .toEqual(["project.zip"]);
    expect(() => buildProjectImportForm({ kind: "folder", files: [] }))
      .toThrow("at least one file");
    expect(() => buildProjectImportForm({ kind: "json", file: null as never }))
      .toThrow("exactly one file");
  });

  it("propagates cancellation and the upload-complete lifecycle to transport", async () => {
    const controller = new AbortController();
    const onUploadComplete = vi.fn();
    const transport = vi.fn(async (
      _form: FormData,
      options: ProjectImportTransportOptions,
    ) => {
      expect(options.signal).toBe(controller.signal);
      options.onUploadComplete?.();
      return Response.json({
        project: {
          sessionId: "session",
          name: "Imported",
          sourceKind: "managed-project",
          capabilities: {},
        },
      }, { status: 201 });
    });
    const source: BrowserProjectImportSource = {
      kind: "json",
      file: browserFile("project.json", "{}"),
    };

    await expect(importProject(source, {
      signal: controller.signal,
      onUploadComplete,
      transport,
    })).resolves.toMatchObject({ name: "Imported" });
    expect(onUploadComplete).toHaveBeenCalledOnce();
  });

  it("returns typed missing-resource errors for retry guidance", async () => {
    const transport = vi.fn(async () => Response.json({
      error: "Choose Folder or ZIP",
      code: "missing-resources",
      missingResources: ["screenshots/hero.png"],
    }, { status: 422 }));

    const operation = importProject({
      kind: "json",
      file: browserFile("project.json", "{}"),
    }, { transport });

    await expect(operation).rejects.toMatchObject({
      code: "missing-resources",
      missingResources: ["screenshots/hero.png"],
    });
    await expect(operation).rejects.toBeInstanceOf(ProjectImportClientError);
  });
});
