// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, rename, rm, type FileHandle } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { lock as acquireFileLock } from "proper-lockfile";
import type { ActiveManagedProjectCatalogEntry } from "./managed-project-catalog.server.js";
import { ManagedProjectCatalogStore } from "./managed-project-catalog.server.js";
import type { ManagedProjectStorageConfig } from "./managed-project-config.server.js";
import { resolveManagedProjectStorageConfig } from "./managed-project-config.server.js";
import { ensureManagedStorageRoot } from "./managed-project-lifecycle-lock.server.js";
import { ManagedProjectRepository } from "./managed-project-repository.server.js";
import {
  LocalFileProjectSourceAdapter,
  ManagedProjectSourceAdapter,
  type OpenedProjectSource,
  type ProjectSession,
  type ProjectSessionRegistry,
} from "./project-session.server.js";

export const MAX_RECENT_PROJECTS = 20;

const RECENT_ID_PATTERN = /^recent_[0-9a-f]{32}$/;
const MANAGED_PROJECT_ID_PATTERN = /^project_[0-9a-f]{32}$/;
const MAX_NAME_LENGTH = 200;
const MAX_LOCAL_PATH_LENGTH = 4_096;

type RecentSourceKind = "managed-project" | "local-file";

interface RecentProjectEntry {
  recentId: string;
  sourceKind: RecentSourceKind;
  sourceLocator: string;
  name: string;
  lastOpenedAt: string;
  lastOpenedGeneration: number;
}

export interface RecentProjectsDocument {
  version: 1;
  generation: number;
  entries: RecentProjectEntry[];
}

export interface RecentProjectSummary {
  recentId: string;
  sourceKind: RecentSourceKind;
  name: string;
  lastOpenedAt: string;
  availability: "available" | "unavailable";
}

export interface RecentProjectList {
  entries: RecentProjectSummary[];
}

interface RecentProjectsCatalog {
  listActive(): Promise<ActiveManagedProjectCatalogEntry[]>;
}

interface RecentProjectsStoreDependencies {
  catalog?: RecentProjectsCatalog;
  createRecentId?: () => string;
  now?: () => Date;
  validateManaged?: (projectId: string) => Promise<Pick<OpenedProjectSource, "name">>;
  validateLocal?: (projectPath: string) => Promise<Pick<OpenedProjectSource, "name">>;
  openFile?: (path: string, flags: number, mode?: number) => Promise<FileHandle>;
  rename?: (from: string, to: string) => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], context: string): void {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || actual.some((key) => !expected.includes(key))) {
    throw new TypeError(`${context} contains unknown or missing properties`);
  }
}

function positiveSafeInteger(value: unknown, context: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${context} must be a positive integer`);
  }
  return value as number;
}

function nonNegativeSafeInteger(value: unknown, context: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${context} must be a non-negative integer`);
  }
  return value as number;
}

function nextGeneration(value: number): number {
  if (!Number.isSafeInteger(value) || value >= Number.MAX_SAFE_INTEGER) {
    throw new Error("Recent project history generation cannot advance safely");
  }
  return value + 1;
}

function timestamp(value: unknown, context: string): string {
  if (typeof value !== "string") throw new TypeError(`${context} must be an ISO timestamp`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new TypeError(`${context} must be an ISO timestamp`);
  }
  return value;
}

function projectName(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_NAME_LENGTH) {
    throw new TypeError("Recent project name must be a bounded non-empty string");
  }
  return value;
}

function sourceLocator(kind: RecentSourceKind, value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Recent project source locator must be a string");
  if (kind === "managed-project") {
    if (!MANAGED_PROJECT_ID_PATTERN.test(value)) {
      throw new TypeError("Managed recent source locator must be an opaque project id");
    }
    return value;
  }
  if (!isAbsolute(value) || value.length > MAX_LOCAL_PATH_LENGTH || value.includes("\0")) {
    throw new TypeError("Local recent source locator must be a bounded absolute path");
  }
  return value;
}

