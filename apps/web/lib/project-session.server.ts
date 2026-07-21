// SPDX-License-Identifier: Apache-2.0
import { createHash, randomUUID } from "node:crypto";
import { ProjectValidationError } from "@screenshot-studio/core/model";
import {
  ProjectPathError,
  readProjectSnapshot,
  resolveExistingProjectPath,
} from "@screenshot-studio/core/storage";
import {
  ManagedProjectNotFoundError,
  ManagedProjectRepository,
  type ManagedProjectRecord,
} from "@web/lib/managed-project-repository.server.js";
import { resolveManagedProjectStorageConfig } from "@web/lib/managed-project-config.server.js";
import { resolveConfiguredProjectPath } from "@web/lib/project-path.js";
import type { ActiveProjectDescriptor } from "@web/lib/project-session.js";

export const PROJECT_SESSION_COOKIE = "screenshot_studio_project_session";
export const MANAGED_PROJECT_RECOVERY_COOKIE = "screenshot_studio_managed_project";

const MANAGED_PROJECT_ID_PATTERN = /^project_[0-9a-f]{32}$/;

const MAX_PROJECT_SESSIONS = 30;

const LOCAL_CAPABILITIES = {
  writeInPlace: true,
  revealLocation: true,
  watchExternalChanges: true,
  nativePicker: false,
  projectLocalResources: true,
  exportProjectArchive: false,
  deleteProjectPermanently: false,
} as const;

export interface ProjectSession {
  descriptor: ActiveProjectDescriptor;
  projectId: string;
  projectPath: string;
}

export interface OpenedProjectSource {
  name: string;
  projectId: string;
  projectPath: string;
  displayLocation?: string;
  lifecycleRevision?: number;
  capabilities: ActiveProjectDescriptor["capabilities"];
}

export type LocalProjectSession = ProjectSession;
export type OpenedLocalProjectSource = OpenedProjectSource;

export interface ProjectSourceAdapter<TRequest, TOpenedSource> {
  readonly kind: string;
  open(request: TRequest): Promise<TOpenedSource>;
}

export class LocalFileProjectSourceAdapter implements ProjectSourceAdapter<
  string,
  OpenedProjectSource
> {
  readonly kind = "local-file";

  async open(requestedPath: string): Promise<OpenedProjectSource> {
    const projectPath = await resolveExistingProjectPath(requestedPath);
    const snapshot = await readProjectSnapshot(projectPath);
    return {
      name: snapshot.project.meta.name,
      projectId: createHash("sha256").update(projectPath).digest("hex"),
      projectPath,
      displayLocation: projectPath,
      capabilities: LOCAL_CAPABILITIES,
    };
  }
}

const MANAGED_CAPABILITIES = {
  writeInPlace: true,
  revealLocation: false,
  watchExternalChanges: false,
  nativePicker: false,
  projectLocalResources: true,
  exportProjectArchive: true,
  deleteProjectPermanently: true,
} as const;

export class ManagedProjectSourceAdapter implements ProjectSourceAdapter<string, OpenedProjectSource> {
  readonly kind = "managed-project";

  constructor(private readonly repository = new ManagedProjectRepository(resolveManagedProjectStorageConfig())) {}

  async open(projectId: string): Promise<OpenedProjectSource> {
    const project = await this.repository.open(projectId);
    return {
      name: project.name,
      projectId: project.id,
      projectPath: project.projectPath,
      lifecycleRevision: project.lifecycleRevision,
      capabilities: MANAGED_CAPABILITIES,
    };
  }
}

export interface ProjectSessionRegistryDependencies {
  createSessionId?: () => string;
  localSource?: ProjectSourceAdapter<string, OpenedProjectSource>;
  managedSource?: ProjectSourceAdapter<string, OpenedProjectSource>;
}

export class ProjectSessionRegistry {
  readonly #byId = new Map<string, ProjectSession>();
  readonly #bySourceKey = new Map<string, ProjectSession>();
  readonly #reservedSessionIds = new Set<string>();
  readonly #createSessionId: () => string;
  readonly #localSource: ProjectSourceAdapter<string, OpenedProjectSource>;
  readonly #managedSource: ProjectSourceAdapter<string, OpenedProjectSource>;

  constructor(dependencies: ProjectSessionRegistryDependencies = {}) {
    this.#createSessionId = dependencies.createSessionId ?? randomUUID;
    this.#localSource = dependencies.localSource ?? new LocalFileProjectSourceAdapter();
    this.#managedSource = dependencies.managedSource ?? new ManagedProjectSourceAdapter();
  }

  async openLocal(requestedPath: string): Promise<ProjectSession> {
    return this.#open(this.#localSource, requestedPath);
  }

  async openManaged(projectId: string): Promise<ProjectSession> {
    return this.#open(this.#managedSource, projectId);
  }

