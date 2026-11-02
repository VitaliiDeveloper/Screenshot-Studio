// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { link, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRenderRequest, AgentRenderResponse } from "@screenshot-studio/core/agent-render";
import { startRenderBroker, type RenderBroker, type RenderBrokerOptions } from "./agent-render-broker.server.js";
import type { RenderJobContext } from "./agent-render-job.server.js";

const SECRET = "FAKE-KEY-BYTES-123";
const REFUSED = { ok: false, message: "The editor refused this render request." };
const DONE: AgentRenderResponse = { ok: true, output: "done", exitCode: 0 };
const EXPORT = { command: "export", flags: {} };

let root: string;
let keyFile: string;
let broker: RenderBroker;
let jobs: Array<{ request: AgentRenderRequest; context: RenderJobContext }>;
const host = { origin: "http://127.0.0.1:1", guard: <T>(operation: () => Promise<T>) => operation() };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "render-broker-"));
  keyFile = join(root, "key.json");
  await writeFile(keyFile, JSON.stringify({ private_key: SECRET }));
  jobs = [];
});

afterEach(async () => {
  await broker?.stop();
  await rm(root, { recursive: true, force: true });
});

async function start(
  runJob: NonNullable<RenderBrokerOptions["runJob"]> = async () => DONE,
  options: Partial<RenderBrokerOptions> = {},
): Promise<RenderBroker> {
  broker = await startRenderBroker({
    projectDir: root,
    host,
    pollMs: 5,
    heartbeatMs: 10,
    runJob: (request, context) => {
      jobs.push({ request, context });
      return runJob(request, context);
    },
    ...options,
  });
  return broker;
}

const requestPath = (id: string) => join(broker.inboxDir, `request-${id}.json`);
const pickedPath = (id: string) => join(broker.inboxDir, `picked-${id}`);
const responsePath = (id: string) => join(broker.inboxDir, `response-${id}.json`);

async function send(body: unknown = EXPORT): Promise<string> {
  const id = randomUUID();
  await writeFile(requestPath(id), typeof body === "string" ? body : JSON.stringify(body));
  return id;
}

async function until(condition: () => boolean | Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!await condition()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function response(id: string): Promise<unknown> {
  await until(() => existsSync(responsePath(id)));
  return JSON.parse(await readFile(responsePath(id), "utf8"));
}

function gate(): { wait: Promise<void>; open: () => void } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => { open = resolve; });
  return { wait, open };
}

