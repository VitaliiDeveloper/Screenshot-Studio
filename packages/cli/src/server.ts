// SPDX-License-Identifier: Apache-2.0
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { finished } from "node:stream/promises";
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

const RENDER_HOST_STDERR_TAIL_BYTES = 64 * 1024;

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

interface StderrCapture {
  drained: Promise<void>;
  readTail: () => { text: string; truncated: boolean };
}

function captureStderrTail(child: ChildProcess): StderrCapture {
  let tail = Buffer.alloc(0);
  let truncated = false;
  const stderr = child.stderr;
  if (!stderr) {
    return {
      drained: Promise.resolve(),
      readTail: () => ({ text: "", truncated: false }),
    };
  }

  const onData = (chunk: Buffer | string) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (bytes.length >= RENDER_HOST_STDERR_TAIL_BYTES) {
      truncated ||= tail.length > 0 || bytes.length > RENDER_HOST_STDERR_TAIL_BYTES;
      tail = Buffer.from(bytes.subarray(bytes.length - RENDER_HOST_STDERR_TAIL_BYTES));
      return;
    }
    truncated ||= tail.length + bytes.length > RENDER_HOST_STDERR_TAIL_BYTES;
    const previousBytes = RENDER_HOST_STDERR_TAIL_BYTES - bytes.length;
    tail = Buffer.concat([tail.subarray(Math.max(0, tail.length - previousBytes)), bytes]);
  };
  stderr.on("data", onData);

  return {
    drained: finished(stderr, { cleanup: true }).then(
      () => undefined,
      () => undefined,
    ).finally(() => stderr.off("data", onData)),
    readTail: () => ({ text: tail.toString("utf8").trimEnd(), truncated }),
  };
}

function withRenderHostStderr(
  error: unknown,
  stderr: { text: string; truncated: boolean },
): Error {
  const base = error instanceof Error ? error : new Error(String(error));
  if (!stderr.text.trim()) return base;
  const label = stderr.truncated
    ? "Render host stderr tail truncated"
    : "Render host stderr";
  return new Error(`${base.message}\n${label}:\n${stderr.text}`, { cause: base });
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
  const stderrCapture = captureStderrTail(child);

  const url = `http://localhost:${selectedPort}`;
  let stopping = false;
  let resolveUnexpectedExit!: (error: Error) => void;
  const unexpectedExit = new Promise<Error>((resolveExit) => {
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
      if (!terminateError) await stderrCapture.drained;
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
      unexpectedExit.then((error) => { throw error; }),
    ]);
  } catch (error) {
    let cleanupFailed = false;
    let cleanupError: unknown;
    try {
      await stop();
    } catch (caughtCleanupError) {
      cleanupFailed = true;
      cleanupError = caughtCleanupError;
    }
    await stderrCapture.drained;
    const decoratedError = withRenderHostStderr(error, stderrCapture.readTail());
    if (cleanupFailed) throw lifecycleErrors(decoratedError, cleanupError);
    throw decoratedError;
  }

  const exited = unexpectedExit.then(async (error) => {
    await stderrCapture.drained;
    return withRenderHostStderr(error, stderrCapture.readTail());
  });
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
