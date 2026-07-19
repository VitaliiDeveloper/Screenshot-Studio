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
  stat,
  type FileHandle,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { acquireProjectMutationLock, readProjectSnapshot } from "@screenshot-studio/core/storage";
import {
  ManagedProjectCatalogStore,
  parseManagedProjectCatalog,
  type ActiveManagedProjectCatalogEntry,
  type TrashedManagedProjectCatalogEntry,
  type ManagedProjectCatalogDocument,
  type ManagedProjectCatalogEntry,
} from "./managed-project-catalog.server.js";
import type { ManagedProjectStorageConfig } from "./managed-project-config.server.js";
import {
  acquireManagedProjectLifecycleLock,
  ensureManagedStorageRoot,
  validateManagedStorageChildRoot,
} from "./managed-project-lifecycle-lock.server.js";

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

interface DirectoryIdentity {
  device: string;
  inode: string;
}

interface ManagedProjectTrashIntent {
  version: 2;
  operation: "trash";
  operationId: string;
  id: string;
  expectedLifecycleRevision: number;
  trashedAt: string;
  priorEntry: ActiveManagedProjectCatalogEntry;
  sourceIdentity: DirectoryIdentity;
  destinationIdentity: DirectoryIdentity | null;
  phase: "prepared" | "directory-trashed" | "catalog-trashed";
}

type ManagedProjectRecoveryIntent = ManagedProjectPublicationIntent | ManagedProjectTrashIntent;
type ManagedProjectTrashFailpoint =
  | "after-directory-move"
  | "before-catalog-transition"
  | "after-catalog-transition"
  | "after-catalog-journal"
  | "after-session-invalidation"
  | "before-intent-removal"
  | "after-intent-removal";

interface CatalogStore {
  read(): Promise<ManagedProjectCatalogDocument>;
  get(id: string): Promise<ManagedProjectCatalogEntry | undefined>;
  list(): Promise<ActiveManagedProjectCatalogEntry[]>;
  listTrashed(limit: number): Promise<TrashedManagedProjectCatalogEntry[]>;
  insert(entry: ActiveManagedProjectCatalogEntry): Promise<void>;
  removeActive(id: string, expectedLifecycleRevision: number): Promise<void>;
  transitionToTrashed?(
    id: string,
    expectedLifecycleRevision: number,
    trashedAt: string,
  ): Promise<TrashedManagedProjectCatalogEntry>;
}

export interface ManagedProjectRecord {
  id: string;
  name: string;
  projectDirectory: string;
  projectPath: string;
  lifecycleRevision: number;
}

export interface ManagedProjectTrashRecord {
  id: string;
  name: string;
  lifecycleRevision: number;
  trashedAt: string;
  capabilities: {
    restoreProject: true;
    purgeProject: true;
  };
}

export class ManagedProjectNotFoundError extends Error {
  constructor() {
    super("Managed project does not exist");
    this.name = "ManagedProjectNotFoundError";
  }
}

