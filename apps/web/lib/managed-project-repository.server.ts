// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  type FileHandle,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { readProjectSnapshot } from "@screenshot-studio/core/storage";
import {
  ManagedProjectCatalogStore,
  type ManagedProjectCatalogDocument,
  type ManagedProjectCatalogEntry,
} from "./managed-project-catalog.server.js";
import type { ManagedProjectStorageConfig } from "./managed-project-config.server.js";

const STAGE_TOKEN_PATTERN = /^stage_[0-9a-f]{32}$/;
const PROJECT_ID_PATTERN = /^project_[0-9a-f]{32}$/;
const PROJECT_FILE = "app-store-screenshots.json";

interface ManagedProjectPublicationIntent {
  version: 1;
  operation: "publish";
  id: string;
  token: string;
  name: string;
  createdAt: string;
  phase: "prepared" | "directory-published" | "catalog-published";
}

interface CatalogStore {
  read(): Promise<ManagedProjectCatalogDocument>;
  get(id: string): Promise<ManagedProjectCatalogEntry | undefined>;
  list(): Promise<ManagedProjectCatalogEntry[]>;
  insert(entry: ManagedProjectCatalogEntry): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface ManagedProjectRecord {
  id: string;
  name: string;
  projectDirectory: string;
  projectPath: string;
}

export interface ManagedProjectRepositoryDependencies {
  catalog?: CatalogStore;
  randomId?: () => string;
  now?: () => Date;
  rename?: (oldPath: string, newPath: string) => Promise<void>;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    && typeof error.code === "string" ? error.code : undefined;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

async function syncDirectoryBestEffort(path: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY);
    await handle.sync();
  } catch {
    // Some supported local filesystems do not permit directory fsync.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function parseIntent(value: unknown): ManagedProjectPublicationIntent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Invalid recovery intent");
  const record = value as Record<string, unknown>;
  const keys = ["version", "operation", "id", "token", "name", "createdAt", "phase"];
  if (Object.keys(record).length !== keys.length || Object.keys(record).some((key) => !keys.includes(key))) {
    throw new TypeError("Invalid recovery intent properties");
  }
  if (record.version !== 1 || record.operation !== "publish" || typeof record.id !== "string"
    || !PROJECT_ID_PATTERN.test(record.id) || typeof record.token !== "string" || !STAGE_TOKEN_PATTERN.test(record.token)
    || typeof record.name !== "string" || record.name.length === 0 || typeof record.createdAt !== "string"
    || !["prepared", "directory-published", "catalog-published"].includes(String(record.phase))) {
    throw new TypeError("Invalid recovery intent");
  }
  return {
    version: 1,
    operation: "publish",
    id: record.id,
    token: record.token,
    name: record.name,
    createdAt: record.createdAt,
    phase: record.phase as ManagedProjectPublicationIntent["phase"],
  };
}

export class ManagedProjectRepository {
  readonly #catalog: CatalogStore;
  readonly #randomId: () => string;
  readonly #now: () => Date;
  readonly #rename: (oldPath: string, newPath: string) => Promise<void>;

  constructor(
    readonly config: ManagedProjectStorageConfig,
    dependencies: ManagedProjectRepositoryDependencies = {},
  ) {
    this.#catalog = dependencies.catalog ?? new ManagedProjectCatalogStore(config);
    this.#randomId = dependencies.randomId ?? (() => randomUUID().replaceAll("-", ""));
    this.#now = dependencies.now ?? (() => new Date());
    this.#rename = dependencies.rename ?? rename;
  }

  async initialize(): Promise<void> {
    await this.#ensureDirectories();
    await this.#catalog.read();
    await this.reconcile();
    for (const entry of await this.#catalog.list()) {
      await this.#validatePublishedEntry(entry);
    }
    await this.#cleanupStages();
  }

  async createStage(): Promise<{ token: string; path: string }> {
    await this.#ensureDirectories();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const token = `stage_${this.#randomId()}`;
      const path = join(this.config.stagingRoot, token);
      try {
        await mkdir(path, { recursive: false, mode: 0o700 });
        return { token, path };
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
      }
    }
    throw new Error("Unable to allocate a unique managed project stage");
  }