function parseEntry(value: unknown, generation: number): RecentProjectEntry {
  if (!isRecord(value)) throw new TypeError("Recent project entry must be an object");
  exactKeys(value, [
    "recentId", "sourceKind", "sourceLocator", "name", "lastOpenedAt", "lastOpenedGeneration",
  ], "Recent project entry");
  if (typeof value.recentId !== "string" || !RECENT_ID_PATTERN.test(value.recentId)) {
    throw new TypeError("Recent project id must be opaque");
  }
  if (value.sourceKind !== "managed-project" && value.sourceKind !== "local-file") {
    throw new TypeError("Recent project source kind is invalid");
  }
  const lastOpenedGeneration = positiveSafeInteger(
    value.lastOpenedGeneration,
    "Recent project lastOpenedGeneration",
  );
  if (lastOpenedGeneration > generation) {
    throw new TypeError("Recent project generation cannot exceed document generation");
  }
  return {
    recentId: value.recentId,
    sourceKind: value.sourceKind,
    sourceLocator: sourceLocator(value.sourceKind, value.sourceLocator),
    name: projectName(value.name),
    lastOpenedAt: timestamp(value.lastOpenedAt, "Recent project lastOpenedAt"),
    lastOpenedGeneration,
  };
}

function sourceKey(entry: Pick<RecentProjectEntry, "sourceKind" | "sourceLocator">): string {
  return `${entry.sourceKind}:${entry.sourceLocator}`;
}

function ordered(entries: readonly RecentProjectEntry[]): RecentProjectEntry[] {
  return [...entries].sort((left, right) =>
    right.lastOpenedGeneration - left.lastOpenedGeneration
      || right.lastOpenedAt.localeCompare(left.lastOpenedAt)
      || left.recentId.localeCompare(right.recentId));
}

export function parseRecentProjectsDocument(value: unknown): RecentProjectsDocument {
  if (!isRecord(value)) throw new TypeError("Recent project history must be an object");
  exactKeys(value, ["version", "generation", "entries"], "Recent project history");
  if (value.version !== 1) throw new TypeError("Recent project history version must be 1");
  const generation = nonNegativeSafeInteger(value.generation, "Recent project history generation");
  if (!Array.isArray(value.entries) || value.entries.length > MAX_RECENT_PROJECTS) {
    throw new TypeError(`Recent project history must contain at most ${MAX_RECENT_PROJECTS} entries`);
  }
  const entries = value.entries.map((entry) => parseEntry(entry, generation));
  if (new Set(entries.map(({ recentId }) => recentId)).size !== entries.length) {
    throw new TypeError("Recent project history must not duplicate ids");
  }
  if (new Set(entries.map(sourceKey)).size !== entries.length) {
    throw new TypeError("Recent project history must not duplicate sources");
  }
  if (new Set(entries.map(({ lastOpenedGeneration }) => lastOpenedGeneration)).size !== entries.length) {
    throw new TypeError("Recent project history must not duplicate opening generations");
  }
  return { version: 1, generation, entries: ordered(entries) };
}

function serialize(document: RecentProjectsDocument): string {
  const parsed = parseRecentProjectsDocument(document);
  return `${JSON.stringify({ ...parsed, entries: ordered(parsed.entries) }, null, 2)}\n`;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    && typeof error.code === "string" ? error.code : undefined;
}

function noFollow(flags: number): number {
  return flags | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0);
}