describe.skipIf(process.platform === "win32")("render broker", () => {
  it("creates the inbox outside the project, privately, in the temp folder both sandboxes can write", async () => {
    await start();
    expect(broker.inboxDir.startsWith(join(root, ""))).toBe(false);
    expect(broker.inboxDir).toMatch(new RegExp(`/tmp/claude-${process.getuid!()}/screenshot-studio-render/${process.pid}/run-`));
    expect((await stat(broker.inboxDir)).mode & 0o077).toBe(0);
  });

  it("marks a request as picked up, runs it with the validated flags, and answers", async () => {
    await start();
    const id = await send({ command: "export", flags: { screen: "hero" } });
    await expect(response(id)).resolves.toEqual(DONE);
    expect(existsSync(pickedPath(id))).toBe(true);
    expect(jobs[0]!.request).toEqual({ command: "export", flags: { screen: "hero" } });
    expect(jobs[0]!.context.projectDir).toBe(root);
  });

  it("ignores every name the protocol does not define", async () => {
    await start();
    await writeFile(join(broker.inboxDir, "request-1.json"), JSON.stringify(EXPORT));
    await writeFile(join(broker.inboxDir, `.draft-${randomUUID()}`), JSON.stringify(EXPORT));
    await writeFile(join(broker.inboxDir, `request-${randomUUID()}.json.tmp`), JSON.stringify(EXPORT));
    const id = await send();
    await response(id);
    expect(jobs).toHaveLength(1);
    expect((await readdir(broker.inboxDir)).filter((name) => name.startsWith("picked-"))).toEqual([`picked-${id}`]);
  });

  describe("an invalid request gets one fixed answer that quotes nothing", () => {
    const refused = async (id: string) => {
      const answer = await response(id);
      expect(answer).toEqual(REFUSED);
      expect(JSON.stringify(answer)).not.toContain(SECRET);
      expect(jobs).toHaveLength(0);
    };

    it("a link to a key file", async () => {
      await start();
      const id = randomUUID();
      await symlink(keyFile, requestPath(id));
      await refused(id);
    });

    it("a hard link to a key file", async () => {
      await start();
      const id = randomUUID();
      await link(keyFile, requestPath(id));
      await refused(id);
    });

    it("JSON that names a forbidden flag or quotes the key", async () => {
      await start();
      await refused(await send({ command: "export", flags: { project: SECRET } }));
      await refused(await send({ command: "export", flags: { out: SECRET } }));
      await refused(await send({ command: "export", flags: { browser: SECRET } }));
      await refused(await send({ command: "upload", flags: {} }));
      await refused(await send(`{"private_key":"${SECRET}"`));
    });

    it("a file over the size cap", async () => {
      await start();
      await refused(await send(`${SECRET}${" ".repeat(8_000)}`));
    });

    it("a folder in the request's place", async () => {
      await start();
      const id = randomUUID();
      await mkdir(requestPath(id));
      await refused(id);
    });

    it("a FIFO, which must not hang the broker", async () => {
      await start();
      const id = randomUUID();
      execFileSync("mkfifo", [requestPath(id)]);
      await refused(id);
      await expect(response(await send())).resolves.toEqual(DONE);
    });
  });

  describe("an agent racing the broker's own files", () => {
    it("loses only its own answer when it plants the response first, and the planted file stays", async () => {
      const release = gate();
      await start(async () => { await release.wait; return DONE; });
      const id = await send();
      await until(() => jobs.length === 1);
      await writeFile(responsePath(id), "planted");
      release.open();
      await expect(response(await send())).resolves.toEqual(DONE);
      expect(await readFile(responsePath(id), "utf8")).toBe("planted");
    });

    it("never writes through a link planted as the response", async () => {
      const release = gate();
      await start(async () => { await release.wait; return DONE; });
      const id = await send();
      await until(() => jobs.length === 1);
      await symlink(keyFile, responsePath(id));
      release.open();
      await expect(response(await send())).resolves.toEqual(DONE);
      expect(await readFile(keyFile, "utf8")).toContain(SECRET);
      expect((await lstat(responsePath(id))).isSymbolicLink()).toBe(true);
    });

    it("skips a request whose picked marker it did not create, without touching a linked target", async () => {
      await start();
      const before = (await stat(keyFile)).mtimeMs;
      const id = randomUUID();
      await symlink(keyFile, pickedPath(id));
      await writeFile(requestPath(id), JSON.stringify(EXPORT));
      await expect(response(await send())).resolves.toEqual(DONE);
      expect(jobs).toHaveLength(1);
      expect((await stat(keyFile)).mtimeMs).toBe(before);
      expect(existsSync(responsePath(id))).toBe(false);
    });

    it("heartbeats the marker it created and never a link swapped in afterwards", async () => {
      const release = gate();
      await start(async () => { await release.wait; return DONE; });
      await utimes(keyFile, 1, 1);
      const id = await send();
      await until(() => jobs.length === 1);
      const first = (await stat(pickedPath(id))).mtimeMs;
      await until(async () => (await stat(pickedPath(id))).mtimeMs !== first);
      await rm(pickedPath(id));
      await symlink(keyFile, pickedPath(id));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect((await stat(keyFile)).mtimeMs).toBe(1000);
      release.open();
    });
  });

  describe("a swapped inbox stops the broker", () => {
    const assertStopped = async (dir: string) => {
      await writeFile(join(dir, `request-${randomUUID()}.json`), JSON.stringify(EXPORT));
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(jobs).toHaveLength(0);
    };

    it("a link in its place", async () => {
      await start();
      const elsewhere = join(root, "elsewhere");
      await mkdir(elsewhere);
      const dir = broker.inboxDir;
      await rename(dir, `${dir}-moved`);
      await symlink(elsewhere, dir);
      await assertStopped(elsewhere);
      expect(await readdir(elsewhere)).toHaveLength(1);
      await rm(dir);
      await rm(`${dir}-moved`, { recursive: true, force: true });
    });

    it("another folder with the same path", async () => {
      await start();
      const dir = broker.inboxDir;
      await rename(dir, `${dir}-moved`);
      await mkdir(dir);
      await assertStopped(dir);
      expect((await readdir(dir)).some((name) => name.startsWith("picked-"))).toBe(false);
      await rm(`${dir}-moved`, { recursive: true, force: true });
    });

    it("a folder flooded with entries", async () => {
      await start();
      await Promise.all(Array.from({ length: 1100 }, (_, index) => writeFile(join(broker.inboxDir, `x-${index}`), "")));
      await new Promise((resolve) => setTimeout(resolve, 60));
      await assertStopped(broker.inboxDir);
    });
  });

  describe("queue", () => {
    it("runs one job at a time and marks a queued request as picked up at once", async () => {
      const release = gate();
      let running = 0;
      let most = 0;
      await start(async () => {
        running += 1;
        most = Math.max(most, running);
        await release.wait;
        running -= 1;
        return DONE;
      });
      const first = await send();
      await until(() => jobs.length === 1);
      const second = await send();
      await until(() => existsSync(pickedPath(second)));
      expect(jobs).toHaveLength(1);
      release.open();
      await Promise.all([response(first), response(second)]);
      expect(most).toBe(1);
      expect(jobs).toHaveLength(2);
    });

    it("heartbeats a queued request too", async () => {
      const release = gate();
      await start(async () => { await release.wait; return DONE; });
      await send();
      await until(() => jobs.length === 1);
      const queued = await send();
      await until(() => existsSync(pickedPath(queued)));
      const first = (await stat(pickedPath(queued))).mtimeMs;
      await until(async () => (await stat(pickedPath(queued))).mtimeMs !== first);
      release.open();
    });

    it("refuses requests past a short queue", async () => {
      const release = gate();
      await start(async () => { await release.wait; return DONE; });
      await send();
      await until(() => jobs.length === 1);
      for (let queued = 0; queued < 4; queued += 1) {
        const id = await send();
        await until(() => existsSync(pickedPath(id)));
      }
      await expect(response(await send())).resolves.toMatchObject({ ok: false, message: expect.stringContaining("already busy") });
      release.open();
    });

    it("answers with a limit once a run used its requests", async () => {
      await start(undefined, { maxRequests: 2 });
      await response(await send());
      await response(await send());
      await expect(response(await send())).resolves.toMatchObject({ ok: false, message: expect.stringContaining("limit") });
      expect(jobs).toHaveLength(2);
    });
  });

  describe("stop", () => {
    it("removes the inbox and is safe to call twice", async () => {
      await start();
      const { inboxDir } = broker;
      await Promise.all([broker.stop(), broker.stop()]);
      await broker.stop();
      expect(existsSync(inboxDir)).toBe(false);
    });

    it("cancels and waits for a job that holds the guard, and answers nothing afterwards", async () => {
      const release = gate();
      await start(async (_request, context) => {
        context.onGuardHeld?.();
        await release.wait;
        return DONE;
      });
      const id = await send();
      await until(() => jobs.length === 1);
      let stopped = false;
      const stopping = broker.stop().then(() => { stopped = true; });
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(stopped).toBe(false);
      expect(jobs[0]!.context.isCancelled()).toBe(true);
      release.open();
      await stopping;
      expect(existsSync(responsePath(id))).toBe(false);
    });

    it("does not wait for a job still queuing for the guard, so a delete holding that lock cannot stall", async () => {
      const lock = gate();
      const operations = vi.fn();
      await start(async (_request, context) => context.guard(async () => {
        context.onGuardHeld?.();
        operations(context.isCancelled());
        return DONE;
      }), { host: { ...host, guard: async (operation) => { await lock.wait; return operation(); } } });
      await send();
      await send();
      await until(() => jobs.length === 1);
      await broker.stop();
      expect(operations).not.toHaveBeenCalled();
      lock.open();
      await until(() => operations.mock.calls.length === 1);
      expect(operations).toHaveBeenCalledWith(true);
      expect(jobs).toHaveLength(1);
    });

    it("never starts a queued job after a stop", async () => {
      const release = gate();
      await start(async (_request, context) => {
        context.onGuardHeld?.();
        await release.wait;
        return DONE;
      });
      await send();
      await until(() => jobs.length === 1);
      const queued = await send();
      await until(() => existsSync(pickedPath(queued)));
      const stopping = broker.stop();
      release.open();
      await stopping;
      expect(jobs).toHaveLength(1);
    });

    it("a failed job still frees the queue", async () => {
      let calls = 0;
      await start(async () => {
        calls += 1;
        if (calls === 1) throw new Error("boom");
        return DONE;
      });
      await send();
      await until(() => calls === 1);
      await expect(response(await send())).resolves.toEqual(DONE);
    });
  });
});
