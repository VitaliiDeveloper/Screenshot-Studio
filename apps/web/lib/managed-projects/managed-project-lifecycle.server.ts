// SPDX-License-Identifier: Apache-2.0
import { randomUUID, timingSafeEqual } from "node:crypto";
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
import {
  acquireProjectMutationLock,
  errorCode,
  readProjectSnapshot,
  syncDirectoryBestEffort,
} from "@screenshot-studio/core/storage";
import {
  ManagedProjectCatalogStore,
  parseActiveManagedProjectCatalogEntry,
  type ActiveManagedProjectCatalogEntry,
  type ManagedDirectoryIdentity,
  type ManagedProjectDeletionComplete,
  type ManagedProjectDeletionEvidence,
  type ManagedProjectDeletionReservation,
} from "./managed-project-catalog.server.js";
import type { ManagedProjectStorageConfig } from "./managed-project-config.server.js";
import {
  acquireManagedProjectLifecycleLock,
  assertManagedProjectLifecycleLockHeld,
  ensureManagedStorageRoot,
  withManagedProjectLifecycleLock,
  validateManagedStorageChildRoot,
  type ManagedProjectLifecycleLock,
} from "./managed-project-lifecycle-lock.server.js";
import { hasExactKeys, isRecord } from "@web/lib/json-guards.js";

interface ManagedProjectSessionInvalidator {
  invalidateManagedProject(projectId: string): number;
}

const NOOP_SESSION_INVALIDATOR: ManagedProjectSessionInvalidator = {
  invalidateManagedProject: () => 0,
};

const PROJECT_ID_PATTERN = /^project_[0-9a-f]{32}$/;
const OPERATION_ID_PATTERN = /^operation_[0-9a-f]{32}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const PROJECT_FILE = "app-store-screenshots.json";

export type ManagedProjectDeletionFailpoint =
  | "after-reservation"
  | "after-intent"
  | "after-directory-move"
  | "after-quarantined-journal"
  | "after-catalog-commit"
  | "after-catalog-journal"
  | "after-session-invalidation"
  | "after-tombstone-removal"
  | "after-tombstone-journal"
  | "after-intent-removal";

export interface PermanentlyDeleteManagedProjectInput {
  id: string;
  expectedLifecycleRevision: number;
  expectedProjectRevision: string;
  operationId: string;
  statusSecretHash: string;
}

export interface ReconcileManagedProjectDeletionInput {
  operationId: string;
  statusSecretHash: string;
}

interface ManagedProjectDeleteIntent {
  version: 1;
  operation: "delete";
  operationId: string;
  id: string;
  expectedLifecycleRevision: number;
  expectedProjectRevision: string;
  statusSecretHash: string;
  priorEntry: ActiveManagedProjectCatalogEntry;
  sourceIdentity: ManagedDirectoryIdentity;
  tombstoneName: string;
  tombstoneIdentity: ManagedDirectoryIdentity | null;
  phase: "prepared" | "quarantined" | "catalog-removed" | "tombstone-removed";
}

export interface ManagedProjectLifecycleServiceDependencies {
  now?: () => Date;
  rename?: (from: string, to: string) => Promise<void>;
  failpoint?: (point: ManagedProjectDeletionFailpoint) => Promise<void> | void;
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  if (!hasExactKeys(value, expected)) {
    throw new TypeError("Invalid managed deletion recovery intent properties");
  }
}

function canonicalTimestamp(value: Date): string {
  const timestamp = value.toISOString();
  if (Number.isNaN(value.valueOf())) throw new TypeError("Deletion clock returned an invalid date");
  return timestamp;
}

async function identity(path: string): Promise<ManagedDirectoryIdentity> {
  const info = await stat(path, { bigint: true });
  if (!info.isDirectory()) throw new Error("Managed deletion target must be a directory");
  return { device: info.dev.toString(), inode: info.ino.toString() };
}

