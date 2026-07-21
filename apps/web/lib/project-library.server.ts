// SPDX-License-Identifier: Apache-2.0
import type { Project } from "@screenshot-studio/core/model";
import { readProjectSnapshot } from "@screenshot-studio/core/storage";
import type { ActiveManagedProjectCatalogEntry } from "./managed-project-catalog.server.js";
import { ManagedProjectCatalogStore } from "./managed-project-catalog.server.js";
import { resolveManagedProjectStorageConfig } from "./managed-project-config.server.js";
import { ManagedProjectRepository } from "./managed-project-repository.server.js";
import {
  recentProjectsStore,
  type RecentProjectList,
} from "./recent-projects.server.js";
import {
  projectSessionRegistry,
  type OpenedProjectSource,
  type ProjectSession,
  type ProjectSessionRegistry,
} from "./project-session.server.js";

const MANAGED_ID_PATTERN = /^project_[0-9a-f]{32}$/;
const RECENT_ID_PATTERN = /^recent_[0-9a-f]{32}$/;

export interface ProjectLibraryEntry {
  entryId: string;
  sourceKind: "managed-project" | "local-file";
  name: string;
  lastOpenedAt: string;
  availability: "available" | "unavailable";
  platforms: string[];
  screenCount: number;
  layoutCount: number;
  previewLayoutId: string | null;
  previewScreenIds: string[];
  project: Project | null;
}

interface ProjectLibraryCatalog {
  listActive(): Promise<ActiveManagedProjectCatalogEntry[]>;
}

interface ProjectLibraryRepository {
  open(projectId: string): Promise<{ projectPath: string }>;
}

interface ProjectLibraryRecents {
  list(): Promise<RecentProjectList>;
  inspect(recentId: string): Promise<OpenedProjectSource>;
  activate(recentId: string, registry: ProjectSessionRegistry): Promise<ProjectSession>;
}

interface ProjectLibraryDependencies {
  catalog?: ProjectLibraryCatalog;
  repository?: ProjectLibraryRepository;
  recent?: ProjectLibraryRecents;
  readSnapshot?: typeof readProjectSnapshot;
}

function projectMetadata(project: Project) {
  const previewLayout = project.layouts.find((layout) => layout.id === project.preferredExportLayoutId)
    ?? project.layouts[0]
    ?? null;
  const platforms = [...new Set(project.layouts.flatMap((layout) =>
    layout.screens.map((screen) => `${screen.platform}:${screen.device}`)))];
  return {
    platforms,
    screenCount: project.layouts.reduce((total, layout) => total + layout.screens.length, 0),
    layoutCount: project.layouts.length,
    previewLayoutId: previewLayout?.id ?? null,
    previewScreenIds: previewLayout?.screens.slice(0, 3).map((screen) => screen.id) ?? [],
  };
}

function unavailableEntry(input: {
  entryId: string;
  name: string;
  sourceKind: "managed-project" | "local-file";
  timestamp: string;
}): ProjectLibraryEntry {
  return {
    entryId: input.entryId,
    sourceKind: input.sourceKind,
    name: input.name,
    lastOpenedAt: input.timestamp,
    availability: "unavailable",
    platforms: [],
    screenCount: 0,
    layoutCount: 0,
    previewLayoutId: null,
    previewScreenIds: [],
    project: null,
  };
}

export class ProjectLibraryService {
  readonly #catalog: ProjectLibraryCatalog;
  readonly #repository: ProjectLibraryRepository;
  readonly #recent: ProjectLibraryRecents;
  readonly #readSnapshot: typeof readProjectSnapshot;

  constructor(dependencies: ProjectLibraryDependencies = {}) {
    const config = resolveManagedProjectStorageConfig();
    this.#catalog = dependencies.catalog ?? new ManagedProjectCatalogStore(config);
    this.#repository = dependencies.repository ?? new ManagedProjectRepository(config);
    this.#recent = dependencies.recent ?? recentProjectsStore;
    this.#readSnapshot = dependencies.readSnapshot ?? readProjectSnapshot;
  }

  async list(): Promise<{ entries: ProjectLibraryEntry[] }> {
    const [managed, recent] = await Promise.all([
      this.#catalog.listActive(),
      this.#recent.list(),
    ]);
    const managedEntries = await Promise.all(managed.map(async (entry) => {
      try {
        const record = await this.#repository.open(entry.id);
        const snapshot = await this.#readSnapshot(record.projectPath);
        return {
          entryId: entry.id,
          sourceKind: "managed-project" as const,
          name: snapshot.project.meta.name,
          lastOpenedAt: entry.updatedAt,
          availability: "available" as const,
          ...projectMetadata(snapshot.project),
          project: snapshot.project,
        };
      } catch {
        return unavailableEntry({
          entryId: entry.id,
          sourceKind: "managed-project",
          name: entry.name,
          timestamp: entry.updatedAt,
        });
      }
    }));
    const localEntries = await Promise.all(recent.entries
      .filter((entry) => entry.sourceKind === "local-file")
      .map(async (entry) => {
        if (entry.availability === "unavailable") {
          return unavailableEntry({
            entryId: entry.recentId,
            sourceKind: "local-file",
            name: entry.name,
            timestamp: entry.lastOpenedAt,
          });
        }
        try {
          const source = await this.#recent.inspect(entry.recentId);
          const snapshot = await this.#readSnapshot(source.projectPath);
          return {
            entryId: entry.recentId,
            sourceKind: "local-file" as const,
            name: snapshot.project.meta.name,
            lastOpenedAt: entry.lastOpenedAt,
            availability: "available" as const,
            ...projectMetadata(snapshot.project),
            project: snapshot.project,
          };
        } catch {
          return unavailableEntry({
            entryId: entry.recentId,
            sourceKind: "local-file",
            name: entry.name,
            timestamp: entry.lastOpenedAt,
          });
        }
      }));
    return {
      entries: [...managedEntries, ...localEntries].sort((left, right) =>
        right.lastOpenedAt.localeCompare(left.lastOpenedAt) || left.entryId.localeCompare(right.entryId)),
    };
  }

  async activate(
    entryId: string,
    registry: ProjectSessionRegistry = projectSessionRegistry,
  ): Promise<ProjectSession> {
    if (MANAGED_ID_PATTERN.test(entryId)) return registry.openManaged(entryId);
    if (RECENT_ID_PATTERN.test(entryId)) return this.#recent.activate(entryId, registry);
    throw new Error("Project library entry does not exist");
  }

  async resolveProjectPath(entryId: string): Promise<string> {
    if (MANAGED_ID_PATTERN.test(entryId)) return (await this.#repository.open(entryId)).projectPath;
    if (RECENT_ID_PATTERN.test(entryId)) return (await this.#recent.inspect(entryId)).projectPath;
    throw new Error("Project library entry does not exist");
  }
}

export const projectLibraryService = new ProjectLibraryService();