  async publishStage(input: { token: string; name?: string }): Promise<ManagedProjectRecord> {
    await this.#ensureDirectories();
    await this.#catalog.read();
    const stagePath = await this.#ownedStagePath(input.token);
    const snapshot = await this.#validateDirectory(stagePath);
    const name = input.name?.trim() || snapshot.project.meta.name;
    const id = `project_${this.#randomId()}`;
    const projectDirectory = join(this.config.projectsRoot, id);
    const intent: ManagedProjectPublicationIntent = {
      version: 1,
      operation: "publish",
      id,
      token: input.token,
      name,
      createdAt: this.#now().toISOString(),
      phase: "prepared",
    };
    let directoryPublished = false;
    let catalogPublished = false;
    try {
      await this.#writeIntent(intent);
      if (await exists(projectDirectory)) throw new Error(`Managed project destination already exists: ${id}`);
      await this.#rename(stagePath, projectDirectory);
      directoryPublished = true;
      await syncDirectoryBestEffort(this.config.stagingRoot);
      await syncDirectoryBestEffort(this.config.projectsRoot);
      intent.phase = "directory-published";
      await this.#writeIntent(intent);
      const timestamp = this.#now().toISOString();
      await this.#catalog.insert({ id, directoryName: id, name, lifecycle: "active", createdAt: timestamp, updatedAt: timestamp });
      catalogPublished = true;
      intent.phase = "catalog-published";
      await this.#writeIntent(intent);
      await this.#removeIntent(id);
      return { id, name, projectDirectory, projectPath: join(projectDirectory, PROJECT_FILE) };
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      if (catalogPublished) {
        try { await this.#catalog.remove(id); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
      }
      if (directoryPublished && await exists(projectDirectory)) {
        try { await this.#rename(projectDirectory, stagePath); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
      }
      if (rollbackErrors.length === 0) {
        try { await this.#removeIntent(id); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError([error, ...rollbackErrors], "Managed project publication rollback failed", { cause: error });
      }
      throw error;
    }
  }

  async open(id: string): Promise<ManagedProjectRecord> {
    await this.initialize();
    const entry = await this.#catalog.get(id);
    if (!entry) throw new Error(`Managed project does not exist: ${id}`);
    return this.#record(entry);
  }

  async list(): Promise<ManagedProjectCatalogEntry[]> {
    await this.initialize();
    return this.#catalog.list();
  }

  async reconcile(): Promise<void> {
    await this.#ensureDirectories();
    for (const name of await readdir(this.config.recoveryRoot)) {
      if (!/^project_[0-9a-f]{32}\.json$/.test(name)) continue;
      const intentPath = join(this.config.recoveryRoot, name);
      const intent = parseIntent(JSON.parse(await readFile(intentPath, "utf8")));
      const stagePath = join(this.config.stagingRoot, intent.token);
      const projectDirectory = join(this.config.projectsRoot, intent.id);
      const entry = await this.#catalog.get(intent.id);
      if (intent.phase === "prepared" && await exists(stagePath) && !await exists(projectDirectory)) {
        await this.#removeIntent(intent.id);
        continue;
      }
      if (await exists(projectDirectory)) {
        try {
          const snapshot = await this.#validateDirectory(projectDirectory);
          if (!entry) {
            const timestamp = this.#now().toISOString();
            await this.#catalog.insert({ id: intent.id, directoryName: intent.id, name: intent.name || snapshot.project.meta.name, lifecycle: "active", createdAt: intent.createdAt, updatedAt: timestamp });
          }
          await this.#removeIntent(intent.id);
        } catch (error) {
          if (!entry) {
            await this.#rename(projectDirectory, stagePath);
            await this.#removeIntent(intent.id);
            continue;
          }
          throw error;
        }
      }
    }
  }

  async #ensureDirectories(): Promise<void> {
    await Promise.all([
      mkdir(this.config.root, { recursive: true, mode: 0o700 }),
      mkdir(this.config.projectsRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.config.stagingRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.config.recoveryRoot, { recursive: true, mode: 0o700 }),
    ]);
  }

  async #ownedStagePath(token: string): Promise<string> {
    if (!STAGE_TOKEN_PATTERN.test(token)) throw new TypeError("Invalid managed project stage token");
    const path = join(this.config.stagingRoot, token);
    const [stagingRoot, stage] = await Promise.all([realpath(this.config.stagingRoot), realpath(path)]);
    const stageInfo = await lstat(path);
    if (!stageInfo.isDirectory() || stageInfo.isSymbolicLink() || dirname(stage) !== stagingRoot) {
      throw new Error("Managed project stage is not an owned staging child");
    }
    return stage;
  }

  async #validateDirectory(directory: string): Promise<Awaited<ReturnType<typeof readProjectSnapshot>>> {
    const directoryInfo = await lstat(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
      throw new Error("Managed project must be a real directory");
    }
    const projectPath = join(directory, PROJECT_FILE);
    const rootFile = await lstat(projectPath);
    if (!rootFile.isFile()) throw new Error(`Managed project stage requires a root ${PROJECT_FILE}`);
    let entries = 0;
    let bytes = 0;
    const walk = async (current: string): Promise<void> => {
      for (const name of await readdir(current)) {
        const path = join(current, name);
        const info = await lstat(path);
        entries += 1;
        if (entries > this.config.maxProjectFiles) throw new Error("Managed project exceeds the configured file limit");
        if (info.isSymbolicLink()) throw new Error("Managed project cannot contain a symbolic link");
        if (info.isDirectory()) { await walk(path); continue; }
        if (!info.isFile()) throw new Error("Managed project can contain only regular files and directories");
        if (info.nlink !== 1) throw new Error("Managed project cannot contain a hard link");
        bytes += info.size;
        if (bytes > this.config.maxProjectBytes) throw new Error("Managed project exceeds the configured byte limit");
      }
    };
    await walk(directory);
    return readProjectSnapshot(projectPath);
  }

