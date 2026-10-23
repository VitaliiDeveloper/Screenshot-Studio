// SPDX-License-Identifier: Apache-2.0
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ATTACHMENT_EXTENSIONS, type AgentAttachment } from "./agent-attachments.js";

const ROOT_NAME = "screenshot-studio-agent-attachments";

export interface AgentRunFolder {
  dir: string;
  files: string[];
}

// Runs live in `<root>/<server pid>/<run>`, so a server removes only what a dead server left behind.
const attachmentRoot = () => join(tmpdir(), ROOT_NAME);
const ownFolder = () => join(attachmentRoot(), String(process.pid));

// Agent runs end with their process tree, but a server that exits mid-run skips every other cleanup.
process.once("exit", () => rmSync(ownFolder(), { recursive: true, force: true }));

/**
 * Writes the attachments into a fresh folder outside every project. The file names are generated
 * here from the detected type, so nothing the client sent reaches the file system or a CLI argument.
 */
export async function createRunFolder(attachments: readonly AgentAttachment[]): Promise<AgentRunFolder> {
  await mkdir(ownFolder(), { recursive: true, mode: 0o700 });
  // Resolved once so the paths handed to a CLI do not depend on a symlinked temp directory.
  const dir = await mkdtemp(join(await realpath(ownFolder()), "run-"));
  try {
    const files = await Promise.all(attachments.map(async ({ type, bytes }, index) => {
      const file = join(dir, `${index + 1}.${ATTACHMENT_EXTENSIONS[type]}`);
      await writeFile(file, bytes, { mode: 0o600, flag: "wx" });
      return file;
    }));
    return { dir, files };
  } catch (error) {
    await removeRunFolder(dir);
    throw error;
  }
}

export async function removeRunFolder(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists under another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Server start: removes the run folders of servers that no longer exist. A live server's folders,
 * including this process's own, stay.
 * shortcut: a crashed server's pid reused by a live process keeps that folder until the process ends.
 */
export async function sweepStaleRunFolders(): Promise<void> {
  const entries = await readdir(attachmentRoot()).catch(() => []);
  await Promise.all(entries.map(async (name) => {
    const pid = /^\d+$/.test(name) ? Number(name) : null;
    if (pid === process.pid || (pid !== null && processAlive(pid))) return;
    await rm(join(attachmentRoot(), name), { recursive: true, force: true }).catch(() => undefined);
  }));
}