export interface ManagedProjectRepositoryDependencies {
  catalog?: CatalogStore;
  randomId?: () => string;
  now?: () => Date;
  rename?: (oldPath: string, newPath: string) => Promise<void>;
  onTrashed?: (id: string) => Promise<void> | void;
  trashFailpoint?: (point: ManagedProjectTrashFailpoint) => Promise<void> | void;
  acquireLifecycleLock?: typeof acquireManagedProjectLifecycleLock;
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

async function directoryIdentity(path: string): Promise<DirectoryIdentity> {
  const info = await stat(path, { bigint: true });
  if (!info.isDirectory()) throw new Error("Managed project identity target must be a directory");
  return { device: info.dev.toString(), inode: info.ino.toString() };
}

function sameIdentity(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function isSameActiveEntry(
  entry: ManagedProjectCatalogEntry | undefined,
  prior: ActiveManagedProjectCatalogEntry,
): boolean {
  return entry?.lifecycle === "active"
    && entry.id === prior.id
    && entry.directoryName === prior.directoryName
    && entry.name === prior.name
    && entry.lifecycleRevision === prior.lifecycleRevision
    && entry.createdAt === prior.createdAt
    && entry.updatedAt === prior.updatedAt;
}

function nextLifecycleRevision(revision: number): number {
  if (!Number.isSafeInteger(revision) || revision <= 0 || revision >= Number.MAX_SAFE_INTEGER) {
    throw new Error("Managed project lifecycle revision cannot be incremented safely");
  }
  return revision + 1;
}

function isSameTrashedEntry(
  entry: ManagedProjectCatalogEntry | undefined,
  prior: ActiveManagedProjectCatalogEntry,
  trashedAt: string,
): boolean {
  return entry?.lifecycle === "trashed"
    && entry.id === prior.id
    && entry.directoryName === prior.directoryName
    && entry.name === prior.name
    && entry.lifecycleRevision === nextLifecycleRevision(prior.lifecycleRevision)
    && entry.createdAt === prior.createdAt
    && entry.updatedAt === trashedAt
    && entry.trashedAt === trashedAt;
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

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.valueOf()) && timestamp.toISOString() === value;
}

function parseDirectoryIdentity(value: unknown): DirectoryIdentity {
  if (!isRecord(value)) throw new TypeError("Invalid recovery directory identity");
  requireExactKeys(value, ["device", "inode"], "recovery directory identity");
  if (typeof value.device !== "string" || !/^\d+$/.test(value.device)
    || typeof value.inode !== "string" || !/^\d+$/.test(value.inode)) {
    throw new TypeError("Invalid recovery directory identity");
  }
  return { device: value.device, inode: value.inode };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireExactKeys(value: Record<string, unknown>, keys: readonly string[], context: string): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw new TypeError(`Invalid ${context} properties`);
  }
}

