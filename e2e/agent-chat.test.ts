// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
import { chmodSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "@screenshot-studio/cli/server";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sample = resolve(repoRoot, "fixtures/sample/app-store-screenshots.json");

// A stand-in for the Claude Code CLI: the registry probes pass, and a run waits for `release` so
// the running state can be observed, renames the Hero screen, and reports success in stream-json.
const FAKE_CLAUDE = `#!${process.execPath}
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const args = process.argv.slice(2);
const out = (value) => process.stdout.write((typeof value === "string" ? value : JSON.stringify(value)) + "\\n");
if (args[0] === "--version") { out("2.1.296 (Claude Code)"); process.exit(0); }
if (args[0] === "--help") {
  out("Options:\\n  -p, --print  Print response and exit\\n  --bare  Minimal mode; auth is ANTHROPIC_API_KEY only\\n  --model <model>  Model for the session");
  process.exit(0);
}
if (args[0] === "auth") { out({ loggedIn: true, authMethod: "claude.ai" }); process.exit(0); }
appendFileSync(join(__dirname, "runs.log"), JSON.stringify(args) + "\\n");
const todos = (status) => ({ type: "assistant", message: { content: [{ type: "tool_use", name: "TodoWrite", input: { todos: [
  { content: "Read project", status: "completed" },
  { content: "Rename Hero", status },
] } }] } });
out({ type: "system", subtype: "init" });
out({ type: "assistant", message: { content: [{ type: "text", text: "I'll rename the Hero screen." }] } });
out(todos("in_progress"));
out({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "screenshots screen rename hero --project ./app-store-screenshots.json" } }] } });
const started = Date.now();
const wait = () => {
  if (!existsSync(join(__dirname, "release")) && Date.now() - started < 60000) return setTimeout(wait, 50);
  const project = JSON.parse(readFileSync("app-store-screenshots.json", "utf8"));
  project.layouts[0].screens.find((screen) => screen.id === "hero").name = "Agent Hero";
  writeFileSync("app-store-screenshots.json", JSON.stringify(project, null, 2));
  out(todos("completed"));
  out({ type: "result", subtype: "success", is_error: false, duration_ms: 1200, result: "Renamed the Hero screen." });
};
wait();
`;

// Keeps the registry from probing a developer's real Codex: installed, signed out.
const FAKE_CODEX = `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("codex-cli 0.162.1"); process.exit(0); }
console.error("Not logged in");
process.exit(1);
`;

let server: RunningServer;
let browser: Browser;
let dir: string;
let binDir: string;
let projectFile: string;
const originalPath = process.env.PATH;
// A run first re-probes the CLI and snapshots the project, so its first events take a moment.
const poll = { timeout: 15_000 };

const heroName = () => (JSON.parse(readFileSync(projectFile, "utf8")) as {
  layouts: Array<{ screens: Array<{ id: string; name: string }> }>;
}).layouts[0]!.screens.find((screen) => screen.id === "hero")!.name;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "agent-chat-e2e-"));
  binDir = mkdtempSync(join(tmpdir(), "agent-chat-bin-"));
  projectFile = join(dir, "app-store-screenshots.json");
  cpSync(resolve(repoRoot, "fixtures/sample/assets"), join(dir, "assets"), { recursive: true });
  writeFileSync(projectFile, readFileSync(sample, "utf8"));
  for (const [name, script] of [["claude", FAKE_CLAUDE], ["codex", FAKE_CODEX]]) {
    writeFileSync(join(binDir, name), script);
    chmodSync(join(binDir, name), 0o755);
  }
  // The server inherits this PATH, and agent runs keep PATH, so the fake CLIs shadow real ones.
  process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;
  server = await startWebServer(undefined, {
    projectPath: projectFile,
    storeSpecsPath: resolve(repoRoot, "store-specs.json"),
  });
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  process.env.PATH = originalPath;
  await browser?.close();
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
  rmSync(binDir, { recursive: true, force: true });
});

describe("Agent panel", () => {
  it("runs an agent, pauses editing, reloads the canvas from disk, and undoes the run", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.waitForSelector("canvas");

    await page.getByRole("button", { name: "Agent panel", exact: true }).click();
    const panel = page.getByRole("complementary", { name: "Agent", exact: true });
    const composer = panel.getByRole("textbox", { name: "Message to Claude Code" });
    await expect.poll(() => composer.evaluate((node) => node === document.activeElement), poll).toBe(true);
    await expect.poll(() => panel.getByRole("button", { name: "Agent", exact: true }).textContent(), poll).toContain("Claude Code");

    await panel.getByRole("button", { name: "Model", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "haiku" }).click();
    await composer.fill("Rename the hero screen");
    await composer.press("Enter");

    const banner = page.getByText("Claude Code is editing this project");
    await banner.waitFor();
    await expect.poll(() => panel.getByRole("status").first().textContent(), poll)
      .toContain("Running · step 2 of 2 · Changing the project");
    expect(await page.getByRole("button", { name: /^Export/ }).isDisabled()).toBe(true);
    expect(await page.getByRole("button", { name: "Undo", exact: true }).isDisabled()).toBe(true);
    expect(await page.locator("[data-editor-side-panel='right'] > div > div[inert]").count()).toBe(1);

    writeFileSync(join(binDir, "release"), "");
    const review = panel.getByRole("region", { name: "Agent run review" });
    await review.waitFor();
    await banner.waitFor({ state: "detached" });
    expect(heroName()).toBe("Agent Hero");
    expect(await review.textContent()).toContain("Renamed the Hero screen.");
    expect(await review.textContent()).toContain("Changes · 1");
    const runArgs = readFileSync(join(binDir, "runs.log"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
    expect(runArgs).toHaveLength(1);
    expect(runArgs[0]!.slice(runArgs[0]!.indexOf("--model"), runArgs[0]!.indexOf("--model") + 2)).toEqual(["--model", "haiku"]);

    // The Go to row comes from the reloaded store, so the canvas reads the agent's project.
    await review.getByRole("button", { name: "Go to Agent Hero" }).click();
    await expect.poll(() => page.getByTestId("status-bar").textContent(), poll).toContain("Agent Hero");

    await review.getByRole("button", { name: "Undo run" }).click();
    await review.waitFor({ state: "detached" });
    expect(heroName()).toBe("Hero");
    await expect.poll(() => page.getByTestId("status-bar").textContent(), poll).not.toContain("Agent Hero");
    expect(await page.getByRole("button", { name: /^Export/ }).isDisabled()).toBe(false);
    await page.close();
  });
});