function sameIdentity(left: ManagedDirectoryIdentity, right: ManagedDirectoryIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function sameHash(left: string, right: string): boolean {
  if (!HASH_PATTERN.test(left) || !HASH_PATTERN.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function sameEntry(left: ActiveManagedProjectCatalogEntry, right: ActiveManagedProjectCatalogEntry): boolean {
  return left.id === right.id && left.directoryName === right.directoryName && left.name === right.name
    && left.lifecycle === right.lifecycle && left.lifecycleRevision === right.lifecycleRevision
    && left.createdAt === right.createdAt && left.updatedAt === right.updatedAt;
}

function parseIdentity(value: unknown, context: string): ManagedDirectoryIdentity {
  if (!isRecord(value)) throw new TypeError(`Invalid ${context} identity`);
  exactKeys(value, ["device", "inode"]);
  if (typeof value.device !== "string" || !/^\d+$/.test(value.device)
    || typeof value.inode !== "string" || !/^\d+$/.test(value.inode)) {
    throw new TypeError(`Invalid ${context} identity`);
  }
  return { device: value.device, inode: value.inode };
}

function tombstoneName(projectId: string, operationId: string): string {
  return `${projectId}.${operationId}`;
}

function parseIntent(
  value: unknown,
  evidence: ManagedProjectDeletionEvidence,
): ManagedProjectDeleteIntent {
  if (!isRecord(value)) throw new TypeError("Invalid managed deletion recovery intent");
  exactKeys(value, [
    "version", "operation", "operationId", "id", "expectedLifecycleRevision",
    "expectedProjectRevision", "statusSecretHash", "priorEntry", "sourceIdentity",
    "tombstoneName", "tombstoneIdentity", "phase",
  ]);
  if (value.version !== 1 || value.operation !== "delete"
    || value.operationId !== evidence.operationId || value.id !== evidence.projectId
    || value.expectedLifecycleRevision !== evidence.lifecycleRevision
    || typeof value.expectedProjectRevision !== "string" || !HASH_PATTERN.test(value.expectedProjectRevision)
    || value.statusSecretHash !== evidence.statusSecretHash
    || value.tombstoneName !== tombstoneName(evidence.projectId, evidence.operationId)
    || !["prepared", "quarantined", "catalog-removed", "tombstone-removed"].includes(String(value.phase))) {
    throw new TypeError("Managed deletion recovery intent does not match catalog evidence");
  }
  const priorEntry = parseActiveManagedProjectCatalogEntry(value.priorEntry);
  const sourceIdentity = parseIdentity(value.sourceIdentity, "source");
  const tombstoneIdentity = value.tombstoneIdentity === null
    ? null
    : parseIdentity(value.tombstoneIdentity, "tombstone");
  if (evidence.state === "reserved" && (value.expectedProjectRevision !== evidence.projectRevision
    || !sameEntry(priorEntry, evidence.priorEntry)
    || !sameIdentity(sourceIdentity, evidence.sourceIdentity))) {
    throw new TypeError("Managed deletion recovery intent does not match reservation evidence");
  }
  if (evidence.state === "cleanup-pending" && (value.expectedProjectRevision !== evidence.projectRevision
    || !sameIdentity(sourceIdentity, evidence.sourceIdentity))) {
    throw new TypeError("Managed deletion recovery intent does not match pending evidence");
  }
  return {
    version: 1,
    operation: "delete",
    operationId: evidence.operationId,
    id: evidence.projectId,
    expectedLifecycleRevision: evidence.lifecycleRevision,
    expectedProjectRevision: value.expectedProjectRevision,
    statusSecretHash: evidence.statusSecretHash,
    priorEntry,
    sourceIdentity,
    tombstoneName: value.tombstoneName,
    tombstoneIdentity,
    phase: value.phase as ManagedProjectDeleteIntent["phase"],
  };
}

export class ManagedProjectLifecycleService {
  readonly #catalog: ManagedProjectCatalogStore;
  readonly #now: () => Date;
  readonly #rename: (from: string, to: string) => Promise<void>;
  readonly #failpoint: (point: ManagedProjectDeletionFailpoint) => Promise<void> | void;

  constructor(
    readonly config: ManagedProjectStorageConfig,
    readonly registry: ManagedProjectSessionInvalidator = NOOP_SESSION_INVALIDATOR,
    dependencies: ManagedProjectLifecycleServiceDependencies = {},
  ) {
    this.#catalog = new ManagedProjectCatalogStore(config);
    this.#now = dependencies.now ?? (() => new Date());
    this.#rename = dependencies.rename ?? rename;
    this.#failpoint = dependencies.failpoint ?? (() => undefined);
  }

  async permanentlyDelete(
    input: PermanentlyDeleteManagedProjectInput,
    lifecycleLock?: ManagedProjectLifecycleLock,
  ): Promise<ManagedProjectDeletionComplete> {
    this.#validateInput(input);
    await this.#ensureDirectories();
    const operation = async (lease: ManagedProjectLifecycleLock) => {
      const existing = (await this.#catalog.read()).deletions.find((evidence) =>
        evidence.operationId === input.operationId || evidence.projectId === input.id);
      if (existing) {
        if (existing.operationId !== input.operationId || existing.projectId !== input.id
          || !sameHash(existing.statusSecretHash, input.statusSecretHash)
          || existing.lifecycleRevision !== input.expectedLifecycleRevision
          || existing.projectRevision !== input.expectedProjectRevision) {
          throw new Error("Managed project has a conflicting deletion operation");
        }
        return this.#continueDeletion(existing, lease);
      }
      if (await exists(this.#intentPath(input.id))) {
        throw new Error("Managed project has unfinished recovery intent state");
      }

      const entry = await this.#catalog.getActive(input.id);
      if (!entry) throw new Error("Managed project is not active");
      if (entry.lifecycleRevision !== input.expectedLifecycleRevision) {
        throw new Error("Managed project lifecycle revision changed");
      }
      const activeDirectory = await this.#ownedDirectory(this.config.projectsRoot, input.id);
      const projectLock = await acquireProjectMutationLock(join(activeDirectory, PROJECT_FILE));
      let reservation: ManagedProjectDeletionReservation | undefined;
      let operationError: unknown;
      try {
        const current = await this.#catalog.getActive(input.id);
        if (!current || !sameEntry(current, entry)) {
          throw new Error("Managed project lifecycle revision changed while draining writes");
        }
        const snapshot = await this.#validateTree(activeDirectory);
        if (snapshot.revision !== input.expectedProjectRevision) {
          throw new Error("Managed project revision changed before deletion admission");
        }
        reservation = await this.#catalog.reserveDeletion({
          operationId: input.operationId,
          operation: "delete",
          state: "reserved",
          projectId: input.id,
          lifecycleRevision: input.expectedLifecycleRevision,
          statusSecretHash: input.statusSecretHash,
          projectRevision: input.expectedProjectRevision,
          priorEntry: entry,
          sourceIdentity: await identity(activeDirectory),
        });
        await this.#failpoint("after-reservation");
      } catch (error) { operationError = error; }
      try { await projectLock.release(); } catch (releaseError) {
        if (operationError) {
          throw new AggregateError(
            [operationError, releaseError],
            "Deletion admission and write-lock release failed",
            { cause: releaseError },
          );
        }
        throw releaseError;
      }
      if (operationError) throw operationError;
      const intent = this.#intentFromReservation(reservation!);
      await this.#writeIntent(intent);
      await this.#failpoint("after-intent");
      return this.#continueDeletion(reservation!, lease, intent);
    };
    if (lifecycleLock) {
      assertManagedProjectLifecycleLockHeld(lifecycleLock, this.config, input.id);
      return operation(lifecycleLock);
    }
    const lease = await acquireManagedProjectLifecycleLock(this.config, input.id);
    return this.#withLease(lease, () => operation(lease));
  }

  async reconcileDeletionOperation(
    input: ReconcileManagedProjectDeletionInput,
    lifecycleLock?: ManagedProjectLifecycleLock,
  ): Promise<ManagedProjectDeletionEvidence | undefined> {
    if (!OPERATION_ID_PATTERN.test(input.operationId)) {
      throw new TypeError("Invalid deletion operation id");
    }
    if (!HASH_PATTERN.test(input.statusSecretHash)) {
      throw new TypeError("Invalid status secret hash");
    }
    await this.#ensureDirectories();
    const initial = await this.#catalog.getDeletionEvidence(input.operationId);
    if (!initial || !sameHash(initial.statusSecretHash, input.statusSecretHash)) return undefined;
    const operation = async (lease: ManagedProjectLifecycleLock) => {
      const current = await this.#catalog.getDeletionEvidence(input.operationId);
      if (!current || current.projectId !== initial.projectId
        || !sameHash(current.statusSecretHash, input.statusSecretHash)) return undefined;
      if (current.state === "complete") return current;
      try {
        return await this.#continueDeletion(current, lease);
      } catch {
        const latest = await this.#catalog.getDeletionEvidence(input.operationId);
        return latest && latest.projectId === initial.projectId
          && sameHash(latest.statusSecretHash, input.statusSecretHash) ? latest : undefined;
      }
    };
    if (lifecycleLock) {
      assertManagedProjectLifecycleLockHeld(lifecycleLock, this.config, initial.projectId);
      return operation(lifecycleLock);
    }
    const lease = await acquireManagedProjectLifecycleLock(this.config, initial.projectId);
    return this.#withLease(lease, () => operation(lease));
  }

  async reconcileAll(): Promise<void> {
    await this.#ensureDirectories();
    const initialEvidence = (await this.#catalog.read()).deletions;
    const evidence = initialEvidence
      .filter((record) => record.state !== "complete");
    for (const record of evidence) {
      const lease = await acquireManagedProjectLifecycleLock(this.config, record.projectId);
      await this.#withLease(lease, () => this.#continueDeletion(record, lease));
    }
    for (const name of await readdir(this.config.recoveryRoot)) {
      if (!/^project_[0-9a-f]{32}\.json$/.test(name)) continue;
      const projectId = name.slice(0, -".json".length);
      await withManagedProjectLifecycleLock(this.config, projectId, async () => {
        let value: unknown;
        try {
          value = JSON.parse(await readFile(join(this.config.recoveryRoot, name), "utf8")) as unknown;
        } catch (error) {
          if (errorCode(error) === "ENOENT") return;
          throw error;
        }
        if (!isRecord(value) || value.operation !== "delete") return;
        if (value.id !== projectId) {
          throw new Error("Managed deletion intent identity does not match its recovery filename");
        }
        const record = (await this.#catalog.read()).deletions.find(
          (candidate) => candidate.projectId === value.id,
        );
        if (!record || record.state === "complete") {
          throw new Error("Orphan managed deletion intent has no recoverable catalog evidence");
        }
      });
    }
  }

  async #continueDeletion(
    initialEvidence: ManagedProjectDeletionEvidence,
    lease: ManagedProjectLifecycleLock,
    suppliedIntent?: ManagedProjectDeleteIntent,
  ): Promise<ManagedProjectDeletionComplete> {
    if (initialEvidence.state === "complete") return initialEvidence;
    let evidence = initialEvidence;
    let intent = suppliedIntent ?? await this.#readIntent(evidence);
    const activePath = join(this.config.projectsRoot, evidence.projectId);
    const quarantinePath = join(this.config.tombstonesRoot, tombstoneName(evidence.projectId, evidence.operationId));
    let activeExists = await exists(activePath);
    let quarantineExists = await exists(quarantinePath);

    if (evidence.state === "reserved") {
      if (!intent) {
        this.#assertRecoveryState(evidence, intent, activeExists, quarantineExists);
        const active = await this.#ownedDirectory(this.config.projectsRoot, evidence.projectId);
        if (!sameIdentity(await identity(active), evidence.sourceIdentity)) {
          throw new Error("Deletion reservation source identity changed");
        }
        const snapshot = await this.#validateTree(active);
        if (snapshot.revision !== evidence.projectRevision) {
          throw new Error("Deletion reservation Project revision changed");
        }
        intent = this.#intentFromReservation(evidence);
        await this.#writeIntent(intent);
      }
      this.#assertRecoveryState(evidence, intent, activeExists, quarantineExists);
      if (activeExists) {
        const active = await this.#ownedDirectory(this.config.projectsRoot, evidence.projectId);
        if (!sameIdentity(await identity(active), evidence.sourceIdentity)
          || (await this.#validateTree(active)).revision !== evidence.projectRevision) {
          throw new Error("Managed deletion source changed before quarantine");
        }
        if (await exists(quarantinePath)) throw new Error("Managed deletion tombstone destination exists");
        await this.#rename(active, quarantinePath);
        await this.#failpoint("after-directory-move");
        await syncDirectoryBestEffort(this.config.projectsRoot);
        await syncDirectoryBestEffort(this.config.tombstonesRoot);
      }
      const quarantine = await this.#ownedTombstone(evidence.projectId, evidence.operationId);
      const quarantineIdentity = await identity(quarantine);
      if (!sameIdentity(quarantineIdentity, evidence.sourceIdentity)) {
        throw new Error("Managed deletion tombstone identity changed");
      }
      await this.#validateTree(quarantine);
      intent.tombstoneIdentity = quarantineIdentity;
      intent.phase = "quarantined";
      await this.#writeIntent(intent);
      await this.#failpoint("after-quarantined-journal");
      const committed = await this.#catalog.commitDeletion(evidence.operationId);
      if (committed.state !== "cleanup-pending") {
        throw new Error("Managed deletion catalog commit returned an invalid state");
      }
      evidence = committed;
      await this.#failpoint("after-catalog-commit");
      intent.phase = "catalog-removed";
      await this.#writeIntent(intent);
      await this.#failpoint("after-catalog-journal");
    }

    if (evidence.state !== "cleanup-pending") {
      throw new Error("Managed deletion did not reach cleanup-pending state");
    }
    intent ??= await this.#readIntent(evidence);
    activeExists = await exists(activePath);
    quarantineExists = await exists(quarantinePath);
    this.#assertRecoveryState(evidence, intent, activeExists, quarantineExists);
    if (!intent) {
      return this.#catalog.completeDeletionAfterIntentRemoval(
        evidence.operationId,
        canonicalTimestamp(this.#now()),
        lease,
      );
    }
    if (intent.phase === "quarantined") {
      intent.phase = "catalog-removed";
      await this.#writeIntent(intent);
      await this.#failpoint("after-catalog-journal");
    }
    this.registry.invalidateManagedProject(evidence.projectId);
    await this.#failpoint("after-session-invalidation");
    if (quarantineExists) {
      const quarantine = await this.#ownedTombstone(evidence.projectId, evidence.operationId);
      const expectedIdentity = intent.tombstoneIdentity ?? intent.sourceIdentity;
      if (!sameIdentity(await identity(quarantine), expectedIdentity)) {
        throw new Error("Managed deletion tombstone no longer matches recovery intent");
      }
      await this.#validateTree(quarantine);
      await rm(quarantine, { recursive: true, force: false });
      await syncDirectoryBestEffort(this.config.tombstonesRoot);
      await this.#failpoint("after-tombstone-removal");
    }
    intent.phase = "tombstone-removed";
    await this.#writeIntent(intent);
    await this.#failpoint("after-tombstone-journal");
    await rm(this.#intentPath(evidence.projectId), { force: true });
    await syncDirectoryBestEffort(this.config.recoveryRoot);
    await this.#failpoint("after-intent-removal");
    return this.#catalog.completeDeletionAfterIntentRemoval(
      evidence.operationId,
      canonicalTimestamp(this.#now()),
      lease,
    );
  }

  #intentFromReservation(reservation: ManagedProjectDeletionReservation): ManagedProjectDeleteIntent {
    return {
      version: 1,
      operation: "delete",
      operationId: reservation.operationId,
      id: reservation.projectId,
      expectedLifecycleRevision: reservation.lifecycleRevision,
      expectedProjectRevision: reservation.projectRevision,
      statusSecretHash: reservation.statusSecretHash,
      priorEntry: reservation.priorEntry,
      sourceIdentity: reservation.sourceIdentity,
      tombstoneName: tombstoneName(reservation.projectId, reservation.operationId),
      tombstoneIdentity: null,
      phase: "prepared",
    };
  }

  #assertRecoveryState(
    evidence: ManagedProjectDeletionEvidence,
    intent: ManagedProjectDeleteIntent | undefined,
    activeExists: boolean,
    quarantineExists: boolean,
  ): void {
    if (activeExists && quarantineExists) {
      throw new Error("Managed deletion recovery directory state is inconsistent");
    }
    if (evidence.state === "complete") {
      if (intent || activeExists || quarantineExists) {
        throw new Error("Completed deletion retains recovery state");
      }
      return;
    }
    if (evidence.state === "reserved") {
      if (!intent) {
        if (activeExists && !quarantineExists) return;
      } else if (intent.phase === "prepared") {
        if (activeExists !== quarantineExists) return;
      } else if (intent.phase === "quarantined") {
        if (!activeExists && quarantineExists) return;
      }
      throw new Error("Deletion reservation phase and directory state are inconsistent");
    }
    if (activeExists) {
      throw new Error("Deletion cleanup phase cannot retain an active directory");
    }
    if (!intent) {
      if (!quarantineExists) return;
    } else if (intent.phase === "quarantined") {
      if (quarantineExists) return;
    } else if (intent.phase === "catalog-removed") {
      return;
    } else if (intent.phase === "tombstone-removed") {
      if (!quarantineExists) return;
    }
    throw new Error("Deletion cleanup phase and directory state are inconsistent");
  }

  async #readIntent(evidence: ManagedProjectDeletionEvidence): Promise<ManagedProjectDeleteIntent | undefined> {
    try {
      return parseIntent(
        JSON.parse(await readFile(this.#intentPath(evidence.projectId), "utf8")) as unknown,
        evidence,
      );
    } catch (error) {
      if (errorCode(error) === "ENOENT") return undefined;
      throw error;
    }
  }

  async #writeIntent(intent: ManagedProjectDeleteIntent): Promise<void> {
    const path = this.#intentPath(intent.id);
    const stage = join(this.config.recoveryRoot, `.${intent.id}.${randomUUID()}.stage`);
    let handle: FileHandle | undefined;
    try {
      handle = await open(stage, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY
        | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0), 0o600);
      await handle.writeFile(`${JSON.stringify(intent, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.#rename(stage, path);
      await syncDirectoryBestEffort(this.config.recoveryRoot);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await rm(stage, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async #validateTree(directory: string): Promise<Awaited<ReturnType<typeof readProjectSnapshot>>> {
    const directoryInfo = await lstat(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
      throw new Error("Managed project must be a real directory");
    }
    let files = 0;
    let bytes = 0;
    const walk = async (current: string): Promise<void> => {
      for (const name of await readdir(current)) {
        const path = join(current, name);
        const info = await lstat(path);
        files += 1;
        if (files > this.config.maxProjectFiles) throw new Error("Managed project exceeds file limit");
        if (info.isSymbolicLink()) throw new Error("Managed project cannot contain a symbolic link");
        if (info.isDirectory()) { await walk(path); continue; }
        if (!info.isFile() || info.nlink !== 1) throw new Error("Managed project contains an unsafe file");
        bytes += info.size;
        if (bytes > this.config.maxProjectBytes) throw new Error("Managed project exceeds byte limit");
      }
    };
    await walk(directory);
    return readProjectSnapshot(join(directory, PROJECT_FILE));
  }

  async #ownedDirectory(root: string, id: string): Promise<string> {
    if (!PROJECT_ID_PATTERN.test(id)) throw new TypeError("Invalid managed project id");
    const canonicalRoot = await validateManagedStorageChildRoot(this.config, root);
    const path = join(root, id);
    const info = await lstat(path);
    const canonical = await realpath(path);
    if (!info.isDirectory() || info.isSymbolicLink() || dirname(canonical) !== canonicalRoot
      || canonical !== join(canonicalRoot, id)) {
      throw new Error("Managed project is outside its storage boundary");
    }
    return canonical;
  }

  async #ownedTombstone(projectId: string, operationId: string): Promise<string> {
    const name = tombstoneName(projectId, operationId);
    const canonicalRoot = await validateManagedStorageChildRoot(this.config, this.config.tombstonesRoot);
    const path = join(this.config.tombstonesRoot, name);
    const info = await lstat(path);
    const canonical = await realpath(path);
    if (!info.isDirectory() || info.isSymbolicLink() || dirname(canonical) !== canonicalRoot
      || canonical !== join(canonicalRoot, name)) {
      throw new Error("Managed deletion tombstone is outside its storage boundary");
    }
    return canonical;
  }

  async #ensureDirectories(): Promise<void> {
    await ensureManagedStorageRoot(this.config);
    await Promise.all([
      mkdir(this.config.projectsRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.config.recoveryRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.config.tombstonesRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.config.lifecycleLocksRoot, { recursive: true, mode: 0o700 }),
    ]);
    await Promise.all([
      validateManagedStorageChildRoot(this.config, this.config.projectsRoot),
      validateManagedStorageChildRoot(this.config, this.config.recoveryRoot),
      validateManagedStorageChildRoot(this.config, this.config.tombstonesRoot),
      validateManagedStorageChildRoot(this.config, this.config.lifecycleLocksRoot),
    ]);
  }

  #validateInput(input: PermanentlyDeleteManagedProjectInput): void {
    if (!PROJECT_ID_PATTERN.test(input.id)) throw new TypeError("Invalid managed project id");
    if (!OPERATION_ID_PATTERN.test(input.operationId)) throw new TypeError("Invalid deletion operation id");
    if (!HASH_PATTERN.test(input.expectedProjectRevision)) throw new TypeError("Invalid Project revision");
    if (!HASH_PATTERN.test(input.statusSecretHash)) throw new TypeError("Invalid status secret hash");
    if (!Number.isSafeInteger(input.expectedLifecycleRevision) || input.expectedLifecycleRevision <= 0) {
      throw new TypeError("Invalid lifecycle revision");
    }
  }

  #intentPath(projectId: string): string { return join(this.config.recoveryRoot, `${projectId}.json`); }

  async #withLease<T>(lease: ManagedProjectLifecycleLock, operation: () => Promise<T>): Promise<T> {
    let result: T | undefined;
    let operationError: unknown;
    try { result = await operation(); } catch (error) { operationError = error; }
    try { await lease.release(); } catch (releaseError) {
      if (operationError) {
        throw new AggregateError(
          [operationError, releaseError],
          "Deletion and lock release failed",
          { cause: releaseError },
        );
      }
      throw releaseError;
    }
    if (operationError) throw operationError;
    return result as T;
  }
}
