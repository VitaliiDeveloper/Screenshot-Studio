// SPDX-License-Identifier: Apache-2.0
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import type { Readable } from "node:stream";
import { prepareRenderHost, type PreparedRenderHost } from "./packaged-render-host.js";

export {
  extractWebArchive,
  materializeSharpRuntime,
  prepareRenderHost,
  type PreparedRenderHost,
} from "./packaged-render-host.js";

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

type SpawnFn = (command: string, args: string[], options: Parameters<typeof nodeSpawn>[2]) => ChildProcess;
type WaitForHttpFn = (url: string, timeoutMs: number) => Promise<void>;
type PrepareRenderHostFn = (port: number) => Promise<PreparedRenderHost>;

const RENDER_HOST_STDERR_TAIL_BYTES = 16 * 1024;
const stderrDiagnosticsApplied = Symbol("stderrDiagnosticsApplied");

interface StderrTail {
  snapshot(): { text: string; truncated: boolean };
  dispose(): void;
}

function captureStderrTail(stderr: Readable | null): StderrTail {
  let tail = Buffer.alloc(0);
  let truncated = false;
  const onData = (chunk: Buffer | string) => {
    const incoming = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    if (incoming.length >= RENDER_HOST_STDERR_TAIL_BYTES) {
      truncated ||= tail.length > 0 || incoming.length > RENDER_HOST_STDERR_TAIL_BYTES;
      tail = Buffer.from(incoming.subarray(incoming.length - RENDER_HOST_STDERR_TAIL_BYTES));
      return;
    }
    const combinedLength = tail.length + incoming.length;
    if (combinedLength <= RENDER_HOST_STDERR_TAIL_BYTES) {
      tail = Buffer.concat([tail, incoming], combinedLength);
    } else {
      truncated = true;
      const retainedPrefixBytes = RENDER_HOST_STDERR_TAIL_BYTES - incoming.length;
      tail = Buffer.concat([
        tail.subarray(Math.max(0, tail.length - retainedPrefixBytes)),
        incoming,
      ], RENDER_HOST_STDERR_TAIL_BYTES);
    }
  };
  stderr?.on("data", onData);
  return {
    snapshot: () => ({ text: tail.toString("utf8").trimEnd(), truncated }),
    dispose() {
      stderr?.off("data", onData);
      tail = Buffer.alloc(0);
      truncated = false;
    },
  };
}

function withStderrDiagnostics(error: unknown, stderr: StderrTail): Error {
  const base = error instanceof Error ? error : new Error(String(error));
  if ((base as Error & { [stderrDiagnosticsApplied]?: boolean })[stderrDiagnosticsApplied]) {
    return base;
  }
  const snapshot = stderr.snapshot();
  if (!snapshot.text) return base;
  const label = snapshot.truncated
    ? "render host stderr tail truncated"
    : "render host stderr tail";
  const diagnosed = new Error(`${base.message}\n\n[${label}]\n${snapshot.text}`, { cause: base });
  diagnosed.name = base.name;
  (diagnosed as Error & { [stderrDiagnosticsApplied]?: boolean })[stderrDiagnosticsApplied] = true;
  return diagnosed;
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
  storeSpecsPath?: string;
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
  storeSpecsPath,
  timeoutMs = 120_000,
  spawn = nodeSpawn,
  waitForHttp: wait = waitForHttp,
  prepareHost = prepareRenderHost,
}: ServerControllerOptions = {}): Promise<RunningServer> {
  const selectedPort = await resolveServerPort(port);
  const host = await prepareHost(selectedPort);
  const child: ChildProcess = spawn(host.command, host.args, {
    cwd: host.cwd,
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      ...host.env,
      ...(projectPath ? { PROJECT_PATH: projectPath } : {}),
      ...(storeSpecsPath ? { STORE_SPECS_PATH: storeSpecsPath } : {}),
    },
  });
  const stderrTail = captureStderrTail(child.stderr);

  const url = `http://localhost:${selectedPort}`;
  let stopping = false;
  let resolveUnexpectedExit!: (error: Error) => void;
  const exited = new Promise<Error>((resolveExit) => {
    resolveUnexpectedExit = resolveExit;
  });
  child.once("error", (error) => {
    if (!stopping) {
      resolveUnexpectedExit(withStderrDiagnostics(
        new Error(`Render host failed: ${error.message}`, { cause: error }),
        stderrTail,
      ));
    }
  });
  child.once("exit", (code, signal) => {
    if (stopping) return;
    const status = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
    resolveUnexpectedExit(withStderrDiagnostics(
      new Error(`Render host exited unexpectedly (${status})`),
      stderrTail,
    ));
  });

  let stopPromise: Promise<void> | undefined;
  const stop = () => {
    stopPromise ??= (async () => {
      stopping = true;
      let terminateError: unknown;
      let hasTerminateError = false;
      try {
        await terminateChild(child);
      } catch (error) {
        terminateError = error;
        hasTerminateError = true;
      }
      let cleanupError: unknown;
      let hasCleanupError = false;
      try {
        await host.cleanup();
      } catch (error) {
        cleanupError = error;
        hasCleanupError = true;
      }
      stderrTail.dispose();
      if (hasTerminateError && hasCleanupError) {
        throw lifecycleErrors(terminateError, cleanupError);
      }
      if (hasTerminateError) throw terminateError;
      if (hasCleanupError) throw cleanupError;
    })();
    return stopPromise;
  };

  try {
    await Promise.race([
      wait(url, timeoutMs),
      exited.then((error) => { throw error; }),
    ]);
  } catch (error) {
    const diagnosedError = withStderrDiagnostics(error, stderrTail);
    try {
      await stop();
    } catch (cleanupError) {
      throw lifecycleErrors(diagnosedError, cleanupError);
    }
    throw diagnosedError;
  }

  return { url, exited, stop };
}

export async function startWebServer(
  port?: number,
  options: { projectPath?: string; storeSpecsPath?: string; timeoutMs?: number } = {},
): Promise<RunningServer> {
  return createServerController({
    port,
    projectPath: options.projectPath,
    storeSpecsPath: options.storeSpecsPath,
    timeoutMs: options.timeoutMs,
  });
}
