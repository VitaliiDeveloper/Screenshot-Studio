// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chmodSync, cpSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "@screenshot-studio/cli/server";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sample = resolve(repoRoot, "fixtures/sample/app-store-screenshots.json");
const cli = resolve(repoRoot, "packages/cli/bin/screenshots.mjs");
const SECRET = "FAKE-KEY-BYTES-123";

// A stand-in for the Claude Code CLI that runs the real `screenshots` client, then reports what it
// printed: the real route, broker, commands, and render host answer it.
const FAKE_CLAUDE = `#!${process.execPath}
const { spawnSync } = require("node:child_process");
const { appendFileSync, readFileSync, rmSync, symlinkSync } = require("node:fs");
const { join } = require("node:path");
const args = process.argv.slice(2);
const out = (value) => process.stdout.write((typeof value === "string" ? value : JSON.stringify(value)) + "\\n");
if (args[0] === "--version") { out("2.1.296 (Claude Code)"); process.exit(0); }
if (args[0] === "--help") { out("Options:\\n  --bare  Minimal mode"); process.exit(0); }
if (args[0] === "auth") { out({ loggedIn: true, authMethod: "claude.ai" }); process.exit(0); }
const commands = JSON.parse(readFileSync(join(__dirname, "commands.json"), "utf8"));
const results = commands.map((command) => {
  if (command[0] === "link-project-to") {
    rmSync("app-store-screenshots.json");
    symlinkSync(command[1], "app-store-screenshots.json");
    return { command, status: 0, stdout: "", stderr: "" };
  }
  const run = spawnSync(process.execPath, [${JSON.stringify(cli)}, ...command], { encoding: "utf8" });
  return { command, status: run.status, stdout: run.stdout, stderr: run.stderr };
});
appendFileSync(join(__dirname, "results.jsonl"), JSON.stringify(results) + "\\n");
out({ type: "result", subtype: "success", is_error: false, duration_ms: 1, result: "done" });
`;

interface CommandResult {
  command: string[];
  status: number;
  stdout: string;
  stderr: string;
}

let server: RunningServer;
let dir: string;
let binDir: string;
let keyFile: string;
let projectFile: string;
const originalPath = process.env.PATH;
const originalDataRoot = process.env.SCREENSHOT_STUDIO_DATA_ROOT;

async function runAgent(commands: string[][]): Promise<{ results: CommandResult[]; events: string }> {
  writeFileSync(join(binDir, "commands.json"), JSON.stringify(commands));
  rmSync(join(binDir, "results.jsonl"), { force: true });
  const session = await fetch(`${server.url}/api/project-session`);
  const projectId = session.headers.get("x-project-id")!;
  const response = await fetch(`${server.url}/api/agents/session`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-project-id": projectId },
    body: JSON.stringify({ agentId: "claude-code", message: "render", model: "claude-sonnet-5-5" }),
  });
  expect(response.status).toBe(200);
  const events = await response.text();
  const results = JSON.parse(readFileSync(join(binDir, "results.jsonl"), "utf8").trim()) as CommandResult[];
  return { results, events };
}

beforeAll(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "agent-render-e2e-")));
  binDir = mkdtempSync(join(tmpdir(), "agent-render-bin-"));
  keyFile = join(mkdtempSync(join(tmpdir(), "agent-render-key-")), "key.json");
  writeFileSync(keyFile, JSON.stringify({ private_key: SECRET }));
  projectFile = join(dir, "app-store-screenshots.json");
  cpSync(resolve(repoRoot, "fixtures/sample/assets"), join(dir, "assets"), { recursive: true });
  writeFileSync(projectFile, readFileSync(sample, "utf8"));
  writeFileSync(join(binDir, "claude"), FAKE_CLAUDE);
  chmodSync(join(binDir, "claude"), 0o755);
  process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;
  process.env.SCREENSHOT_STUDIO_DATA_ROOT = mkdtempSync(join(tmpdir(), "agent-render-data-"));
  server = await startWebServer(undefined, { projectPath: projectFile, storeSpecsPath: resolve(repoRoot, "store-specs.json") });
}, 180_000);

