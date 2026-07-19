// SPDX-License-Identifier: Apache-2.0
import { constants, createWriteStream } from "node:fs";
import {
  lstat,
  mkdtemp,
  open,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import JSZip from "jszip";
import { isSupportedProjectArchivePath } from "./project-archive-policy.js";
import { ManagedProjectRepository } from "./managed-project-repository.server.js";
import {
  assertManagedProjectLifecycleLockHeld,
  withManagedProjectLifecycleLock,
  type ManagedProjectLifecycleLock,
} from "./managed-project-lifecycle-lock.server.js";

const PROJECT_FILE = "app-store-screenshots.json";
const ARCHIVE_FILENAME = "screenshot-studio-project.zip";
const ARCHIVE_DATE = new Date("1980-01-01T00:00:00.000Z");

interface ArchiveSourceIdentity {
  device: bigint;
  inode: bigint;
  size: bigint;
}

interface ArchivePathStat {
  dev: bigint;
  ino: bigint;
  size: bigint;
  nlink: bigint;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

interface ArchiveDirectoryIdentity {
  device: bigint;
  inode: bigint;
}

interface ArchiveSourceFile {
  absolutePath: string;
  relativePath: string;
  identity: ArchiveSourceIdentity;
}

export interface ManagedProjectArchiveArtifact {
  path: string;
  filename: string;
  dispose(): Promise<void>;
}

export interface ManagedProjectArchiveServiceDependencies {
  removeTemporaryRoot?: (path: string) => Promise<void>;
  statPath?: (path: string) => Promise<ArchivePathStat>;
}

function readFlags(): number {
  return constants.O_RDONLY
    | constants.O_NONBLOCK
    | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0);
}

async function* verifiedFileChunks(source: ArchiveSourceFile): AsyncGenerator<Buffer> {
  const handle = await open(source.absolutePath, readFlags());
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n
      || stat.dev !== source.identity.device
      || stat.ino !== source.identity.inode
      || stat.size !== source.identity.size) {
      throw new Error(`Managed project archive source changed during export: ${source.relativePath}`);
    }
    const stream = handle.createReadStream({ autoClose: false });
    for await (const chunk of stream) yield Buffer.from(chunk);
  } finally {
    await handle.close();
  }
}

export class ManagedProjectArchiveService {
  readonly #removeTemporaryRoot: (path: string) => Promise<void>;
  readonly #statPath: (path: string) => Promise<ArchivePathStat>;

  constructor(
    readonly repository: ManagedProjectRepository,
    dependencies: ManagedProjectArchiveServiceDependencies = {},
  ) {
    this.#removeTemporaryRoot = dependencies.removeTemporaryRoot
      ?? ((path) => rm(path, { recursive: true, force: true }));
    this.#statPath = dependencies.statPath
      ?? ((path) => lstat(path, { bigint: true }));
  }

  async create(
    projectId: string,
    lifecycleLock?: ManagedProjectLifecycleLock,
  ): Promise<ManagedProjectArchiveArtifact> {
    if (lifecycleLock) {
      assertManagedProjectLifecycleLockHeld(lifecycleLock, this.repository.config, projectId);
      return this.#createUnderLifecycleLock(projectId, lifecycleLock);
    }
    return withManagedProjectLifecycleLock(
      this.repository.config,
      projectId,
      (lock) => this.#createUnderLifecycleLock(projectId, lock),
    );
  }

  async #createUnderLifecycleLock(
    projectId: string,
    lifecycleLock: ManagedProjectLifecycleLock,
  ): Promise<ManagedProjectArchiveArtifact> {
    const record = await this.repository.open(projectId, lifecycleLock);
    const sources: ArchiveSourceFile[] = [];
    let entries = 0;
    let bytes = 0n;

    const walk = async (
      directory: string,
      relativeDirectory = "",
      expectedIdentity?: ArchiveDirectoryIdentity,
    ): Promise<void> => {
      const before = await this.#statPath(directory);
      if (!before.isDirectory() || before.isSymbolicLink()
        || (expectedIdentity && (before.dev !== expectedIdentity.device
          || before.ino !== expectedIdentity.inode))) {
        throw new Error(`Managed project archive directory changed during export: ${relativeDirectory || "."}`);
      }
      for (const name of (await readdir(directory)).sort((left, right) => left.localeCompare(right))) {
        const absolutePath = join(directory, name);
        const relativePath = relativeDirectory ? `${relativeDirectory}/${name}` : name;
        const stat = await this.#statPath(absolutePath);
        entries += 1;
        if (entries > this.repository.config.maxProjectFiles) {
          throw new Error("Managed project archive exceeds the configured file limit");
        }
        if (stat.isSymbolicLink()) {
          throw new Error(`Managed project archive cannot contain a symbolic link: ${relativePath}`);
        }
        if (stat.isDirectory()) {
          await walk(absolutePath, relativePath, { device: stat.dev, inode: stat.ino });
          continue;
        }
        if (!stat.isFile()) {
          throw new Error(`Managed project archive can contain only regular files: ${relativePath}`);
        }
        if (stat.nlink !== 1n) {
          throw new Error(`Managed project archive cannot contain a hard link: ${relativePath}`);
        }
        bytes += stat.size;
        if (bytes > BigInt(this.repository.config.maxProjectBytes)) {
          throw new Error("Managed project archive exceeds the configured byte limit");
        }
        if (isSupportedProjectArchivePath(relativePath)) {
          sources.push({
            absolutePath,
            relativePath,
            identity: { device: stat.dev, inode: stat.ino, size: stat.size },
          });
        }
      }
      const after = await this.#statPath(directory);
      if (!after.isDirectory() || after.isSymbolicLink()
        || after.dev !== before.dev || after.ino !== before.ino) {
        throw new Error(`Managed project archive directory changed during export: ${relativeDirectory || "."}`);
      }
    };

    await walk(record.projectDirectory);
    if (!sources.some((source) => source.relativePath === PROJECT_FILE)) {
      throw new Error(`Managed project archive requires a root ${PROJECT_FILE}`);
    }

    const temporaryRoot = await mkdtemp(join(tmpdir(), "screenshot-studio-project-archive-"));
    const archivePath = join(temporaryRoot, ARCHIVE_FILENAME);
    let generationError: unknown;
    try {
      const zip = new JSZip();
      for (const source of sources) {
        zip.file(source.relativePath, Readable.from(verifiedFileChunks(source)), {
          binary: true,
          date: ARCHIVE_DATE,
          createFolders: false,
        });
      }
      await pipeline(
        zip.generateNodeStream({
          type: "nodebuffer",
          streamFiles: true,
          compression: "DEFLATE",
          compressionOptions: { level: 6 },
        }),
        createWriteStream(archivePath, {
          // The mkdtemp parent is private; "wx" provides the required exclusive publication.
          flags: "wx",
          mode: 0o600,
          flush: true,
        }),
      );
    } catch (error) {
      generationError = error;
    }
    if (generationError !== undefined) {
      try {
        await this.#removeTemporaryRoot(temporaryRoot);
      } catch (cleanupError) {
        throw new AggregateError(
          [generationError, cleanupError],
          "Project archive generation and cleanup both failed",
          { cause: cleanupError },
        );
      }
      throw generationError;
    }

    let disposed = false;
    const removeTemporaryRoot = this.#removeTemporaryRoot;
    return {
      path: archivePath,
      filename: ARCHIVE_FILENAME,
      async dispose() {
        if (disposed) return;
        await removeTemporaryRoot(temporaryRoot);
        disposed = true;
      },
    };
  }
}
