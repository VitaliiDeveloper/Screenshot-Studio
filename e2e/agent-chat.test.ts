// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
import { chmodSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "@screenshot-studio/cli/server";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sample = resolve(repoRoot, "fixtures/sample/app-store-screenshots.json");

// A stand-in for the Claude Code CLI: the registry probes pass, and a run waits for `release` so
// the running state can be observed, renames the Hero screen, and reports success in stream-json.
// A critic run, recognized by its read-only rules in the system prompt, only reports findings.
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
appendFileSync(join(__dirname, "cwd.log"), process.cwd() + "\\n");
if (args.some((arg) => arg.includes("references/critic.md"))) {
  out({ type: "assistant", message: { content: [{ type: "text", text: "Score 6/10\\n[major] Slide 1 (hero): the headline names a feature, not an outcome." }] } });
  out({ type: "result", subtype: "success", is_error: false, duration_ms: 900, result: "Score 6/10" });
  process.exit(0);
}
const runDir = args.find((arg, index) => args[index - 1] === "--add-dir" && /run-/.test(arg));
if (runDir) appendFileSync(join(__dirname, "attachments.log"), JSON.stringify(require("node:fs").readdirSync(runDir)) + "\\n");
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
  const screens = project.layouts[0].screens;
  const screen = screens.find(({ id }) => id === "hero") ?? screens[0];
  if (screen) screen.name = "Agent Hero";
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
let dataRoot: string;
const originalPath = process.env.PATH;
const originalDataRoot = process.env.SCREENSHOT_STUDIO_DATA_ROOT;
// A run first re-probes the CLI and snapshots the project, so its first events take a moment.
const poll = { timeout: 15_000 };

// A 1x1 PNG, so the thumbnail decodes in the browser.
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const heroName = () => (JSON.parse(readFileSync(projectFile, "utf8")) as {
  layouts: Array<{ screens: Array<{ id: string; name: string }> }>;
}).layouts[0]!.screens.find((screen) => screen.id === "hero")!.name;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "agent-chat-e2e-"));
  binDir = mkdtempSync(join(tmpdir(), "agent-chat-bin-"));
  dataRoot = mkdtempSync(join(tmpdir(), "agent-chat-data-"));
  projectFile = join(dir, "app-store-screenshots.json");
  cpSync(resolve(repoRoot, "fixtures/sample/assets"), join(dir, "assets"), { recursive: true });
  writeFileSync(projectFile, readFileSync(sample, "utf8"));
  for (const [name, script] of [["claude", FAKE_CLAUDE], ["codex", FAKE_CODEX]]) {
    writeFileSync(join(binDir, name), script);
    chmodSync(join(binDir, name), 0o755);
  }
  // The server inherits this PATH, and agent runs keep PATH, so the fake CLIs shadow real ones.
  process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;
  // Start with agent creates a managed project; keep it out of the developer's own library.
  process.env.SCREENSHOT_STUDIO_DATA_ROOT = dataRoot;
  server = await startWebServer(undefined, {
    projectPath: projectFile,
    storeSpecsPath: resolve(repoRoot, "store-specs.json"),
  });
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  process.env.PATH = originalPath;
  if (originalDataRoot === undefined) delete process.env.SCREENSHOT_STUDIO_DATA_ROOT;
  else process.env.SCREENSHOT_STUDIO_DATA_ROOT = originalDataRoot;
  await browser?.close();
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
  rmSync(binDir, { recursive: true, force: true });
  rmSync(dataRoot, { recursive: true, force: true });
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
    await page.getByRole("menuitemradio", { name: "Haiku 5.5" }).click();
    await panel.getByRole("button", { name: "Effort", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Low" }).click();
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
    expect(runArgs[0]!.slice(runArgs[0]!.indexOf("--model"), runArgs[0]!.indexOf("--model") + 2)).toEqual(["--model", "claude-haiku-5-5"]);
    expect(runArgs[0]!.slice(runArgs[0]!.indexOf("--effort"), runArgs[0]!.indexOf("--effort") + 2)).toEqual(["--effort", "low"]);

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

  it("attaches an image by drag and drop, hands it to the agent for that run only, and keeps it out of the project", async () => {
    rmSync(join(binDir, "release"), { force: true });
    const runsBefore = readFileSync(join(binDir, "runs.log"), "utf8").trim().split("\n").length;
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.waitForSelector("canvas");
    await page.getByRole("button", { name: "Agent panel", exact: true }).click();
    const panel = page.getByRole("complementary", { name: "Agent", exact: true });
    const composer = panel.getByRole("textbox", { name: "Message to Claude Code" });
    await expect.poll(() => panel.getByRole("button", { name: "Agent", exact: true }).textContent(), poll).toContain("Claude Code");
    expect(await panel.getByRole("button", { name: "Attach images" }).isEnabled()).toBe(true);

    const transfer = await page.evaluateHandle((base64) => {
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], "brand-reference.png", { type: "image/png" }));
      return data;
    }, PNG_BASE64);
    await panel.dispatchEvent("dragenter", { dataTransfer: transfer });
    await panel.dispatchEvent("dragover", { dataTransfer: transfer });
    expect(await panel.locator("[data-agent-drop-zone]").isVisible()).toBe(true);
    await panel.dispatchEvent("drop", { dataTransfer: transfer });

    const pending = panel.getByRole("list", { name: "Attached images" });
    await pending.getByRole("img", { name: "brand-reference.png" }).waitFor();
    expect(await panel.locator("[data-agent-drop-zone]").count()).toBe(0);
    expect(await pending.getByRole("button", { name: "Remove brand-reference.png" }).isVisible()).toBe(true);
    expect(await panel.textContent()).toContain("sent to the agent's provider with your request, through your subscription");

    await composer.fill("Make the hero look like the attached reference");
    await composer.press("Enter");

    const sent = panel.getByRole("list", { name: "Attached images" });
    await sent.getByRole("img", { name: "brand-reference.png" }).waitFor();
    expect(await sent.count()).toBe(1);
    await expect.poll(() => panel.getByRole("status").first().textContent(), poll).toContain("Running");
    const runArgs = () => readFileSync(join(binDir, "runs.log"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
    await expect.poll(() => runArgs().length, poll).toBe(runsBefore + 1);
    const args = runArgs().at(-1)!;
    const runFolder = args.find((arg, index) => args[index - 1] === "--add-dir" && /run-/.test(arg))!;
    expect(runFolder).toBeDefined();
    expect(runFolder.startsWith(dir)).toBe(false);
    expect(readFileSync(join(binDir, "attachments.log"), "utf8").trim().split("\n").at(-1)).toBe('["1.png"]');
    expect(readdirSync(dir).sort()).toEqual(["app-store-screenshots.json", "assets"]);

    writeFileSync(join(binDir, "release"), "");
    const review = panel.getByRole("region", { name: "Agent run review" });
    await review.waitFor();
    await expect.poll(() => existsSync(runFolder), poll).toBe(false);
    expect(readdirSync(dir).sort()).toEqual(["app-store-screenshots.json", "assets"]);
    expect(readFileSync(projectFile, "utf8")).not.toMatch(/brand-reference|run-/);
    await review.getByRole("button", { name: "Undo run" }).click();
    await review.waitFor({ state: "detached" });
    expect(heroName()).toBe("Hero");
    await page.close();
  });

  it("starts a new project from Projects and runs the agent on it in the Workspace", async () => {
    rmSync(join(binDir, "release"), { force: true });
    const runs = () => (existsSync(join(binDir, "runs.log")) ? readFileSync(join(binDir, "runs.log"), "utf8").trim().split("\n").length : 0);
    const runsBefore = runs();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    // Opening the configured project first makes Projects show the gallery and its New project button.
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.waitForSelector("canvas");
    await page.goto(server.url, { waitUntil: "load" });

    await page.getByRole("button", { name: "New project" }).click();
    const dialog = page.getByRole("dialog", { name: "Create a managed project" });
    await dialog.getByRole("radio", { name: /Start with agent/ }).check(poll);
    await dialog.getByRole("textbox", { name: "Describe the app" }).fill("Habit tracker for runners. Calm, light look.");
    await dialog.locator('input[type="file"]').setInputFiles({ name: "app-home.png", mimeType: "image/png", buffer: Buffer.from(PNG_BASE64, "base64") });
    await dialog.getByRole("list", { name: "Attached images" }).getByRole("img", { name: "app-home.png" }).waitFor();
    // A drop anywhere on the expanded card attaches, not only on the description box.
    const logo = await page.evaluateHandle((base64) => {
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], "logo.png", { type: "image/png" }));
      return data;
    }, PNG_BASE64);
    const cardTitle = dialog.getByText("Start with agent", { exact: true });
    for (const type of ["dragenter", "dragover", "drop"]) await cardTitle.dispatchEvent(type, { dataTransfer: logo });
    await dialog.getByRole("list", { name: "Attached images" }).getByRole("img", { name: "logo.png" }).waitFor();
    await dialog.getByRole("button", { name: "Remove logo.png" }).click();
    expect(await dialog.getByRole("textbox", { name: "Describe the app" }).evaluate((node) => node === document.activeElement)).toBe(true);
    await dialog.getByRole("textbox", { name: "Project name" }).fill("Run Habit");
    await dialog.getByRole("button", { name: "Target platform" }).click();
    await dialog.getByRole("menu", { name: "Target platform options" }).getByRole("menuitemradio", { name: "Google Play" }).click();
    await dialog.getByRole("button", { name: "Device family" }).click();
    await dialog.getByRole("menu", { name: "Device family options" }).getByRole("menuitemradio", { name: "Android tablet" }).click();
    await dialog.getByRole("button", { name: "Model", exact: true }).click();
    await dialog.getByRole("menu", { name: "Model options" }).getByRole("menuitemradio", { name: "Haiku 5.5" }).click();
    await dialog.getByRole("button", { name: "Effort", exact: true }).click();
    await dialog.getByRole("menu", { name: "Effort options" }).getByRole("menuitemradio", { name: "Extra high" }).click();
    await dialog.getByRole("button", { name: "Create with Claude Code" }).click();

    await page.waitForURL(/\/editor\/project_[^/?]+$/, poll);
    const panel = page.getByRole("complementary", { name: "Agent", exact: true });
    await expect.poll(() => panel.getByRole("status").first().textContent(), poll).toContain("Running");
    expect(await panel.textContent()).toContain("Habit tracker for runners. Calm, light look.");
    expect(await panel.textContent()).toContain("Destination: Google Play · Android tablet");
    expect(await panel.getByRole("list", { name: "Attached images" }).getByRole("img", { name: "app-home.png" }).count()).toBe(1);
    await expect.poll(runs, poll).toBe(runsBefore + 1);
    const args = JSON.parse(readFileSync(join(binDir, "runs.log"), "utf8").trim().split("\n").at(-1)!) as string[];
    expect(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2)).toEqual(["--model", "claude-haiku-5-5"]);
    expect(args.slice(args.indexOf("--effort"), args.indexOf("--effort") + 2)).toEqual(["--effort", "xhigh"]);
    expect(readFileSync(join(binDir, "attachments.log"), "utf8").trim().split("\n").at(-1)).toBe('["1.png"]');
    expect(readFileSync(join(binDir, "cwd.log"), "utf8").trim().split("\n").at(-1)!.startsWith(realpathSync(dataRoot))).toBe(true);

    writeFileSync(join(binDir, "release"), "");
    await page.getByText("Claude Code is editing this project").waitFor({ state: "detached", ...poll });
    expect(runs()).toBe(runsBefore + 1);
    expect(heroName()).toBe("Hero");
    await page.close();
  });

  it("offers the critic after Keep changes, keeps the project untouched, and applies its findings through the composer", async () => {
    writeFileSync(join(binDir, "release"), "");
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.waitForSelector("canvas");
    await page.getByRole("button", { name: "Agent panel", exact: true }).click();
    const panel = page.getByRole("complementary", { name: "Agent", exact: true });
    const composer = panel.getByRole("textbox", { name: "Message to Claude Code" });
    await expect.poll(() => panel.getByRole("button", { name: "Agent", exact: true }).textContent(), poll).toContain("Claude Code");

    await panel.getByRole("group", { name: "Suggestions" }).getByRole("button", { name: "Make it sell" }).click();
    expect(await composer.inputValue()).toContain("sells in the store");
    await composer.press("Enter");
    const review = panel.getByRole("region", { name: "Agent run review" });
    await review.waitFor(poll);
    await review.getByRole("button", { name: "Keep changes" }).click();

    const offer = panel.getByRole("region", { name: "Critic review" });
    await offer.waitFor(poll);
    const kept = readFileSync(projectFile, "utf8");
    await offer.getByRole("button", { name: "Run critic" }).click();
    const apply = panel.getByRole("button", { name: "Apply findings" });
    await apply.waitFor(poll);
    expect(await offer.count()).toBe(0);
    expect(readFileSync(projectFile, "utf8")).toBe(kept);
    expect(await panel.getByRole("region", { name: "Agent run review" }).count()).toBe(0);
    const args = JSON.parse(readFileSync(join(binDir, "runs.log"), "utf8").trim().split("\n").at(-1)!) as string[];
    expect(args[args.indexOf("--append-system-prompt") + 1]).toContain("This run is read-only");

    await apply.click();
    expect(await composer.inputValue()).toMatch(/^Apply these critic findings[^]*\[major\] Slide 1 \(hero\)/);
    await page.close();
  });
});
