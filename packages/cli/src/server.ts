import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/**
 * Starts the `apps/web` render host and resolves only once it answers HTTP. Both `screenshots
 * export` and the parity harness use this so they drive the same served artifact. Readiness is
 * gated on a real HTTP response (not a fixed sleep), which is what keeps starting Next in a test
 * fast and non-flaky.
 */
export interface RunningServer {
  url: string;
  stop: () => Promise<void>;
}

type SpawnFn = (command: string, args: string[], options: Parameters<typeof nodeSpawn>[2]) => ChildProcess;
type WaitForHttpFn = (url: string, timeoutMs: number) => Promise<void>;

const webDir = resolve(fileURLToPath(new URL("../../../apps/web", import.meta.url)));

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // Any HTTP response (even 404) means the server is accepting connections.
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
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
}

export async function createServerController({
  port,
  projectPath,
  timeoutMs = 120_000,
  spawn = nodeSpawn,
  waitForHttp: wait = waitForHttp,
}: ServerControllerOptions = {}): Promise<RunningServer> {
  const selectedPort = await resolveServerPort(port);
  const child: ChildProcess = spawn("pnpm", ["exec", "next", "dev", "--port", String(selectedPort)], {
    cwd: webDir,
    stdio: "ignore",
    env: {
      ...process.env,
      NODE_ENV: "development",
      ...(projectPath ? { PROJECT_PATH: projectPath } : {}),
    },
  });

  const url = `http://localhost:${selectedPort}`;
  try {
    await wait(url, timeoutMs);
  } catch (err) {
    child.kill("SIGTERM");
    throw err;
  }

  const stop = () =>
    new Promise<void>((resolveStop) => {
      if (child.exitCode !== null || child.killed) return resolveStop();
      child.once("exit", () => resolveStop());
      child.kill("SIGTERM");
    });

  return { url, stop };
}

export async function startWebServer(
  port?: number,
  options: { projectPath?: string; timeoutMs?: number } = {},
): Promise<RunningServer> {
  return createServerController({ port, projectPath: options.projectPath, timeoutMs: options.timeoutMs });
}
