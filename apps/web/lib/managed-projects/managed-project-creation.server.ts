// SPDX-License-Identifier: Apache-2.0
import { constants } from "node:fs";
import { mkdir, open, readFile, type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseStoreSpecs, type StoreSpecs } from "@screenshot-studio/core/export";
import {
  PROJECT_DOCUMENT_FILENAME,
  ProjectScaffoldInput,
  createProjectScaffold,
  projectScaffoldFiles,
  validateProjectScaffold,
  type ProjectScaffold,
  type ProjectScaffoldFile,
} from "@screenshot-studio/core/scaffold";
import { readProjectSnapshot } from "@screenshot-studio/core/storage";
import { resolveStoreSpecsPath } from "@web/lib/store-specs-path.js";
import {
  ManagedProjectRepository,
  type ManagedProjectRecord,
} from "./managed-project-repository.server.js";

export type ManagedProjectCreationErrorCode =
  | "cancelled"
  | "invalid-scaffold"
  | "limit"
  | "stage-write"
  | "publication";

export class ManagedProjectCreationError extends Error {
  constructor(
    message: string,
    readonly code: ManagedProjectCreationErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ManagedProjectCreationError";
  }
}

type CreateScaffold = (
  input: ProjectScaffoldInput,
  specs: StoreSpecs,
) => ProjectScaffold;

type WriteStageFile = (stagePath: string, file: ProjectScaffoldFile) => Promise<void>;

export interface ManagedProjectCreationDependencies {
  storeSpecs?: StoreSpecs;
  loadStoreSpecs?: () => Promise<StoreSpecs>;
  createScaffold?: CreateScaffold;
  writeStageFile?: WriteStageFile;
  revalidateStage?: typeof revalidateStagedScaffold;
}

function writeFlags(): number {
  return constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY
    | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0);
}

async function closeAfterWrite(handle: FileHandle, writeError?: unknown): Promise<void> {
  try {
    await handle.close();
  } catch (closeError) {
    if (writeError !== undefined) {
      throw new AggregateError([writeError, closeError], "Scaffold file write and close both failed", {
        cause: closeError,
      });
    }
    throw closeError;
  }
  if (writeError !== undefined) throw writeError;
}

async function writeStageFile(stagePath: string, file: ProjectScaffoldFile): Promise<void> {
  const destination = join(stagePath, ...file.path.split("/"));
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const handle = await open(destination, writeFlags(), 0o600);
  let writeError: unknown;
  try {
    await handle.writeFile(file.bytes);
    await handle.sync();
  } catch (error) {
    writeError = error;
  }
  await closeAfterWrite(handle, writeError);
}

async function defaultStoreSpecs(): Promise<StoreSpecs> {
  return parseStoreSpecs(JSON.parse(await readFile(resolveStoreSpecsPath(), "utf8")));
}

async function revalidateStagedScaffold(
  stagePath: string,
  files: readonly ProjectScaffoldFile[],
): Promise<void> {
  const snapshot = await readProjectSnapshot(join(stagePath, PROJECT_DOCUMENT_FILENAME));
  const resources = await Promise.all(files
    .filter((file) => file.path !== PROJECT_DOCUMENT_FILENAME)
    .map(async (file) => ({
      path: file.path,
      bytes: new Uint8Array(await readFile(join(stagePath, ...file.path.split("/")))),
    })));
  validateProjectScaffold({ project: snapshot.project, resources });
}

function creationError(error: unknown, code: ManagedProjectCreationErrorCode): ManagedProjectCreationError {
  if (error instanceof ManagedProjectCreationError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new ManagedProjectCreationError(`Managed project creation failed: ${detail}`, code, {
    cause: error,
  });
}

export class ManagedProjectCreationService {
  readonly #loadStoreSpecs: () => Promise<StoreSpecs>;
  readonly #createScaffold: CreateScaffold;
  readonly #writeStageFile: WriteStageFile;
  readonly #revalidateStage: typeof revalidateStagedScaffold;

  constructor(
    readonly repository: ManagedProjectRepository,
    dependencies: ManagedProjectCreationDependencies = {},
  ) {
    this.#loadStoreSpecs = dependencies.storeSpecs
      ? async () => dependencies.storeSpecs!
      : dependencies.loadStoreSpecs ?? defaultStoreSpecs;
    this.#createScaffold = dependencies.createScaffold ?? createProjectScaffold;
    this.#writeStageFile = dependencies.writeStageFile ?? writeStageFile;
    this.#revalidateStage = dependencies.revalidateStage ?? revalidateStagedScaffold;
  }

  async buildScaffold(input: ProjectScaffoldInput, specs?: StoreSpecs): Promise<ProjectScaffold> {
    const parsedInput = ProjectScaffoldInput.parse(input);
    try {
      return validateProjectScaffold(this.#createScaffold(
        parsedInput,
        specs ?? await this.loadStoreSpecs(),
      ));
    } catch (error) {
      throw creationError(error, "invalid-scaffold");
    }
  }

  async loadStoreSpecs(): Promise<StoreSpecs> {
    try {
      return await this.#loadStoreSpecs();
    } catch (error) {
      throw creationError(error, "invalid-scaffold");
    }
  }

  async create(input: ProjectScaffoldInput): Promise<ManagedProjectRecord> {
    return this.createFromValidatedScaffold(await this.buildScaffold(input));
  }

  async createFromValidatedScaffold(
    scaffold: ProjectScaffold,
    options: { signal?: AbortSignal } = {},
  ): Promise<ManagedProjectRecord> {
    if (options.signal?.aborted) {
      throw new ManagedProjectCreationError("Managed project creation was cancelled", "cancelled");
    }
    let validated: ProjectScaffold;
    let files: ProjectScaffoldFile[];
    try {
      validated = validateProjectScaffold(scaffold);
      files = projectScaffoldFiles(validated);
    } catch (error) {
      throw creationError(error, "invalid-scaffold");
    }
    const totalBytes = files.reduce((total, file) => total + file.bytes.byteLength, 0);
    if (files.length > this.repository.config.maxProjectFiles
      || !Number.isSafeInteger(totalBytes)
      || totalBytes > this.repository.config.maxProjectBytes) {
      throw new ManagedProjectCreationError(
        "Managed project creation exceeds configured file or byte limits",
        "limit",
      );
    }

    const stage = await this.repository.createStage();
    let attemptedPublication = false;
    try {
      for (const file of files) {
        if (options.signal?.aborted) {
          throw new ManagedProjectCreationError("Managed project creation was cancelled", "cancelled");
        }
        await this.#writeStageFile(stage.path, file);
      }
      if (options.signal?.aborted) {
        throw new ManagedProjectCreationError("Managed project creation was cancelled", "cancelled");
      }
      await this.#revalidateStage(stage.path, files);
      if (options.signal?.aborted) {
        throw new ManagedProjectCreationError("Managed project creation was cancelled", "cancelled");
      }
      attemptedPublication = true;
      return await this.repository.publishStage({ token: stage.token, name: validated.project.meta.name });
    } catch (error) {
      const wrapped = creationError(error, attemptedPublication ? "publication" : "stage-write");
      try {
        await this.repository.discardStage(stage.token);
      } catch (cleanupError) {
        throw new AggregateError(
          [wrapped, cleanupError],
          "Managed project creation and stage cleanup both failed",
          { cause: cleanupError },
        );
      }
      throw wrapped;
    }
  }
}
