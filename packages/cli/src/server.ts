import { spawn, type ChildProcess } from "node:child_process";
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

export async function startWebServer(
  port = 3100,
  { timeoutMs = 120_000 }: { timeoutMs?: number } = {},
): Promise<RunningServer> {
  const child: ChildProcess = spawn("pnpm", ["exec", "next", "dev", "--port", String(port)], {
    cwd: webDir,
    stdio: "ignore",
    env: { ...process.env, NODE_ENV: "development" },
  });

  const url = `http://localhost:${port}`;
  try {
    await waitForHttp(url, timeoutMs);
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
