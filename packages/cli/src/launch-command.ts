// SPDX-License-Identifier: Apache-2.0
import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { askYesNo } from "./browser-setup.js";
import { parsePortFlag, serveUntilStopped } from "./dev-command.js";
import { initProjectFolder } from "./init.js";
import { DEFAULT_PROJECT_FILENAME } from "./project-io.js";
import { localHostUrl, startWebServer, type RunningServer } from "./server.js";
import { AGENT_MARKER_ENV } from "./upload-command.js";
import { isSet } from "./update-check.js";

/**
 * `screenshots` with no command or with a project folder: the production host without a pinned
 * project, so it opens the project library, or the folder's project through the library. A fixed port
 * keeps one browser origin across launches, and with it the editor settings the browser stores per
 * origin.
 */
export const DEFAULT_LAUNCH_PORT = 4747;

export type PortState = "free" | "studio" | "other";

export async function probeLaunchPort(port: number, fetchImpl: typeof fetch = fetch): Promise<PortState> {
  try {
    const response = await fetchImpl(`${localHostUrl(port)}/api/instance`, { signal: AbortSignal.timeout(1_500) });
    const body: unknown = response.ok ? await response.json().catch(() => null) : null;
    return (body as { app?: unknown } | null)?.app === "screenshot-studio" ? "studio" : "other";
  } catch (error) {
    return (error as { cause?: { code?: unknown } }).cause?.code === "ECONNREFUSED" ? "free" : "other";
  }
}

export function openInBrowser(url: string, log: (message: string) => void, platform = process.platform): void {
  const [command, args] = platform === "darwin"
    ? ["open", [url]]
    : platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : ["xdg-open", [url]];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.once("error", () => log(`Open ${url} in your browser.`));
  child.unref();
}

const APP_WINDOW_BROWSERS: Partial<Record<NodeJS.Platform, readonly string[]>> = {
  darwin: ["Google Chrome", "Microsoft Edge", "Chromium", "Brave Browser"],
  // Edge ships with Windows; `start` on a missing Chrome would show an error dialog.
  win32: ["msedge"],
  linux: ["google-chrome", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"],
};

// `open` and `cmd /c start` report a missing browser only through their exit code, so they stay
// referenced: with no server in this process, an unref'd opener lets Node exit before that code
// arrives. A browser started directly keeps running, so it counts once it has spawned.
function startDetached(command: string, args: string[], untilExit: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", () => resolve(false));
    if (untilExit) {
      child.once("exit", (code) => resolve(code === 0));
    } else {
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    }
  });
}

/** `--app`: a Chromium-based browser window without tabs or an address bar, else a normal tab. */
export async function openInAppWindow(
  url: string,
  log: (message: string) => void,
  warn: (message: string) => void,
  platform = process.platform,
): Promise<void> {
  const browsers = APP_WINDOW_BROWSERS[platform] ?? [];
  for (const browser of browsers) {
    const started = platform === "darwin"
      ? await startDetached("open", ["-na", browser, "--args", `--app=${url}`], true)
      : platform === "win32"
        ? await startDetached("cmd", ["/c", "start", "", browser, `--app=${url}`], true)
        : await startDetached(browser, [`--app=${url}`], false);
    if (started) return;
  }
  warn(`--app found no supported browser (${browsers.join(", ")}), so the editor opens in a browser tab instead.`);
  openInBrowser(url, log, platform);
}

// A repository folder gets its project in this subfolder, so init never collides with the repository's
// own AGENTS.md and a later launch from the same folder finds it again.
export const PROJECT_SUBFOLDER = "screenshot-studio";

async function isFile(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isFile() ?? false;
}

export async function resolveLaunchProject(
  target: string,
  deps: Pick<LaunchDependencies, "cwd" | "env" | "interactive" | "confirm" | "createProject" | "log">,
): Promise<string> {
  const path = resolve(deps.cwd, target);
  const info = await stat(path).catch(() => null);
  if (!info) throw new Error(`${path} does not exist`);
  if (!info.isDirectory()) return path;
  for (const folder of [path, join(path, PROJECT_SUBFOLDER)]) {
    if (await isFile(join(folder, DEFAULT_PROJECT_FILENAME))) return join(folder, DEFAULT_PROJECT_FILENAME);
  }

  const empty = (await readdir(path)).every((name) => name === ".DS_Store");
  const folder = empty ? path : join(path, PROJECT_SUBFOLDER);
  if (!deps.interactive || isSet(deps.env.CI)) {
    const shown = empty ? target : `${target === "." ? "." : target.replace(/[\\/]+$/, "")}/${PROJECT_SUBFOLDER}`;
    throw new Error(
      `No ${DEFAULT_PROJECT_FILENAME} in ${path}. Create a project with: screenshots init --dir ${shown}\nthen open it with: ss-studio ${shown}`,
    );
  }
  if (!(await deps.confirm(`No Screenshot Studio project in ${path}. Create one in ${folder}? [Y/n] `))) {
    throw new Error(`No project was created in ${folder}.`);
  }
  await deps.createProject(folder);
  deps.log(`Created a Screenshot Studio project in ${folder}`);
  return join(folder, DEFAULT_PROJECT_FILENAME);
}