  async #validatePublishedEntry(entry: ManagedProjectCatalogEntry): Promise<void> {
    if (entry.directoryName !== entry.id) throw new Error(`Managed catalog entry has an invalid directory name: ${entry.id}`);
    const projectDirectory = join(this.config.projectsRoot, entry.id);
    if (!await exists(projectDirectory)) throw new Error(`Managed catalog entry is missing its project directory: ${entry.id}`);
    await this.#validateDirectory(projectDirectory);
  }

  #record(entry: ManagedProjectCatalogEntry): ManagedProjectRecord {
    const projectDirectory = join(this.config.projectsRoot, entry.id);
    return { id: entry.id, name: entry.name, projectDirectory, projectPath: join(projectDirectory, PROJECT_FILE) };
  }

  #intentPath(id: string): string { return join(this.config.recoveryRoot, `${id}.json`); }

  async #writeIntent(intent: ManagedProjectPublicationIntent): Promise<void> {
    const path = this.#intentPath(intent.id);
    const stage = join(this.config.recoveryRoot, `.${intent.id}.${this.#randomId()}.stage`);
    let handle: FileHandle | undefined;
    let ownsStage = false;
    try {
      handle = await open(
        stage,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY
          | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0),
        0o600,
      );
      ownsStage = true;
      await handle.writeFile(`${JSON.stringify(intent, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.#rename(stage, path);
      ownsStage = false;
      await syncDirectoryBestEffort(this.config.recoveryRoot);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (ownsStage) await rm(stage, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async #removeIntent(id: string): Promise<void> {
    await rm(this.#intentPath(id), { force: true });
    await syncDirectoryBestEffort(this.config.recoveryRoot);
  }

  async #cleanupStages(): Promise<void> {
    const cutoff = this.#now().valueOf() - this.config.stagingTtlMs;
    for (const name of await readdir(this.config.stagingRoot)) {
      if (!STAGE_TOKEN_PATTERN.test(name)) continue;
      const path = join(this.config.stagingRoot, name);
      const info = await lstat(path);
      if (info.isDirectory() && !info.isSymbolicLink() && info.mtimeMs < cutoff) {
        await rm(path, { recursive: true, force: true });
      }
    }
  }
}