afterAll(async () => {
  process.env.PATH = originalPath;
  if (originalDataRoot === undefined) delete process.env.SCREENSHOT_STUDIO_DATA_ROOT;
  else process.env.SCREENSHOT_STUDIO_DATA_ROOT = originalDataRoot;
  await server?.stop();
});

describe("rendering through the editor", () => {
  it("gives the agent a real PNG of the exact store size and real text measurements", async () => {
    const { results, events } = await runAgent([
      ["export", "--screen", "hero"],
      ["check", "--render", "--json"],
    ]);
    expect(results[0]!.status).toBe(0);
    const file = join(dir, "export", "apple-iphone-6.3-locale-en.png");
    expect(results[0]!.stdout).toContain(file);
    const png = readFileSync(file);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1206, 2622]);
    const report = JSON.parse(results[1]!.stdout) as { textMeasured: boolean; ok: boolean };
    expect(report.textMeasured).toBe(true);
    expect(report.ok).toBe(true);
    expect(events).toContain("export/apple-iphone-6.3-locale-en.png");
    expect(events).toContain('"status":"accepted"');
  }, 120_000);

  it("refuses what the editor owns, and exits like the command would", async () => {
    const { results } = await runAgent([
      ["export", "--screen", "hero", "--out", "/tmp/nope"],
      ["check", "--render", "--project", "./app-store-screenshots.json"],
    ]);
    expect(results[0]!.status).toBe(1);
    expect(results[0]!.stderr).toContain("--out is not available inside an editor run");
    expect(results[1]!.status).toBe(2);
    expect(results[1]!.stderr).toContain("--project is not available inside an editor run");
  }, 60_000);

  it("keeps a link leaving the project out of the output and the answer", async () => {
    const linked = "assets/leak.png";
    symlinkSync(keyFile, join(dir, linked));
    const original = readFileSync(projectFile, "utf8");
    const project = JSON.parse(original) as { layouts: Array<{ screens: Array<{ id: string; background: unknown }> }> };
    project.layouts[0]!.screens.find(({ id }) => id === "hero")!.background = { type: "image", assetUrl: linked };
    writeFileSync(projectFile, JSON.stringify(project));
    rmSync(join(dir, "export"), { recursive: true, force: true });
    try {
      const { results, events } = await runAgent([
        ["export", "--screen", "hero"],
        ["check", "--render", "--json"],
      ]);
      const asset = await fetch(`${server.url}/api/asset?project=${encodeURIComponent(projectFile)}&path=${encodeURIComponent(linked)}`);
      expect(asset.status).toBe(400);
      expect(await asset.text()).not.toContain(SECRET);
      const report = JSON.parse(results[1]!.stdout) as { issues: Array<{ kind: string; message: string }> };
      expect(report.issues.map(({ kind }) => kind)).toContain("missing-image");
      expect(JSON.stringify(results) + events).not.toContain(SECRET);
      for (const name of readdirSync(join(dir, "export"))) {
        expect(readFileSync(join(dir, "export", name)).includes(SECRET)).toBe(false);
      }
    } finally {
      writeFileSync(projectFile, original);
      rmSync(join(dir, linked));
    }
  }, 120_000);

  it("keeps a project file linked to a key from being read or quoted", async () => {
    const original = readFileSync(projectFile, "utf8");
    const key = readFileSync(keyFile, "utf8");
    try {
      const { results, events } = await runAgent([
        ["link-project-to", keyFile],
        ["export", "--screen", "hero"],
        ["check", "--render", "--json"],
      ]);
      for (const { command, status, stdout, stderr } of results.slice(1)) {
        expect(status, command.join(" ")).not.toBe(0);
        expect(stdout + stderr).not.toContain(SECRET);
      }
      expect(events).not.toContain(SECRET);
    } finally {
      rmSync(projectFile, { force: true });
      writeFileSync(projectFile, original);
    }
    expect(readFileSync(keyFile, "utf8")).toBe(key);
    expect(readdirSync(join(keyFile, "..")).sort()).toEqual(["key.json"]);
  }, 120_000);
});
