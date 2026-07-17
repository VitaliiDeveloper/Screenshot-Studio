// SPDX-License-Identifier: Apache-2.0
import { createHash, randomUUID } from "node:crypto";
import { ProjectValidationError } from "@screenshot-studio/core/model";
import {
  ProjectPathError,
  readProjectSnapshot,
  resolveExistingProjectPath,
} from "@screenshot-studio/core/storage";
import { resolveConfiguredProjectPath } from "./project-path.js";
import type { ActiveProjectDescriptor } from "./project-session.js";

export const PROJECT_SESSION_COOKIE = "screenshot_studio_project_session";

const LOCAL_CAPABILITIES = {
  writeInPlace: true,
  revealLocation: true,
  watchExternalChanges: true,
  nativePicker: false,
  projectLocalResources: true,
} as const;

export interface LocalProjectSession {
  descriptor: ActiveProjectDescriptor;
  projectId: string;
  projectPath: string;
}

export interface OpenedLocalProjectSource {
  name: string;
  projectId: string;
  projectPath: string;
  displayLocation: string;
  capabilities: ActiveProjectDescriptor["capabilities"];
}

export interface ProjectSourceAdapter<TRequest, TOpenedSource> {
  readonly kind: string;
  open(request: TRequest): Promise<TOpenedSource>;
}

export class LocalFileProjectSourceAdapter implements ProjectSourceAdapter<
  string,
  OpenedLocalProjectSource
> {
  readonly kind = "local-file";

  async open(requestedPath: string): Promise<OpenedLocalProjectSource> {
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

export interface ProjectSessionRegistryDependencies {
  createSessionId?: () => string;
  localSource?: ProjectSourceAdapter<string, OpenedLocalProjectSource>;
}

export class ProjectSessionRegistry {
  readonly #byId = new Map<string, LocalProjectSession>();
  readonly #byPath = new Map<string, LocalProjectSession>();
  readonly #createSessionId: () => string;
  readonly #localSource: ProjectSourceAdapter<string, OpenedLocalProjectSource>;

  constructor(dependencies: ProjectSessionRegistryDependencies = {}) {
    this.#createSessionId = dependencies.createSessionId ?? randomUUID;
    this.#localSource = dependencies.localSource ?? new LocalFileProjectSourceAdapter();
  }

  async openLocal(requestedPath: string): Promise<LocalProjectSession> {
    const opened = await this.#localSource.open(requestedPath);
    const existing = this.#byPath.get(opened.projectPath);
    if (existing) {
      existing.descriptor.name = opened.name;
      return existing;
    }
    const sessionId = this.#createSessionId();
    const session: LocalProjectSession = {
      descriptor: {
        sessionId,
        name: opened.name,
        sourceKind: this.#localSource.kind,
        displayLocation: opened.displayLocation,
        capabilities: opened.capabilities,
      },
      projectId: opened.projectId,
      projectPath: opened.projectPath,
    };
    this.#byId.set(sessionId, session);
    this.#byPath.set(opened.projectPath, session);
    return session;
  }

  get(sessionId: string): LocalProjectSession | undefined {
    return this.#byId.get(sessionId);
  }
}

export class NoActiveProjectError extends Error {
  constructor() {
    super("No active project is selected");
  }
}

export const projectSessionRegistry = new ProjectSessionRegistry();

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
  operation: (session: LocalProjectSession) => Promise<Response>,
  dependencies: ActiveProjectResolverDependencies = {},
): Promise<Response> {
  let session: LocalProjectSession;
  try {
    session = await resolveActiveProjectSession(request, dependencies);
  } catch (error) {
    return projectSessionErrorResponse(error);
  }
  return operation(session);
}