function parseIntent(value: unknown): ManagedProjectRecoveryIntent {
  if (!isRecord(value)) throw new TypeError("Invalid recovery intent");
  const record = value;
  if (record.version === 2 && record.operation === "trash") {
    const keys = ["version", "operation", "operationId", "id", "expectedLifecycleRevision", "trashedAt", "priorEntry", "sourceIdentity", "destinationIdentity", "phase"];
    requireExactKeys(record, keys, "recovery intent");
    if (typeof record.operationId !== "string" || !/^operation_[0-9a-f]{32}$/.test(record.operationId)
      || typeof record.id !== "string" || !PROJECT_ID_PATTERN.test(record.id)
      || !Number.isSafeInteger(record.expectedLifecycleRevision) || (record.expectedLifecycleRevision as number) <= 0
      || !isCanonicalIsoTimestamp(record.trashedAt)
      || !["prepared", "directory-trashed", "catalog-trashed"].includes(String(record.phase))) {
      throw new TypeError("Invalid recovery intent");
    }
    const priorEntry = parseManagedProjectCatalog({
      version: 2, generation: 0, entries: [record.priorEntry], lifecycleCommits: [],
    }).entries[0];
    if (!priorEntry || priorEntry.lifecycle !== "active" || priorEntry.id !== record.id
      || priorEntry.lifecycleRevision !== record.expectedLifecycleRevision) {
      throw new TypeError("Invalid recovery prior entry");
    }
    const sourceIdentity = parseDirectoryIdentity(record.sourceIdentity);
    const destinationIdentity = record.destinationIdentity === null
      ? null
      : parseDirectoryIdentity(record.destinationIdentity);
    if (destinationIdentity && !sameIdentity(sourceIdentity, destinationIdentity)) {
      throw new TypeError("Invalid recovery destination identity");
    }
    return {
      version: 2,
      operation: "trash",
      operationId: record.operationId,
      id: record.id,
      expectedLifecycleRevision: record.expectedLifecycleRevision as number,
      trashedAt: record.trashedAt,
      priorEntry,
      sourceIdentity,
      destinationIdentity,
      phase: record.phase as ManagedProjectTrashIntent["phase"],
    };
  }
  const keys = ["version", "operation", "id", "token", "name", "createdAt", "phase"];
  requireExactKeys(record, keys, "recovery intent");
  if (record.version !== 1 || record.operation !== "publish" || typeof record.id !== "string"
    || !PROJECT_ID_PATTERN.test(record.id) || typeof record.token !== "string" || !STAGE_TOKEN_PATTERN.test(record.token)
    || typeof record.name !== "string" || record.name.length === 0 || !isCanonicalIsoTimestamp(record.createdAt)
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
  readonly #onTrashed: (id: string) => Promise<void> | void;
  readonly #trashFailpoint: (point: ManagedProjectTrashFailpoint) => Promise<void> | void;
  readonly #acquireLifecycleLock: typeof acquireManagedProjectLifecycleLock;

  constructor(
    readonly config: ManagedProjectStorageConfig,
    dependencies: ManagedProjectRepositoryDependencies = {},
  ) {
    this.#catalog = dependencies.catalog ?? new ManagedProjectCatalogStore(config);
    this.#randomId = dependencies.randomId ?? (() => randomUUID().replaceAll("-", ""));
    this.#now = dependencies.now ?? (() => new Date());
    this.#rename = dependencies.rename ?? rename;
    this.#onTrashed = dependencies.onTrashed ?? (() => undefined);
    this.#trashFailpoint = dependencies.trashFailpoint ?? (() => undefined);
    this.#acquireLifecycleLock = dependencies.acquireLifecycleLock ?? acquireManagedProjectLifecycleLock;
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

  async discardStage(token: string): Promise<void> {
    if (!STAGE_TOKEN_PATTERN.test(token)) throw new TypeError("Invalid managed project stage token");
    await this.#ensureDirectories();
    await this.#assertStageNotClaimedByRecovery(token);
    let stagePath: string;
    try {
      stagePath = await this.#ownedStagePath(token);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return;
      throw error;
    }
    await rm(stagePath, { recursive: true, force: true });
    await syncDirectoryBestEffort(this.config.stagingRoot);
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
      await this.#catalog.insert({ id, directoryName: id, name, lifecycle: "active", lifecycleRevision: 1, createdAt: timestamp, updatedAt: timestamp });
      catalogPublished = true;
      intent.phase = "catalog-published";
      await this.#writeIntent(intent);
      await this.#removeIntent(id);
      return { id, name, projectDirectory, projectPath: join(projectDirectory, PROJECT_FILE), lifecycleRevision: 1 };
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      let catalogRollbackSucceeded = !catalogPublished;
      if (catalogPublished) {
        try {
          await this.#catalog.removeActive(id, 1);
          catalogRollbackSucceeded = true;
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (directoryPublished && catalogRollbackSucceeded && await exists(projectDirectory)) {
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
    if (!entry || entry.lifecycle !== "active") throw new ManagedProjectNotFoundError();
    return this.#record(entry);
  }

  async list(): Promise<ManagedProjectCatalogEntry[]> {
    await this.initialize();
    return this.#catalog.list();
  }

  async listTrash(limit: number): Promise<ManagedProjectTrashRecord[]> {
    await this.initialize();
    return (await this.#catalog.listTrashed(limit)).map((entry) => ({
      id: entry.id,
      name: entry.name,
      lifecycleRevision: entry.lifecycleRevision,
      trashedAt: entry.trashedAt,
      capabilities: { restoreProject: true, purgeProject: true },
    }));
  }

  async moveToTrash(
    id: string,
    expectedLifecycleRevision: number,
  ): Promise<TrashedManagedProjectCatalogEntry> {
    if (!PROJECT_ID_PATTERN.test(id)) throw new TypeError("Invalid managed project id");
    if (!Number.isSafeInteger(expectedLifecycleRevision) || expectedLifecycleRevision <= 0) {
      throw new TypeError("Expected lifecycle revision must be a positive integer");
    }
    nextLifecycleRevision(expectedLifecycleRevision);
    await this.#ensureDirectories();
    const lifecycleLock = await this.#acquireLifecycleLock(this.config, id);
    let operationCompleted = false;
    let result: TrashedManagedProjectCatalogEntry | undefined;
    let operationError: unknown;
    try {
      if (await exists(this.#intentPath(id))) {
        throw new Error("Managed project has unfinished recovery state");
      }
      const entry = await this.#catalog.get(id);
      if (!entry || entry.lifecycle !== "active") throw new Error("Managed project is not active");
      if (entry.lifecycleRevision !== expectedLifecycleRevision) {
        throw new Error("Managed project lifecycle revision changed");
      }
      const projectDirectory = await this.#ownedManagedDirectory(this.config.projectsRoot, id);
      await this.#ownedManagedRoot(this.config.trashRoot);
      const trashDirectory = join(this.config.trashRoot, id);
      if (await exists(trashDirectory)) throw new Error("Managed project Trash destination already exists");

      const projectLock = await acquireProjectMutationLock(join(projectDirectory, PROJECT_FILE));
      let projectLockCompleted = false;
      let projectLockError: unknown;
      let sourceIdentity: DirectoryIdentity | undefined;
      try {
        const current = await this.#catalog.get(id);
        if (!current || current.lifecycle !== "active"
          || current.lifecycleRevision !== expectedLifecycleRevision) {
          throw new Error("Managed project lifecycle revision changed while draining writes");
        }
        await this.#validateDirectory(projectDirectory);
        sourceIdentity = await directoryIdentity(projectDirectory);
        projectLockCompleted = true;
      } catch (error) {
        projectLockError = error;
      }
      try {
        await projectLock.release();
      } catch (releaseError) {
        if (!projectLockCompleted) {
          throw new AggregateError(
            [projectLockError, releaseError],
            "Managed project validation and mutation-lock release both failed",
            { cause: releaseError },
          );
        }
        throw releaseError;
      }
      if (!projectLockCompleted) throw projectLockError;

      const trashedAt = this.#now().toISOString();
      const intent: ManagedProjectTrashIntent = {
        version: 2,
        operation: "trash",
        operationId: `operation_${this.#randomId()}`,
        id,
        expectedLifecycleRevision,
        trashedAt,
        priorEntry: entry,
        sourceIdentity: sourceIdentity!,
        destinationIdentity: null,
        phase: "prepared",
      };
      await this.#writeIntent(intent);
      await this.#rename(projectDirectory, trashDirectory);
      await this.#trashFailpoint("after-directory-move");
      await syncDirectoryBestEffort(this.config.projectsRoot);
      await syncDirectoryBestEffort(this.config.trashRoot);
      const ownedTrash = await this.#ownedManagedDirectory(this.config.trashRoot, id);
      const destinationIdentity = await directoryIdentity(ownedTrash);
      if (!sameIdentity(sourceIdentity!, destinationIdentity)) {
        throw new Error("Managed project identity changed during Trash transition");
      }
      intent.destinationIdentity = destinationIdentity;
      intent.phase = "directory-trashed";
      await this.#writeIntent(intent);
      await this.#trashFailpoint("before-catalog-transition");
      if (!this.#catalog.transitionToTrashed) {
        throw new Error("Managed project catalog does not support Trash transitions");
      }
      result = await this.#catalog.transitionToTrashed(id, expectedLifecycleRevision, trashedAt);
      await this.#trashFailpoint("after-catalog-transition");
      intent.phase = "catalog-trashed";
      await this.#writeIntent(intent);
      await this.#trashFailpoint("after-catalog-journal");
      await this.#onTrashed(id);
      await this.#trashFailpoint("after-session-invalidation");
      await this.#trashFailpoint("before-intent-removal");
      await this.#removeIntent(id);
      await this.#trashFailpoint("after-intent-removal");
      operationCompleted = true;
    } catch (error) {
      operationError = error;
    }
    try {
      await lifecycleLock.release();
    } catch (releaseError) {
      if (!operationCompleted) {
        throw new AggregateError(
          [operationError, releaseError],
          "Managed project Trash transition and lifecycle-lock release both failed",
          { cause: releaseError },
        );
      }
      throw releaseError;
    }
    if (!operationCompleted) throw operationError;
    return result!;
  }

  async reconcile(): Promise<void> {
    await this.#ensureDirectories();
    for (const name of await readdir(this.config.recoveryRoot)) {
      if (!/^project_[0-9a-f]{32}\.json$/.test(name)) continue;
      const intentPath = join(this.config.recoveryRoot, name);
      const intent = parseIntent(JSON.parse(await readFile(intentPath, "utf8")));
      if (intent.operation === "trash") {
        await this.#reconcileTrash(intent);
        continue;
      }
      const stagePath = join(this.config.stagingRoot, intent.token);
      const projectDirectory = join(this.config.projectsRoot, intent.id);
      const entry = await this.#catalog.get(intent.id);
      const stageExists = await exists(stagePath);
      const projectDirectoryExists = await exists(projectDirectory);
      if (intent.phase === "prepared" && stageExists && !projectDirectoryExists) {
        await this.#removeIntent(intent.id);
        continue;
      }
      if (intent.phase === "directory-published" && !entry && !projectDirectoryExists) {
        if (stageExists) {
          const ownedStagePath = await this.#ownedStagePath(intent.token);
          await rm(ownedStagePath, { recursive: true, force: true });
          await syncDirectoryBestEffort(this.config.stagingRoot);
        }
        await this.#removeIntent(intent.id);
        continue;
      }
      if (projectDirectoryExists) {
        let snapshot: Awaited<ReturnType<typeof readProjectSnapshot>>;
        try {
          snapshot = await this.#validateDirectory(projectDirectory);
        } catch (error) {
          if (!entry) {
            await this.#rename(projectDirectory, stagePath);
            await this.#removeIntent(intent.id);
            continue;
          }
          throw error;
        }
        if (!entry) {
          const timestamp = this.#now().toISOString();
          await this.#catalog.insert({ id: intent.id, directoryName: intent.id, name: intent.name || snapshot.project.meta.name, lifecycle: "active", lifecycleRevision: 1, createdAt: intent.createdAt, updatedAt: timestamp });
        }
        await this.#removeIntent(intent.id);
      }
    }
  }

  async #ensureDirectories(): Promise<void> {
    await ensureManagedStorageRoot(this.config);
    await Promise.all([
      mkdir(this.config.projectsRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.config.stagingRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.config.recoveryRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.config.trashRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.config.tombstonesRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.config.lifecycleLocksRoot, { recursive: true, mode: 0o700 }),
    ]);
    await Promise.all([
      validateManagedStorageChildRoot(this.config, this.config.projectsRoot),
      validateManagedStorageChildRoot(this.config, this.config.stagingRoot),
      validateManagedStorageChildRoot(this.config, this.config.recoveryRoot),
      validateManagedStorageChildRoot(this.config, this.config.trashRoot),
      validateManagedStorageChildRoot(this.config, this.config.tombstonesRoot),
      validateManagedStorageChildRoot(this.config, this.config.lifecycleLocksRoot),
    ]);
  }

  async #assertStageNotClaimedByRecovery(token: string): Promise<void> {
    for (const name of await readdir(this.config.recoveryRoot)) {
      if (!/^project_[0-9a-f]{32}\.json$/.test(name)) continue;
      let intent: ManagedProjectRecoveryIntent;
      try {
        intent = parseIntent(JSON.parse(await readFile(join(this.config.recoveryRoot, name), "utf8")));
      } catch (error) {
        throw new Error("Cannot discard a managed stage while recovery state is invalid", {
          cause: error,
        });
      }
      if (intent.operation === "publish" && intent.token === token) {
        throw new Error(`Cannot discard managed stage ${token} because publication recovery owns it`);
      }
    }
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

  async #ownedManagedDirectory(root: string, id: string): Promise<string> {
    if (!PROJECT_ID_PATTERN.test(id)) throw new TypeError("Invalid managed project id");
    const canonicalRoot = await this.#ownedManagedRoot(root);
    const path = join(root, id);
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error("Managed project must be a real directory");
    }
    const canonicalPath = await realpath(path);
    if (dirname(canonicalPath) !== canonicalRoot || canonicalPath !== join(canonicalRoot, id)) {
      throw new Error("Managed project is outside its owned storage boundary");
    }
    return canonicalPath;
  }

  async #ownedManagedRoot(root: string): Promise<string> {
    return validateManagedStorageChildRoot(this.config, root);
  }

  async #reconcileTrash(intent: ManagedProjectTrashIntent): Promise<void> {
    const lifecycleLock = await this.#acquireLifecycleLock(this.config, intent.id);
    try {
      const activePath = join(this.config.projectsRoot, intent.id);
      const trashPath = join(this.config.trashRoot, intent.id);
      const [activeExists, trashExists, entry] = await Promise.all([
        exists(activePath), exists(trashPath), this.#catalog.get(intent.id),
      ]);
      if (activeExists && trashExists) throw new Error("Managed project exists in both active storage and Trash");
      const entryIsPrior = isSameActiveEntry(entry, intent.priorEntry);
      const entryIsNext = isSameTrashedEntry(entry, intent.priorEntry, intent.trashedAt);
      if (entryIsPrior && activeExists && !trashExists) {
        const active = await this.#ownedManagedDirectory(this.config.projectsRoot, intent.id);
        if (!sameIdentity(await directoryIdentity(active), intent.sourceIdentity)) {
          throw new Error("Managed project active identity does not match Trash recovery");
        }
        await this.#validateDirectory(active);
        await this.#removeIntent(intent.id);
        return;
      }
      if (entryIsPrior && trashExists && !activeExists) {
        const trash = await this.#ownedManagedDirectory(this.config.trashRoot, intent.id);
        const expectedIdentity = intent.destinationIdentity ?? intent.sourceIdentity;
        if (!sameIdentity(await directoryIdentity(trash), expectedIdentity)) {
          throw new Error("Managed project Trash identity does not match recovery");
        }
        await this.#validateDirectory(trash);
        if (!this.#catalog.transitionToTrashed) throw new Error("Catalog cannot recover Trash transition");
        await this.#catalog.transitionToTrashed(
          intent.id,
          intent.expectedLifecycleRevision,
          intent.trashedAt,
        );
        await this.#onTrashed(intent.id);
        await this.#removeIntent(intent.id);
        return;
      }
      if (entryIsNext && trashExists && !activeExists) {
        const trash = await this.#ownedManagedDirectory(this.config.trashRoot, intent.id);
        const expectedIdentity = intent.destinationIdentity ?? intent.sourceIdentity;
        if (!sameIdentity(await directoryIdentity(trash), expectedIdentity)) {
          throw new Error("Managed project Trash identity does not match committed recovery");
        }
        await this.#validateDirectory(trash);
        await this.#onTrashed(intent.id);
        await this.#removeIntent(intent.id);
        return;
      }
      throw new Error("Managed project Trash recovery state is inconsistent");
    } finally {
      await lifecycleLock.release();
    }
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

  async #validatePublishedEntry(entry: ActiveManagedProjectCatalogEntry): Promise<void> {
    if (entry.directoryName !== entry.id) throw new Error(`Managed catalog entry has an invalid directory name: ${entry.id}`);
    const projectDirectory = join(this.config.projectsRoot, entry.id);
    if (!await exists(projectDirectory)) throw new Error(`Managed catalog entry is missing its project directory: ${entry.id}`);
    await this.#validateDirectory(projectDirectory);
  }

  #record(entry: ActiveManagedProjectCatalogEntry): ManagedProjectRecord {
    const projectDirectory = join(this.config.projectsRoot, entry.id);
    return { id: entry.id, name: entry.name, projectDirectory, projectPath: join(projectDirectory, PROJECT_FILE), lifecycleRevision: entry.lifecycleRevision };
  }

  #intentPath(id: string): string { return join(this.config.recoveryRoot, `${id}.json`); }

  async #writeIntent(intent: ManagedProjectRecoveryIntent): Promise<void> {
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
