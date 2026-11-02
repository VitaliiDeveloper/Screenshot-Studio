// SPDX-License-Identifier: Apache-2.0
import { constants, rmSync, type Dir } from "node:fs";
import { lstat, mkdtemp, open, opendir, realpath, rm, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_RENDER_REQUEST_BYTES,
  renderPickedFile,
  renderRequestFile,
  renderRequestId,
  renderResponseFile,
} from "@screenshot-studio/core/agent-render";
import { publishFileSafely } from "@screenshot-studio/cli/safe-file-publisher";
import { privateDirectory } from "./agent-attachment-store.server.js";

const MAX_INBOX_ENTRIES = 1024;
const uid = process.getuid?.();

/**
 * The one temp folder both sandboxes can already write without a setting: Claude Code's sandbox
 * writes only to its working directory and `/tmp/claude-<uid>`, and Codex's workspace profile covers
 * `/tmp`. The operating-system temp folder is closed to Claude Code, and the project folder would
 * show the inbox in `folderManifest`.
 */
const sandboxTempFolder = () => (uid === undefined ? tmpdir() : join("/tmp", `claude-${uid}`));
export const renderInboxRoot = () => join(sandboxTempFolder(), "screenshot-studio-render");
const ownFolder = () => join(renderInboxRoot(), String(process.pid));

process.once("exit", () => rmSync(ownFolder(), { recursive: true, force: true }));

export class RenderInboxMovedError extends Error {
  constructor() {
    super("The render inbox is no longer the folder the editor created");
    this.name = "RenderInboxMovedError";
  }
}

export interface RenderInbox {
  dir: string;
  /** Throws RenderInboxMovedError unless `dir` is still the exact folder created for this run. */
  assertIntact(): Promise<void>;
  /** Ids of the requests in the folder that are not in `seen`; any other name is ignored. */
  newRequestIds(seen: ReadonlySet<string>): Promise<string[]>;
  /** The request's bytes, or null for anything but a small regular file with one link. */
  readRequest(id: string): Promise<Buffer | null>;
  /** The held handle lets a heartbeat touch this marker and never a link swapped into its place. */
  createPickedMarker(id: string): Promise<FileHandle>;
  /** Create-only and no-follow, so a file or link the agent planted first wins and is left alone. */
  writeResponse(id: string, bytes: string): Promise<void>;
  remove(): Promise<void>;
}

async function requestBytes(path: string): Promise<Buffer | null> {
  // O_NONBLOCK: opening a FIFO the agent left here must not hang the broker.
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => null);
  if (!handle) return null;
  try {
    const entry = await handle.stat();
    if (!entry.isFile() || entry.nlink !== 1 || entry.size > MAX_RENDER_REQUEST_BYTES) return null;
    const buffer = Buffer.alloc(MAX_RENDER_REQUEST_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return bytesRead > MAX_RENDER_REQUEST_BYTES ? null : buffer.subarray(0, bytesRead);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** Creates this run's inbox. The agent can write its parent, so nothing here trusts the path alone. */
export async function createRenderInbox(): Promise<RenderInbox> {
  await privateDirectory(sandboxTempFolder());
  await privateDirectory(renderInboxRoot());
  await privateDirectory(ownFolder());
  const dir = await mkdtemp(join(await realpath(ownFolder()), "run-"));
  const created = await lstat(dir);

  const assertIntact = async () => {
    const [entry, real] = await Promise.all([lstat(dir), realpath(dir)]).catch(() => [null, null] as const);
    if (!entry?.isDirectory() || entry.dev !== created.dev || entry.ino !== created.ino || real !== dir) {
      throw new RenderInboxMovedError();
    }
  };

  return {
    dir,
    assertIntact,
    async newRequestIds(seen) {
      await assertIntact();
      const ids: string[] = [];
      let entries = 0;
      const folder: Dir = await opendir(dir);
      for await (const { name } of folder) {
        entries += 1;
        // A folder this full is an attack, not a run: no agent leaves that many answered requests.
        if (entries > MAX_INBOX_ENTRIES) throw new RenderInboxMovedError();
        const id = renderRequestId(name);
        if (id && !seen.has(id)) ids.push(id);
      }
      return ids;
    },
    async readRequest(id) {
      await assertIntact();
      return requestBytes(join(dir, renderRequestFile(id)));
    },
    async createPickedMarker(id) {
      await assertIntact();
      return open(
        join(dir, renderPickedFile(id)),
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
    },
    async writeResponse(id, bytes) {
      await assertIntact();
      await publishFileSafely({ root: dir, relativePath: renderResponseFile(id), bytes: Buffer.from(bytes), replace: false });
    },
    async remove() {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}
