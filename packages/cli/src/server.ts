// SPDX-License-Identifier: Apache-2.0
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

/**
 * Starts either the source-checkout Next dev host or the packaged standalone host and resolves only
 * once it answers HTTP. Export and parity still drive the exact same web renderer in both modes.
 */
export interface RunningServer {
  url: string;
  /** Resolves only when the child exits unexpectedly before an explicit stop. */
  exited: Promise<Error>;
  stop: () => Promise<void>;
}

export interface PreparedRenderHost {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cleanup: () => Promise<void>;
}

type SpawnFn = (command: string, args: string[], options: Parameters<typeof nodeSpawn>[2]) => ChildProcess;
type WaitForHttpFn = (url: string, timeoutMs: number) => Promise<void>;
type PrepareRenderHostFn = (port: number) => Promise<PreparedRenderHost>;

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceWebDir = resolve(packageRoot, "../../apps/web");
const packagedWebArchive = join(packageRoot, "runtime", "web.zip");
const packagedServerEntry = join("apps", "web", "server.js");

function isWithin(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

/** Extract the trusted build-time standalone host without accepting archive path traversal. */
export async function extractWebArchive(archivePath: string, destination: string): Promise<void> {
  const archive = await JSZip.loadAsync(await readFile(archivePath));
  for (const entry of Object.values(archive.files)) {
    const target = resolve(destination, entry.name);
    if (!isWithin(destination, target)) {
      throw new Error(`Unsafe packaged render-host path "${entry.name}"`);
    }
    if (entry.dir) {
      await mkdir(target, { recursive: true });
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await entry.async("nodebuffer"));
  }
}

export async function prepareRenderHost(port: number): Promise<PreparedRenderHost> {
  if (!existsSync(packagedWebArchive)) {
    return {
      command: "pnpm",
      args: ["exec", "next", "dev", "--port", String(port)],
      cwd: sourceWebDir,
      env: { NODE_ENV: "development" },
      cleanup: async () => undefined,
    };
  }

  const directory = await mkdtemp(join(tmpdir(), "screenshot-studio-web-"));
  try {
    await extractWebArchive(packagedWebArchive, directory);
    const entry = join(directory, packagedServerEntry);
    if (!existsSync(entry)) throw new Error(`Packaged render host is missing ${packagedServerEntry}`);
    return {
      command: process.execPath,
      args: [entry],
      cwd: dirname(entry),
      env: { NODE_ENV: "production", PORT: String(port), HOSTNAME: "127.0.0.1" },
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // Any HTTP response (even 404) means the server is accepting connections.
      await fetch(url);
      return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
  }
  throw new Error(`Web server did not become ready within ${timeoutMs}ms`);
}

export async function resolveServerPort(port?: number): Promise<number> {
  if (port) return port;

  return new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate a free render host port")));
        return;
      }
      const selected = address.port;
      server.close(() => resolvePort(selected));
    });
  });
}

export interface ServerControllerOptions {
  port?: number;
  projectPath?: string;
  timeoutMs?: number;
  spawn?: SpawnFn;
  waitForHttp?: WaitForHttpFn;
  prepareHost?: PrepareRenderHostFn;
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolveStop) => {
    child.once("exit", () => resolveStop());
    child.kill("SIGTERM");
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function lifecycleErrors(primary: unknown, cleanup: unknown): AggregateError {
  return new AggregateError(
    [primary, cleanup],
    `${errorText(primary)}; render-host cleanup failed: ${errorText(cleanup)}`,
    { cause: primary },
  );
}

export async function createServerController({
  port,
  projectPath,
  timeoutMs = 120_000,
  spawn = nodeSpawn,
  waitForHttp: wait = waitForHttp,
  prepareHost = prepareRenderHost,
}: ServerControllerOptions = {}): Promise<RunningServer> {
  const selectedPort = await resolveServerPort(port);
  const host = await prepareHost(selectedPort);
  const child: ChildProcess = spawn(host.command, host.args, {
    cwd: host.cwd,
    stdio: "ignore",
    env: {
      ...process.env,
      ...host.env,
      ...(projectPath ? { PROJECT_PATH: projectPath } : {}),
    },
  });

  const url = `http://localhost:${selectedPort}`;
  let stopping = false;
  let resolveUnexpectedExit!: (error: Error) => void;
  const exited = new Promise<Error>((resolveExit) => {
    resolveUnexpectedExit = resolveExit;
  });
  child.once("error", (error) => {
    if (!stopping) resolveUnexpectedExit(new Error(`Render host failed: ${error.message}`, { cause: error }));
  });
  child.once("exit", (code, signal) => {
    if (stopping) return;
    const status = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
    resolveUnexpectedExit(new Error(`Render host exited unexpectedly (${status})`));
  });

  let stopPromise: Promise<void> | undefined;
  const stop = () => {
    stopPromise ??= (async () => {
      stopping = true;
      let terminateError: unknown;
      try {
        await terminateChild(child);
      } catch (error) {
        terminateError = error;
      }
      try {
        await host.cleanup();
      } catch (cleanupError) {
        if (terminateError) throw lifecycleErrors(terminateError, cleanupError);
        throw cleanupError;
      }
      if (terminateError) throw terminateError;
    })();
    return stopPromise;
  };

  try {
    await Promise.race([
      wait(url, timeoutMs),
      exited.then((error) => { throw error; }),
    ]);
  } catch (error) {
    try {
      await stop();
    } catch (cleanupError) {
      throw lifecycleErrors(error, cleanupError);
    }
    throw error;
  }

  return { url, exited, stop };
}

export async function startWebServer(
  port?: number,
  options: { projectPath?: string; timeoutMs?: number } = {},
): Promise<RunningServer> {
  return createServerController({ port, projectPath: options.projectPath, timeoutMs: options.timeoutMs });
}
