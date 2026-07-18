// SPDX-License-Identifier: Apache-2.0
import { createHash, randomUUID } from "node:crypto";
import { ProjectValidationError } from "@screenshot-studio/core/model";
import {
  ProjectPathError,
  readProjectSnapshot,
  resolveExistingProjectPath,
} from "@screenshot-studio/core/storage";
import { ManagedProjectRepository } from "./managed-project-repository.server.js";
import { resolveManagedProjectStorageConfig } from "./managed-project-config.server.js";
import { resolveConfiguredProjectPath } from "./project-path.js";
import type { ActiveProjectDescriptor } from "./project-session.js";

export const PROJECT_SESSION_COOKIE = "screenshot_studio_project_session";

const MAX_PROJECT_SESSIONS = 30;

const LOCAL_CAPABILITIES = {
  writeInPlace: true,
  revealLocation: true,
  watchExternalChanges: true,
  nativePicker: false,
  projectLocalResources: true,
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

  async #open(source: ProjectSourceAdapter<string, OpenedProjectSource>, request: string): Promise<ProjectSession> {
    const opened = await source.open(request);
    const sourceKey = `${source.kind}:${opened.projectId}`;
    const existing = this.#bySourceKey.get(sourceKey);
    if (existing) {
      existing.descriptor.name = opened.name;
      this.#touch(existing);
      return existing;
    }
    const sessionId = this.#createSessionId();
    const session: ProjectSession = {
      descriptor: {
        sessionId,
        name: opened.name,
        sourceKind: source.kind,
        ...(opened.displayLocation === undefined ? {} : { displayLocation: opened.displayLocation }),
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

export function sessionIdFromRequest(request?: Pick<Request, "headers">): string | null {
  const cookie = request?.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name !== PROJECT_SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(value.join("="));
    } catch {
      return null;
    }
  }
  return null;
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
  if (selected) return selected;
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
