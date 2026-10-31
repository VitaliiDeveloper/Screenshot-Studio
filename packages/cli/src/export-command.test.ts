// SPDX-License-Identifier: Apache-2.0
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { leadStoreSizeId } from "@screenshot-studio/core/export";
import {
  runExportCommand,
  singleExportFilename,
  type ExportCommandDependencies,
} from "./export-command.js";
import { resolveTarget } from "./export.js";

const storeSpecsPath = fileURLToPath(new URL("../../../store-specs.json", import.meta.url));
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

async function projectFixture(): Promise<{ root: string; path: string; bytes: string }> {
  const root = await workspace("export-command-");
  const path = join(root, "app-store-screenshots.json");
  const bytes = `${JSON.stringify({
    meta: { name: "Export", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "launch",
    layouts: [{
      id: "launch", name: "Launch", mode: "isolated",
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
    }, {
      id: "feature", name: "Feature", mode: "connected",
      screens: [{
        id: "hero",
        name: "Feature Hero",
        platform: "android",
        device: "phone",
        locale: "uk",
        direction: "ltr",
        artboard: { width: 1080, height: 1920 },
        background: { type: "solid", color: "#222222" },
        elements: [],
      }],
    }],
  })}\n`;
  await writeFile(path, bytes, "utf8");
  return { root, path, bytes };
}

function commandDependencies(
  exportScreenToPng: NonNullable<ExportCommandDependencies["exportScreenToPng"]>,
) {
  const stop = vi.fn(async () => undefined);
  const server = {
    url: "http://localhost:4000",
    exited: new Promise<Error>(() => undefined),
    stop,
  };
  const log = vi.fn<(message: string) => void>();
  return {
    dependencies: {
      startWebServer: vi.fn(async () => server),
      exportScreenToPng,
      log,
    } satisfies ExportCommandDependencies,
    stop,
    log,
  };
}

describe("runExportCommand stable single export", () => {
  it("pins the rendered revision and safely publishes the final file", async () => {
    const fixture = await projectFixture();
    const outDir = join(fixture.root, "output");
    const render = vi.fn<NonNullable<ExportCommandDependencies["exportScreenToPng"]>>(
      async () => Buffer.from("rendered png"),
    );
    const runtime = commandDependencies(render);

    await runExportCommand({
      project: fixture.path,
      screen: "hero",
      out: outDir,
    }, storeSpecsPath, runtime.dependencies);

    const files = await readdir(outDir);
    expect(files).toHaveLength(1);
    expect(await readFile(join(outDir, files[0]!))).toEqual(Buffer.from("rendered png"));
    expect(render.mock.calls[0]![0].projectRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(render.mock.calls[0]![0].layoutId).toBe("launch");
    expect(runtime.stop).toHaveBeenCalledOnce();
    expect(runtime.log).toHaveBeenCalledWith(expect.stringMatching(/^Exported .* \(\d+x\d+\)$/));
  });

  it("forwards the browser choice, with --browser winning over SCREENSHOTS_BROWSER", async () => {
    const fixture = await projectFixture();
    const render = vi.fn<NonNullable<ExportCommandDependencies["exportScreenToPng"]>>(
      async () => Buffer.from("rendered png"),
    );
    const run = (flags: Record<string, string>) => runExportCommand({
      project: fixture.path,
      screen: "hero",
      out: join(fixture.root, "output"),
      ...flags,
    }, storeSpecsPath, commandDependencies(render).dependencies);

    await run({});
    vi.stubEnv("SCREENSHOTS_BROWSER", "msedge");
    try {
      await run({});
      await run({ browser: "chromium" });
    } finally {
      vi.unstubAllEnvs();
    }

    expect(render.mock.calls.map(([options]) => options.browser)).toEqual(["chromium", "msedge", "chromium"]);
  });

  it("resolves an explicit layout name before selecting a same-id screen", async () => {
    const fixture = await projectFixture();
    const render = vi.fn<NonNullable<ExportCommandDependencies["exportScreenToPng"]>>(
      async () => Buffer.from("feature png"),
    );
    const runtime = commandDependencies(render);

    await runExportCommand({
      project: fixture.path,
      layout: "Feature",
      screen: "hero",
      out: join(fixture.root, "feature-output"),
    }, storeSpecsPath, runtime.dependencies);

    expect(render.mock.calls[0]![0]).toMatchObject({ layoutId: "feature", screenId: "hero" });
  });

  it("does not publish when the project changes during render", async () => {
    const fixture = await projectFixture();
    const outDir = join(fixture.root, "output");
    const render = vi.fn<NonNullable<ExportCommandDependencies["exportScreenToPng"]>>(
      async () => {
        await writeFile(fixture.path, fixture.bytes.replace("Export", "Changed"), "utf8");
        return Buffer.from("stale png");
      },
    );
    const runtime = commandDependencies(render);

    await expect(runExportCommand({
      project: fixture.path,
      screen: "hero",
      out: outDir,
    }, storeSpecsPath, runtime.dependencies)).rejects.toThrow(/revision.*changed/i);

    await expect(readdir(outDir)).rejects.toMatchObject({ code: "ENOENT" });
    expect(runtime.stop).toHaveBeenCalledOnce();
  });

  it("refuses to replace a symbolic-link output leaf", async () => {
    const fixture = await projectFixture();
    const outDir = join(fixture.root, "output");
    const sentinel = join(fixture.root, "sentinel.png");
    const target = await resolveTarget(
      storeSpecsPath,
      "apple",
      "iphone",
      leadStoreSizeId("apple", "iphone"),
    );
    const filename = singleExportFilename({ platform: "apple", device: "iphone", locale: "en" }, target);
    await mkdir(outDir);
    await writeFile(sentinel, "sentinel");
    await symlink(sentinel, join(outDir, filename));
    const runtime = commandDependencies(vi.fn(async () => Buffer.from("rendered png")));

    await expect(runExportCommand({
      project: fixture.path,
      screen: "hero",
      out: outDir,
    }, storeSpecsPath, runtime.dependencies)).rejects.toThrow(/symbolic link.*destination/i);

    expect(await readFile(sentinel, "utf8")).toBe("sentinel");
    expect(runtime.stop).toHaveBeenCalledOnce();
  });
});