export async function openProjectInHost(
  baseUrl: string,
  projectPath: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(`${baseUrl}/api/instance/open`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-screenshot-studio-cli": "1" },
    body: JSON.stringify({ projectPath }),
  });
  const body = await response.json().catch(() => null) as { entryId?: unknown; error?: unknown } | null;
  if (!response.ok || typeof body?.entryId !== "string") {
    const reason = typeof body?.error === "string" ? body.error : `HTTP ${response.status}`;
    throw new Error(`Screenshot Studio could not open ${projectPath}: ${reason}`);
  }
  return `${baseUrl}/editor/${encodeURIComponent(body.entryId)}`;
}

export interface LaunchDependencies {
  env: NodeJS.ProcessEnv;
  cwd: string;
  interactive: boolean;
  probe: (port: number) => Promise<PortState>;
  ensureBrowsers: () => Promise<void>;
  startServer: (port: number | undefined) => Promise<RunningServer>;
  confirm: (question: string) => Promise<boolean>;
  createProject: (folder: string) => Promise<void>;
  openProject: (baseUrl: string, projectPath: string) => Promise<string>;
  serve: (server: RunningServer) => Promise<void>;
  open: (url: string) => void;
  openApp: (url: string) => Promise<void>;
  log: (message: string) => void;
  warn: (message: string) => void;
}

export function defaultLaunchDependencies(
  storeSpecsPath: string,
  ensureBrowsers: () => Promise<void>,
): LaunchDependencies {
  const log = (message: string) => console.log(message);
  const warn = (message: string) => console.warn(message);
  return {
    env: process.env,
    cwd: process.cwd(),
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    probe: (port) => probeLaunchPort(port),
    ensureBrowsers,
    startServer: (port) => startWebServer(port, { storeSpecsPath }),
    confirm: askYesNo,
    createProject: (folder) => initProjectFolder(folder, undefined, storeSpecsPath),
    openProject: (baseUrl, projectPath) => openProjectInHost(baseUrl, projectPath),
    serve: serveUntilStopped,
    open: (url) => openInBrowser(url, log),
    openApp: (url) => openInAppWindow(url, log, warn),
    log,
    warn,
  };
}

export async function runLaunchCommand(
  flags: Record<string, string>,
  deps: LaunchDependencies,
  target?: string,
): Promise<void> {
  if (deps.env[AGENT_MARKER_ENV] !== undefined) {
    throw new Error(
      `screenshots without a command or with a folder opens the editor for a person and does not run in an agent session (${AGENT_MARKER_ENV} is set). Run a command such as screenshots check instead.`,
    );
  }
  const requestedPort = parsePortFlag(flags.port);
  const projectPath = target === undefined ? undefined : await resolveLaunchProject(target, deps);
  const port = requestedPort ?? DEFAULT_LAUNCH_PORT;
  const shouldOpen = deps.interactive && flags["no-open"] !== "true" && !isSet(deps.env.CI);
  const open = async (url: string) => {
    if (!shouldOpen) return;
    if (flags.app === "true") await deps.openApp(url);
    else deps.open(url);
  };

  const state = await deps.probe(port);
  if (state === "studio") {
    const url = projectPath ? await deps.openProject(localHostUrl(port), projectPath) : localHostUrl(port);
    deps.log(`Screenshot Studio is already running at ${url}`);
    await open(url);
    return;
  }
  if (state === "other") {
    if (requestedPort) throw new Error(`Port ${port} is used by another program`);
    deps.warn(
      `Port ${port} is used by another program, so Screenshot Studio starts on a free port. Editor settings start from defaults in this run.`,
    );
  }

  await deps.ensureBrowsers();
  const server = await deps.startServer(state === "free" ? port : undefined);
  let url = server.url;
  if (projectPath) {
    try {
      url = await deps.openProject(server.url, projectPath);
    } catch (error) {
      await server.stop();
      throw error;
    }
  }
  deps.log(`Screenshot Studio is running at ${url}\nPress Ctrl+C to stop it.`);
  await open(url);
  await deps.serve(server);
}