  reserveSessionId(): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const sessionId = this.#createSessionId();
      if (this.#byId.has(sessionId) || this.#reservedSessionIds.has(sessionId)) continue;
      this.#reservedSessionIds.add(sessionId);
      return sessionId;
    }
    throw new Error("Unable to allocate a unique project session id");
  }

  releaseReservedSessionId(sessionId: string): void {
    this.#reservedSessionIds.delete(sessionId);
  }

  openManagedRecord(record: ManagedProjectRecord, reservedSessionId?: string): ProjectSession {
    return this.#register("managed-project", {
      name: record.name,
      projectId: record.id,
      projectPath: record.projectPath,
      lifecycleRevision: record.lifecycleRevision,
      capabilities: MANAGED_CAPABILITIES,
    }, reservedSessionId);
  }

  async #open(source: ProjectSourceAdapter<string, OpenedProjectSource>, request: string): Promise<ProjectSession> {
    const opened = await source.open(request);
    return this.#register(source.kind, opened);
  }

  #register(
    sourceKind: string,
    opened: OpenedProjectSource,
    reservedSessionId?: string,
  ): ProjectSession {
    const sourceKey = `${sourceKind}:${opened.projectId}`;
    const existing = this.#bySourceKey.get(sourceKey);
    if (existing) {
      if (reservedSessionId) this.releaseReservedSessionId(reservedSessionId);
      existing.descriptor.name = opened.name;
      this.#touch(existing);
      return existing;
    }
    const sessionId = reservedSessionId ?? this.reserveSessionId();
    if (!this.#reservedSessionIds.delete(sessionId)) {
      throw new Error("Project session id was not reserved by this registry");
    }
    const session: ProjectSession = {
      descriptor: {
        sessionId,
        name: opened.name,
        sourceKind,
        ...(opened.displayLocation === undefined ? {} : { displayLocation: opened.displayLocation }),
        ...(opened.lifecycleRevision === undefined ? {} : { lifecycleRevision: opened.lifecycleRevision }),
        capabilities: opened.capabilities,
      },
      projectId: opened.projectId,
      projectPath: opened.projectPath,
    };
    this.#byId.set(sessionId, session);
    this.#bySourceKey.set(sourceKey, session);
    this.#evictLeastRecentlyUsed();
    return session;
  }

  get(sessionId: string): ProjectSession | undefined {
    const session = this.#byId.get(sessionId);
    if (session) this.#touch(session);
    return session;
  }

  peek(sessionId: string): ProjectSession | undefined {
    return this.#byId.get(sessionId);
  }

  async revalidateManagedSession(session: ProjectSession, touch = true): Promise<ProjectSession> {
    if (session.descriptor.sourceKind !== "managed-project") return session;
    try {
      const opened = await this.#managedSource.open(session.projectId);
      if (opened.projectId !== session.projectId) throw new Error("Managed project identity changed");
      session.projectPath = opened.projectPath;
      session.descriptor.name = opened.name;
      session.descriptor.lifecycleRevision = opened.lifecycleRevision;
      session.descriptor.capabilities = opened.capabilities;
      if (touch) this.#touch(session);
      return session;
    } catch (error) {
      this.invalidateManagedProject(session.projectId);
      throw error;
    }
  }

  close(sessionId: string, projectId: string): boolean {
    const session = this.#byId.get(sessionId);
    if (!session || session.projectId !== projectId) return false;
    this.#byId.delete(sessionId);
    this.#bySourceKey.delete(`${session.descriptor.sourceKind}:${session.projectId}`);
    return true;
  }

  invalidateManagedProject(projectId: string): number {
    let removed = 0;
    for (const [sessionId, session] of this.#byId) {
      if (session.descriptor.sourceKind !== "managed-project" || session.projectId !== projectId) continue;
      this.#byId.delete(sessionId);
      this.#bySourceKey.delete(`managed-project:${projectId}`);
      removed += 1;
    }
    return removed;
  }

  #touch(session: ProjectSession): void {
    this.#byId.delete(session.descriptor.sessionId);
    this.#byId.set(session.descriptor.sessionId, session);
    const sourceKey = `${session.descriptor.sourceKind}:${session.projectId}`;
    this.#bySourceKey.delete(sourceKey);
    this.#bySourceKey.set(sourceKey, session);
  }

  #evictLeastRecentlyUsed(): void {
    if (this.#byId.size <= MAX_PROJECT_SESSIONS) return;
    const leastRecentlyUsed = this.#byId.values().next().value;
    if (!leastRecentlyUsed) return;
    this.#byId.delete(leastRecentlyUsed.descriptor.sessionId);
    this.#bySourceKey.delete(`${leastRecentlyUsed.descriptor.sourceKind}:${leastRecentlyUsed.projectId}`);
  }
}

export class NoActiveProjectError extends Error {
  constructor() {
    super("No active project is selected");
  }
}

function isManagedProjectNotFoundError(error: unknown): boolean {
  return error instanceof ManagedProjectNotFoundError
    || (error instanceof Error && error.name === "ManagedProjectNotFoundError");
}

class ManagedProjectRecoveryError extends Error {
  constructor(cause: unknown) {
    super("Unable to reopen the managed project", { cause });
    this.name = "ManagedProjectRecoveryError";
  }
}

