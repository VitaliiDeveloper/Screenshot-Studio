// SPDX-License-Identifier: Apache-2.0
import { constants } from "node:fs";
import { mkdir, open, type FileHandle } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { isProjectRelativePath } from "@screenshot-studio/core/model";
import { readProjectSnapshot } from "@screenshot-studio/core/storage";
import {
  collectRequiredProjectResourcePaths,
  isSupportedProjectArchivePath,
} from "./project-archive-policy.js";
import {
  ManagedProjectRepository,
  type ManagedProjectRecord,
} from "./managed-project-repository.server.js";

const PROJECT_FILE = "app-store-screenshots.json";
const MAX_IMPORT_PATH_BYTES = 1_024;
const MAX_IMPORT_PATH_SEGMENTS = 64;
const MAX_IMPORT_SEGMENT_BYTES = 255;

export type ManagedProjectImportKind = "folder" | "archive" | "json";

export interface ProjectImportFile {
  relativePath: string;
  declaredSize?: number;
  open(): AsyncIterable<Uint8Array>;
}

export type ManagedProjectImportErrorCode =
  | "cancelled"
  | "invalid-path"
  | "invalid-project"
  | "missing-resources"
  | "limit"
  | "duplicate";

export class ManagedProjectImportError extends Error {
  constructor(
    message: string,
    readonly code: ManagedProjectImportErrorCode,
    readonly missingResources: readonly string[] = [],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ManagedProjectImportError";
  }
}

function cancelledError(): ManagedProjectImportError {
  return new ManagedProjectImportError("Project import was cancelled", "cancelled");
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelledError();
}

