// SPDX-License-Identifier: Apache-2.0
import { spawn } from "node:child_process";
import { parsePortFlag, serveUntilStopped } from "./dev-command.js";
import { localHostUrl, startWebServer, type RunningServer } from "./server.js";
import { AGENT_MARKER_ENV } from "./upload-command.js";
import { isSet } from "./update-check.js";

/**
 * `screenshots` with no command: the production host without a pinned project, so it opens the
 * project library. A fixed port keeps one browser origin across launches, and with it the editor
 * settings the browser stores per origin.
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

export interface LaunchDependencies {
  env: NodeJS.ProcessEnv;
  interactive: boolean;
  probe: (port: number) => Promise<PortState>;
  ensureBrowsers: () => Promise<void>;
  startServer: (port: number | undefined) => Promise<RunningServer>;
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
    interactive: Boolean(process.stdout.isTTY),
    probe: (port) => probeLaunchPort(port),
    ensureBrowsers,
    startServer: (port) => startWebServer(port, { storeSpecsPath }),
    serve: serveUntilStopped,
    open: (url) => openInBrowser(url, log),
    log,
    warn: (message) => console.warn(message),
  };
}

export async function runLaunchCommand(flags: Record<string, string>, deps: LaunchDependencies): Promise<void> {
  if (deps.env[AGENT_MARKER_ENV] !== undefined) {
    throw new Error(
      `screenshots without a command opens the editor for a person and does not run in an agent session (${AGENT_MARKER_ENV} is set). Run a command such as screenshots check instead.`,
    );
  }
  const requestedPort = parsePortFlag(flags.port);
  const port = requestedPort ?? DEFAULT_LAUNCH_PORT;
  const shouldOpen = deps.interactive && flags["no-open"] !== "true" && !isSet(deps.env.CI);

  const state = await deps.probe(port);
  if (state === "studio") {
    deps.log(`Screenshot Studio is already running at ${localHostUrl(port)}`);
    if (shouldOpen) deps.open(localHostUrl(port));
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
  deps.log(`Screenshot Studio is running at ${server.url}\nPress Ctrl+C to stop it.`);
  if (shouldOpen) deps.open(server.url);
  await deps.serve(server);
}