const PROJECT_SESSION_REGISTRY_GLOBAL_KEY = Symbol.for(
  "screenshot-studio.project-session-registry",
);

function sharedProjectSessionRegistry(): ProjectSessionRegistry {
  const serverGlobal = globalThis as typeof globalThis & { [key: symbol]: unknown };
  const existing = serverGlobal[PROJECT_SESSION_REGISTRY_GLOBAL_KEY] as
    | ProjectSessionRegistry
    | undefined;
  if (existing) return existing;
  const registry = new ProjectSessionRegistry();
  serverGlobal[PROJECT_SESSION_REGISTRY_GLOBAL_KEY] = registry;
  return registry;
}

// Next development recompiles route modules independently; keep the opaque registry alive across
// those evaluations without turning any one project path into process-global current state.
export const projectSessionRegistry = sharedProjectSessionRegistry();

function cookieValueFromRequest(
  request: Pick<Request, "headers"> | undefined,
  cookieName: string,
): string | null {
  const cookie = request?.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name !== cookieName) continue;
    try {
      return decodeURIComponent(value.join("="));
    } catch {
      return null;
    }
  }
  return null;
}

function requestHasCookie(
  request: Pick<Request, "headers"> | undefined,
  cookieName: string,
): boolean {
  const cookie = request?.headers.get("cookie");
  if (!cookie) return false;
  return cookie.split(";").some((part) => part.trim().split("=", 1)[0] === cookieName);
}

export function sessionIdFromRequest(request?: Pick<Request, "headers">): string | null {
  return cookieValueFromRequest(request, PROJECT_SESSION_COOKIE);
}

export function managedProjectIdFromRequest(request?: Pick<Request, "headers">): string | null {
  const projectId = cookieValueFromRequest(request, MANAGED_PROJECT_RECOVERY_COOKIE);
  return projectId && MANAGED_PROJECT_ID_PATTERN.test(projectId) ? projectId : null;
}

export function hasManagedProjectRecoveryCookie(
  request?: Pick<Request, "headers">,
): boolean {
  return requestHasCookie(request, MANAGED_PROJECT_RECOVERY_COOKIE);
}

export interface ActiveProjectResolverDependencies {
  registry?: ProjectSessionRegistry;
  configuredPath?: () => string | null;
}

export async function resolveActiveProjectSession(
  request?: Pick<Request, "headers">,
  dependencies: ActiveProjectResolverDependencies = {},
): Promise<LocalProjectSession> {
  const registry = dependencies.registry ?? projectSessionRegistry;
  const sessionId = sessionIdFromRequest(request);
  const selected = sessionId ? registry.get(sessionId) : undefined;
  if (selected) {
    if (selected.descriptor.sourceKind !== "managed-project") return selected;
    try {
      return await registry.revalidateManagedSession(selected);
    } catch (error) {
      if (isManagedProjectNotFoundError(error)) throw new NoActiveProjectError();
      throw new ManagedProjectRecoveryError(error);
    }
  }
  const managedProjectId = managedProjectIdFromRequest(request);
  if (managedProjectId) {
    try {
      return await registry.openManaged(managedProjectId);
    } catch (error) {
      if (!isManagedProjectNotFoundError(error)) {
        throw new ManagedProjectRecoveryError(error);
      }
      // A missing project makes the recovery hint stale; configured local startup may proceed.
    }
  }
  const configured = (dependencies.configuredPath ?? resolveConfiguredProjectPath)();
  if (configured) return registry.openLocal(configured);
  throw new NoActiveProjectError();
}

export function projectSessionErrorResponse(error: unknown): Response {
  const status = error instanceof NoActiveProjectError ? 409
    : error instanceof ProjectValidationError ? 422
      : error instanceof ProjectPathError ? 400
        : 500;
  return Response.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status },
  );
}

export async function withActiveProjectSession(
  request: Pick<Request, "headers"> | undefined,
  operation: (session: ProjectSession) => Promise<Response>,
  dependencies: ActiveProjectResolverDependencies = {},
): Promise<Response> {
  let session: ProjectSession;
  try {
    session = await resolveActiveProjectSession(request, dependencies);
  } catch (error) {
    return projectSessionErrorResponse(error);
  }
  return operation(session);
}

export async function withExistingProjectSessionReadOnly(
  request: Pick<Request, "headers"> | undefined,
  operation: (session: ProjectSession) => Promise<Response>,
  dependencies: ActiveProjectResolverDependencies = {},
): Promise<Response> {
  const registry = dependencies.registry ?? projectSessionRegistry;
  const sessionId = sessionIdFromRequest(request);
  const session = sessionId ? registry.peek(sessionId) : undefined;
  if (!session) return projectSessionErrorResponse(new NoActiveProjectError());
  if (session.descriptor.sourceKind !== "managed-project") return operation(session);
  try {
    return operation(await registry.revalidateManagedSession(session, false));
  } catch (error) {
    return projectSessionErrorResponse(
      isManagedProjectNotFoundError(error) ? new NoActiveProjectError() : new ManagedProjectRecoveryError(error),
    );
  }
}