function foldPortablePath(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

function isBoundedImportPath(path: string): boolean {
  const encoder = new TextEncoder();
  const segments = path.split("/");
  return segments.length <= MAX_IMPORT_PATH_SEGMENTS
    && encoder.encode(path).byteLength <= MAX_IMPORT_PATH_BYTES
    && segments.every((segment) => encoder.encode(segment).byteLength <= MAX_IMPORT_SEGMENT_BYTES);
}

function normalizeFolderPaths(files: readonly ProjectImportFile[]): ProjectImportFile[] {
  const firstSegments = files.map((file) => file.relativePath.split("/")[0]);
  const sharedRoot = firstSegments[0];
  if (!sharedRoot || !firstSegments.every((segment) => segment === sharedRoot)) return [...files];
  const stripped = files.map((file) => ({
    ...file,
    relativePath: file.relativePath.split("/").slice(1).join("/"),
  }));
  return stripped.some((file) => file.relativePath === PROJECT_FILE) ? stripped : [...files];
}

function normalizeFiles(
  kind: ManagedProjectImportKind,
  input: readonly ProjectImportFile[],
): ProjectImportFile[] {
  if (input.length === 0) {
    throw new ManagedProjectImportError("Project import contains no files", "invalid-project");
  }
  for (const file of input) {
    if (!isProjectRelativePath(file.relativePath) || !isBoundedImportPath(file.relativePath)) {
      throw new ManagedProjectImportError(
        `Project import contains an unsafe path: ${file.relativePath}`,
        "invalid-path",
      );
    }
  }
  if (kind === "json") {
    if (input.length !== 1) {
      throw new ManagedProjectImportError("Standalone JSON import requires exactly one file", "duplicate");
    }
    return [{ ...input[0]!, relativePath: PROJECT_FILE }];
  }
  const files = kind === "folder" ? normalizeFolderPaths(input) : [...input];
  const manifestPaths = files
    .map((file) => file.relativePath)
    .filter((path) => posix.basename(path) === PROJECT_FILE);
  if (manifestPaths.length > 1) {
    throw new ManagedProjectImportError(
      `Project import requires exactly one root ${PROJECT_FILE}`,
      "duplicate",
    );
  }
  if (manifestPaths.length !== 1 || manifestPaths[0] !== PROJECT_FILE) {
    throw new ManagedProjectImportError(
      `Project import requires a root ${PROJECT_FILE}`,
      "invalid-project",
    );
  }
  return files;
}

function validateFileSet(
  files: readonly ProjectImportFile[],
  repository: ManagedProjectRepository,
): ProjectImportFile[] {
  if (files.length > repository.config.maxProjectFiles) {
    throw new ManagedProjectImportError("Project import exceeds the configured file limit", "limit");
  }
  const seen = new Set<string>();
  let declaredBytes = 0;
  for (const file of files) {
    if (!isSupportedProjectArchivePath(file.relativePath)) {
      throw new ManagedProjectImportError(
        `Project import contains an unsupported or sensitive path: ${file.relativePath}`,
        "invalid-path",
      );
    }
    const folded = foldPortablePath(file.relativePath);
    if (seen.has(folded)) {
      throw new ManagedProjectImportError(
        `Project import contains a duplicate portable path: ${file.relativePath}`,
        "duplicate",
      );
    }
    seen.add(folded);
    if (file.declaredSize !== undefined) {
      if (!Number.isSafeInteger(file.declaredSize) || file.declaredSize < 0) {
        throw new ManagedProjectImportError("Project import contains an invalid file size", "limit");
      }
      declaredBytes += file.declaredSize;
      if (declaredBytes > repository.config.maxProjectBytes
        || declaredBytes > repository.config.maxImportUploadBytes) {
        throw new ManagedProjectImportError("Project import exceeds the configured byte limit", "limit");
      }
    }
  }
  return [...files].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function writeFlags(): number {
  return constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY
    | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0);
}

async function closeAfterWrite(handle: FileHandle, error?: unknown): Promise<void> {
  try {
    await handle.close();
  } catch (closeError) {
    if (error !== undefined) {
      throw new AggregateError([error, closeError], "Project import write and close both failed", {
        cause: closeError,
      });
    }
    throw closeError;
  }
  if (error !== undefined) throw error;
}

export class ManagedProjectImportService {
  constructor(readonly repository: ManagedProjectRepository) {}

  async import(input: {
    kind: ManagedProjectImportKind;
    files: readonly ProjectImportFile[];
    signal?: AbortSignal;
  }): Promise<ManagedProjectRecord> {
    throwIfCancelled(input.signal);
    const files = validateFileSet(normalizeFiles(input.kind, input.files), this.repository);
    const stage = await this.repository.createStage();
    let published = false;
    try {
      let actualBytes = 0;
      for (const file of files) {
        throwIfCancelled(input.signal);
        const destination = join(stage.path, ...file.relativePath.split("/"));
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        const handle = await open(destination, writeFlags(), 0o600);
        let writeError: unknown;
        try {
          for await (const chunk of file.open()) {
            throwIfCancelled(input.signal);
            if (!(chunk instanceof Uint8Array)) {
              throw new TypeError("Project import streams must yield Uint8Array chunks");
            }
            actualBytes += chunk.byteLength;
            if (actualBytes > this.repository.config.maxProjectBytes) {
              throw new ManagedProjectImportError(
                "Project import exceeds the configured byte limit",
                "limit",
              );
            }
            await handle.writeFile(chunk);
          }
          await handle.sync();
        } catch (error) {
          writeError = error;
        }
        await closeAfterWrite(handle, writeError);
      }

      let snapshot: Awaited<ReturnType<typeof readProjectSnapshot>>;
      try {
        snapshot = await readProjectSnapshot(join(stage.path, PROJECT_FILE));
      } catch (error) {
        throw new ManagedProjectImportError(
          `Project document failed strict validation: ${error instanceof Error ? error.message : String(error)}`,
          "invalid-project",
          [],
          { cause: error },
        );
      }
      const included = new Set(files.map((file) => file.relativePath));
      const missing = collectRequiredProjectResourcePaths(snapshot.project)
        .filter((path) => !included.has(path));
      if (missing.length > 0) {
        throw new ManagedProjectImportError(
          "Project import is missing referenced resources; choose Folder or ZIP with the complete project",
          "missing-resources",
          missing,
        );
      }
      throwIfCancelled(input.signal);
      const record = await this.repository.publishStage({
        token: stage.token,
        name: snapshot.project.meta.name,
      });
      published = true;
      return record;
    } catch (error) {
      if (!published) {
        try {
          await this.repository.discardStage(stage.token);
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], "Project import and stage cleanup both failed", {
            cause: cleanupError,
          });
        }
      }
      throw error;
    }
  }
}
