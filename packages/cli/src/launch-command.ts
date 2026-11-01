// SPDX-License-Identifier: Apache-2.0
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parsePortFlag, serveUntilStopped } from "./dev-command.js";
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

export async function resolveLaunchProject(target: string, cwd: string): Promise<string> {
  const path = resolve(cwd, target);
  const info = await stat(path).catch(() => null);
  if (!info) throw new Error(`${path} does not exist`);
  const projectPath = info.isDirectory() ? join(path, DEFAULT_PROJECT_FILENAME) : path;
  if (!(await stat(projectPath).catch(() => null))?.isFile()) {
    // A subfolder, because the folder is often an app repository whose own AGENTS.md init refuses to overwrite.
    const folder = `${target === "." ? "." : target.replace(/[\\/]+$/, "")}/screenshots`;
    throw new Error(
      `No ${DEFAULT_PROJECT_FILENAME} in ${path}. Create a project with: screenshots init --dir ${folder}\nthen open it with: ss-studio ${folder}`,
    );
  }
  return projectPath;
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
  openProject: (baseUrl: string, projectPath: string) => Promise<string>;
  serve: (server: RunningServer) => Promise<void>;
  open: (url: string) => void;
  log: (message: string) => void;
  warn: (message: string) => void;
}

export function defaultLaunchDependencies(
  storeSpecsPath: string,
  ensureBrowsers: () => Promise<void>,
): LaunchDependencies {
  const log = (message: string) => console.log(message);
  return {
    env: process.env,
    cwd: process.cwd(),
    interactive: Boolean(process.stdout.isTTY),
    probe: (port) => probeLaunchPort(port),
    ensureBrowsers,
    startServer: (port) => startWebServer(port, { storeSpecsPath }),
    openProject: (baseUrl, projectPath) => openProjectInHost(baseUrl, projectPath),
    serve: serveUntilStopped,
    open: (url) => openInBrowser(url, log),
    log,
    warn: (message) => console.warn(message),
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
  const projectPath = target === undefined ? undefined : await resolveLaunchProject(target, deps.cwd);
  const requestedPort = parsePortFlag(flags.port);
  const port = requestedPort ?? DEFAULT_LAUNCH_PORT;
  const shouldOpen = deps.interactive && flags["no-open"] !== "true" && !isSet(deps.env.CI);

  const state = await deps.probe(port);
  if (state === "studio") {
    const url = projectPath ? await deps.openProject(localHostUrl(port), projectPath) : localHostUrl(port);
    deps.log(`Screenshot Studio is already running at ${url}`);
    if (shouldOpen) deps.open(url);
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
  if (shouldOpen) deps.open(url);
  await deps.serve(server);
}
