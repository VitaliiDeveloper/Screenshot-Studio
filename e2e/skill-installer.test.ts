// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile as execFileCallback } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceSkill = join(repoRoot, "skills", "screenshot-studio");
const stagedCli = join(repoRoot, "packages", "cli", "package", "dist", "index.js");

let directory: string;
let installedSkill: string;
let projectDirectory: string;

async function run(command: string, args: string[], cwd: string, timeout = 180_000) {
  try {
    return await execFile(command, args, {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
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
  directory = await mkdtemp(join(tmpdir(), "screenshot-studio-skill-"));
  installedSkill = join(directory, "skills-home", "skills", "screenshot-studio");
  projectDirectory = join(directory, "clean-project");
  await cp(sourceSkill, installedSkill, { recursive: true });
}, 300_000);

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("optional skill", () => {
  it("installs as a thin delegating skill and initializes a clean project with the packaged CLI", async () => {
    const skill = await readFile(join(installedSkill, "SKILL.md"), "utf8");
    expect(skill).toContain("generated project-local");
    expect(skill).toContain("AGENTS.md");
    expect(skill).not.toContain("Project\n├──");
    const metadata = await readFile(join(installedSkill, "agents", "openai.yaml"), "utf8");
    expect(metadata).toContain('display_name: "Screenshot Studio"');
    expect(metadata).toContain("Use $screenshot-studio");

    const initialized = await run(process.execPath, [
      join(installedSkill, "scripts", "init-project.mjs"),
      "--dir",
      projectDirectory,
      "--name",
      "Skill Smoke",
      "--cli",
      stagedCli,
    ], directory);
    expect(initialized.stdout).toContain("Screenshot Studio project is ready");

    const project = JSON.parse(await readFile(
      join(projectDirectory, "app-store-screenshots.json"),
      "utf8",
    ));
    expect(project).toMatchObject({
      meta: { name: "Skill Smoke", schemaVersion: 1 },
      preferredExportLayoutId: "default",
      layouts: [{ id: "default", name: "Default", mode: "isolated", screens: [{ id: "hero" }] }],
    });
    expect(await readFile(join(projectDirectory, "AGENTS.md"), "utf8"))
      .toContain("screenshots <command>");
    expect(await readFile(join(projectDirectory, "CLAUDE.md"), "utf8"))
      .toContain("@AGENTS.md");
  });

  it("refuses to reinitialize an existing project", async () => {
    await expect(run(process.execPath, [
      join(installedSkill, "scripts", "init-project.mjs"),
      "--dir",
      projectDirectory,
      "--cli",
      stagedCli,
    ], directory)).rejects.toThrow("Refusing to overwrite existing");
  });

  it("fails actionably without fetching when the packaged CLI is unavailable", async () => {
    await expect(run(process.execPath, [
      join(installedSkill, "scripts", "init-project.mjs"),
      "--dir",
      join(directory, "missing-cli-project"),
      "--cli",
      "missing-screenshot-studio-cli",
    ], directory)).rejects.toThrow("Screenshot Studio CLI not found");
  });
});
