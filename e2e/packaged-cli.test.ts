// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile as execFileCallback } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PNG } from "pngjs";

const execFile = promisify(execFileCallback);
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const stagedPackage = join(repoRoot, "packages", "cli", "package");

let directory: string;
let consumer: string;
let projectDirectory: string;
let bin: string;
let packedFiles: string[];
let packedBytes: number;

async function run(command: string, args: string[], cwd: string, timeout = 180_000) {
  try {
    return await execFile(command, args, {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        INIT_CWD: cwd,
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
      },
    });
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    throw new Error(
      `${failure.message}\n${failure.stdout ?? ""}\n${failure.stderr ?? ""}`.trim(),
      { cause: error },
    );
  }
}

beforeAll(async () => {
  await run("pnpm", ["build:cli-package"], repoRoot, 300_000);
  directory = await mkdtemp(join(tmpdir(), "packaged-cli-"));
  consumer = join(directory, "consumer");
  projectDirectory = join(directory, "project");
  await mkdir(consumer, { recursive: true });
  await writeFile(join(consumer, "package.json"), '{"name":"packaged-cli-smoke","private":true}\n');

  const packed = await run("pnpm", [
    "--dir",
    stagedPackage,
    "pack",
    "--json",
    "--pack-destination",
    directory,
  ], repoRoot);
  const details = JSON.parse(packed.stdout) as {
    filename: string;
    files: Array<{ path: string }>;
  };
  packedFiles = details.files.map((file) => file.path);
  packedBytes = (await stat(details.filename)).size;

  const store = (await run("pnpm", ["store", "path"], repoRoot)).stdout.trim();
  await run("pnpm", [
    "--store-dir",
    store,
    "add",
    details.filename,
    "--offline",
    "--ignore-scripts",
  ], consumer);

  bin = process.platform === "win32"
    ? join(consumer, "node_modules", ".bin", "screenshots.cmd")
    : join(consumer, "node_modules", ".bin", "screenshots");
  if (process.platform !== "win32") await chmod(bin, 0o755);
}, 300_000);

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("Phase 6 packaged CLI", () => {
  it("contains only the explicit executable/runtime package surface", () => {
    expect(packedFiles).toEqual([
      "dist/index.js",
      "dist/index.js.map",
      "dist/project-agent-guide.md",
      "LICENSE",
      "NOTICE",
      "package.json",
      "README.md",
      "runtime/store-specs.json",
      "runtime/web.zip",
    ]);
    expect(packedFiles.some((path) => path.startsWith("src/") || path.includes("fixtures"))).toBe(false);
    expect(packedBytes).toBeLessThan(64 * 1024 * 1024);
  });

  it("installs, initializes, manages, and exports through the packaged standalone host", async () => {
    const initialized = await run(bin, [
      "init",
      "--dir",
      projectDirectory,
      "--name",
      "Packaged Smoke",
    ], consumer);
    expect(initialized.stdout).toContain(`Initialized project in ${projectDirectory}`);

    const projectPath = join(projectDirectory, "app-store-screenshots.json");
    const project = JSON.parse(await readFile(projectPath, "utf8"));
    expect(project).toMatchObject({
      meta: { name: "Packaged Smoke", schemaVersion: 5 },
      mode: "isolated",
      screens: [{ id: "hero" }],
    });
    expect(await readFile(join(projectDirectory, "AGENTS.md"), "utf8"))
      .toContain("screenshots <command>");

    const listed = await run(bin, ["screen", "list", "--project", projectPath], consumer);
    expect(listed.stdout).toContain("hero");

    const outputDirectory = join(projectDirectory, "packaged-export");
    const exported = await run(bin, [
      "export",
      "--screen",
      "hero",
      "--size",
      "6.9",
      "--project",
      projectPath,
      "--out",
      outputDirectory,
    ], consumer, 300_000);
    expect(exported.stdout).toContain("(1320x2868)");

    const files = await readdir(outputDirectory);
    expect(files).toHaveLength(1);
    expect(basename(files[0]!)).toContain("apple-iphone-6.9");
    const png = PNG.sync.read(await readFile(join(outputDirectory, files[0]!)));
    expect({ width: png.width, height: png.height }).toEqual({ width: 1320, height: 2868 });
  });
});
