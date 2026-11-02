// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectRevision } from "@screenshot-studio/core/storage";
import RenderPage from "./page";

Object.assign(globalThis, { React });

const request = vi.hoisted(() => ({ host: "127.0.0.1:3000" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: request.host }) }));

const temporaryRoots: string[] = [];

afterEach(async () => {
  request.host = "127.0.0.1:3000";
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function projectFile(): Promise<{ path: string; revision: string }> {
  const root = await mkdtemp(join(tmpdir(), "render-page-revision-"));
  temporaryRoots.push(root);
  const path = join(root, "app-store-screenshots.json");
  const bytes = `${JSON.stringify({
    meta: { name: "Render", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "primary",
    layouts: [{
      id: "primary",
      name: "Primary",
      mode: "isolated",
      screens: [{
        id: "hero",
        name: "Hero",
        platform: "apple",
        device: "iphone",
        locale: "en",
        direction: "ltr",
        artboard: { width: 660, height: 1434 },
        background: { type: "solid", color: "#111111" },
        elements: [],
      }],
    }],
  })}\n`;
  await writeFile(path, bytes, "utf8");
  return { path, revision: projectRevision(bytes) };
}

describe("RenderPage project revision pin", () => {
  it("renders the exact requested project revision", async () => {
    const project = await projectFile();

    const result = await RenderPage({
      searchParams: Promise.resolve({
        project: project.path,
        screen: "hero",
        revision: project.revision,
      }),
    });

    expect(result.props.project.meta.name).toBe("Render");
    expect(result.props.layoutId).toBe("primary");
    expect(result.props.screenId).toBe("hero");
    expect(result.props.projectPath).toBe(await realpath(project.path));
  });

  it("fails fast instead of rendering a different on-disk revision", async () => {
    const project = await projectFile();

    const result = await RenderPage({
      searchParams: Promise.resolve({
        project: project.path,
        screen: "hero",
        revision: "0".repeat(64),
      }),
    });

    expect(result.props["data-render-error"]).toBe("revision-mismatch");
    expect(result.props.children).toMatch(/revision/i);
  });

  it("refuses to read a project for a non-loopback Host", async () => {
    const project = await projectFile();
    request.host = "evil.example:3000";

    const result = await RenderPage({ searchParams: Promise.resolve({ project: project.path }) });

    expect(result.props["data-render-error"]).toBe("non-loopback");
  });
});