async function syncDirectoryBestEffort(directory: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(directory, constants.O_RDONLY);
    await handle.sync();
  } catch {
    // Some supported local filesystems do not permit directory fsync.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export class RecentProjectsStore {
  readonly #historyPath: string;
  readonly #catalog: RecentProjectsCatalog;
  readonly #createRecentId: () => string;
  readonly #now: () => Date;
  readonly #validateManaged: NonNullable<RecentProjectsStoreDependencies["validateManaged"]>;
  readonly #validateLocal: NonNullable<RecentProjectsStoreDependencies["validateLocal"]>;
  readonly #openFile: NonNullable<RecentProjectsStoreDependencies["openFile"]>;
  readonly #rename: NonNullable<RecentProjectsStoreDependencies["rename"]>;

  constructor(
    readonly config: ManagedProjectStorageConfig,
    dependencies: RecentProjectsStoreDependencies = {},
  ) {
    this.#historyPath = join(config.root, "recent-projects.json");
    this.#catalog = dependencies.catalog ?? new ManagedProjectCatalogStore(config);
    this.#createRecentId = dependencies.createRecentId
      ?? (() => `recent_${randomUUID().replaceAll("-", "")}`);
    this.#now = dependencies.now ?? (() => new Date());
    const managedSource = new ManagedProjectSourceAdapter(new ManagedProjectRepository(config));
    const localSource = new LocalFileProjectSourceAdapter();
    this.#validateManaged = dependencies.validateManaged ?? ((id) => managedSource.open(id));
    this.#validateLocal = dependencies.validateLocal ?? ((path) => localSource.open(path));
    this.#openFile = dependencies.openFile ?? ((path, flags, mode) => open(path, flags, mode));
    this.#rename = dependencies.rename ?? rename;
  }

  async list(): Promise<RecentProjectList> {
    const catalogEntries = await this.#catalog.listActive();
    const document = await this.#withLock(() => this.#readOrRecover(catalogEntries));
    const activeManaged = new Map(
      catalogEntries.map((entry) => [entry.id, entry]),
    );
    const summaries = await Promise.all(document.entries.map(async (entry) => {
      if (entry.sourceKind === "managed-project" && !activeManaged.has(entry.sourceLocator)) {
        return null;
      }
      try {
        const validated = entry.sourceKind === "managed-project"
          ? await this.#validateManaged(entry.sourceLocator)
          : await this.#validateLocal(entry.sourceLocator);
        return this.#summary(entry, validated.name, "available");
      } catch {
        return this.#summary(
          entry,
          entry.sourceKind === "managed-project"
            ? activeManaged.get(entry.sourceLocator)?.name ?? entry.name
            : entry.name,
          "unavailable",
        );
      }
    }));
    return { entries: summaries.filter((entry): entry is RecentProjectSummary => entry !== null) };
  }

  async record(session: ProjectSession): Promise<void> {
    const sourceKind = session.descriptor.sourceKind;
    if (sourceKind !== "managed-project" && sourceKind !== "local-file") return;
    const catalogEntries = await this.#catalog.listActive();
    await this.#withLock(async () => {
      const document = await this.#readOrRecover(catalogEntries);
      const generation = nextGeneration(document.generation);
      const locator = sourceKind === "managed-project"
        ? session.projectId
        : session.projectPath;
      sourceLocator(sourceKind, locator);
      const key = `${sourceKind}:${locator}`;
      const existing = document.entries.find((entry) => sourceKey(entry) === key);
      const entry: RecentProjectEntry = {
        recentId: existing?.recentId ?? this.#allocateRecentId(document.entries),
        sourceKind,
        sourceLocator: locator,
        name: projectName(session.descriptor.name),
        lastOpenedAt: this.#timestampNow(),
        lastOpenedGeneration: generation,
      };
      await this.#write({
        version: 1,
        generation,
        entries: ordered([
          entry,
          ...document.entries.filter((candidate) => sourceKey(candidate) !== key),
        ]).slice(0, MAX_RECENT_PROJECTS),
      });
    });
  }

  async remove(recentId: string): Promise<boolean> {
    if (!RECENT_ID_PATTERN.test(recentId)) return false;
    const catalogEntries = await this.#catalog.listActive();
    return this.#withLock(async () => {
      const document = await this.#readOrRecover(catalogEntries);
      if (!document.entries.some((entry) => entry.recentId === recentId)) return false;
      await this.#write({
        ...document,
        generation: nextGeneration(document.generation),
        entries: document.entries.filter((entry) => entry.recentId !== recentId),
      });
      return true;
    });
  }

  async activate(recentId: string, registry: ProjectSessionRegistry): Promise<ProjectSession> {
    if (!RECENT_ID_PATTERN.test(recentId)) throw new Error("Recent project does not exist");
    const catalogEntries = await this.#catalog.listActive();
    const document = await this.#withLock(() => this.#readOrRecover(catalogEntries));
    const entry = document.entries.find((candidate) => candidate.recentId === recentId);
    if (!entry) throw new Error("Recent project does not exist");
    const session = entry.sourceKind === "managed-project"
      ? await registry.openManaged(entry.sourceLocator)
      : await registry.openLocal(entry.sourceLocator);
    await this.record(session);
    return session;
  }

  #summary(
    entry: RecentProjectEntry,
    name: string,
    availability: RecentProjectSummary["availability"],
  ): RecentProjectSummary {
    return {
      recentId: entry.recentId,
      sourceKind: entry.sourceKind,
      name,
      lastOpenedAt: entry.lastOpenedAt,
      availability,
    };
  }

  #timestampNow(): string {
    const value = this.#now();
    if (Number.isNaN(value.valueOf())) throw new Error("Recent project clock returned an invalid date");
    return value.toISOString();
  }

  #allocateRecentId(entries: readonly RecentProjectEntry[]): string {
    const existing = new Set(entries.map(({ recentId }) => recentId));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const recentId = this.#createRecentId();
      if (RECENT_ID_PATTERN.test(recentId) && !existing.has(recentId)) return recentId;
    }
    throw new Error("Unable to allocate a unique recent project id");
  }

  async #readPersisted(): Promise<RecentProjectsDocument> {
    const handle = await this.#openFile(this.#historyPath, noFollow(constants.O_RDONLY));
    try {
      return parseRecentProjectsDocument(JSON.parse(await handle.readFile("utf8")) as unknown);
    } finally {
      await handle.close();
    }
  }

  async #readOrRecover(
    catalogSnapshot: readonly ActiveManagedProjectCatalogEntry[],
  ): Promise<RecentProjectsDocument> {
    try {
      return await this.#readPersisted();
    } catch (error) {
      if (errorCode(error) !== "ENOENT" && !(error instanceof SyntaxError) && !(error instanceof TypeError)) {
        throw error;
      }
      const catalogEntries = [...catalogSnapshot]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
        .slice(0, MAX_RECENT_PROJECTS);
      const entries: RecentProjectEntry[] = [];
      catalogEntries.forEach((entry, index) => {
        entries.push({
          recentId: this.#allocateRecentId(entries),
          sourceKind: "managed-project",
          sourceLocator: entry.id,
          name: entry.name,
          lastOpenedAt: entry.updatedAt,
          lastOpenedGeneration: catalogEntries.length - index,
        });
      });
      const recovered: RecentProjectsDocument = {
        version: 1,
        generation: entries.length,
        entries,
      };
      await this.#write(recovered);
      return recovered;
    }
  }

  async #withLock<T>(operation: () => Promise<T>): Promise<T> {
    await ensureManagedStorageRoot(this.config);
    const release = await acquireFileLock(this.config.root, {
      lockfilePath: join(this.config.root, ".recent-projects.lock"),
      realpath: true,
      stale: 30_000,
      update: 10_000,
      retries: { retries: 600, factor: 1, minTimeout: 50, maxTimeout: 50, randomize: false },
    });
    let result: T | undefined;
    let operationError: unknown;
    let releaseError: unknown;
    let completed = false;
    try {
      result = await operation();
      completed = true;
    } catch (error) {
      operationError = error;
    } finally {
      try { await release(); } catch (error) { releaseError = error; }
    }
    if (releaseError) {
      if (!completed) {
        throw new AggregateError(
          [operationError, releaseError],
          "Recent project history mutation and lock release both failed",
          { cause: releaseError },
        );
      }
      throw releaseError;
    }
    if (!completed) throw operationError;
    return result as T;
  }

  async #write(document: RecentProjectsDocument): Promise<void> {
    const bytes = serialize(document);
    const stagePath = join(this.config.root, `.recent-projects.${randomUUID()}.stage`);
    let handle: FileHandle | undefined;
    let ownsStage = false;
    try {
      handle = await this.#openFile(
        stagePath,
        noFollow(constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY),
        0o600,
      );
      ownsStage = true;
      await handle.writeFile(bytes, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.#rename(stagePath, this.#historyPath);
      ownsStage = false;
      await syncDirectoryBestEffort(this.config.root);
    } catch (error) {
      let primary = error;
      if (handle) {
        try { await handle.close(); } catch (closeError) {
          primary = new AggregateError([primary, closeError], "Recent history stage close failed", {
            cause: closeError,
          });
        }
      }
      if (ownsStage) {
        try { await rm(stagePath, { force: true }); } catch (cleanupError) {
          throw new AggregateError([primary, cleanupError], "Recent history stage cleanup failed", {
            cause: cleanupError,
          });
        }
      }
      throw primary;
    }
  }
}

const RECENT_PROJECTS_STORE_GLOBAL_KEY = Symbol.for("screenshot-studio.recent-projects-store");

function sharedRecentProjectsStore(): RecentProjectsStore {
  const serverGlobal = globalThis as typeof globalThis & { [key: symbol]: unknown };
  const existing = serverGlobal[RECENT_PROJECTS_STORE_GLOBAL_KEY] as RecentProjectsStore | undefined;
  if (existing) return existing;
  const store = new RecentProjectsStore(resolveManagedProjectStorageConfig());
  serverGlobal[RECENT_PROJECTS_STORE_GLOBAL_KEY] = store;
  return store;
}

export const recentProjectsStore = sharedRecentProjectsStore();
