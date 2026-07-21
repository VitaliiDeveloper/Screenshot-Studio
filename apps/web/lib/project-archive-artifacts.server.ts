// SPDX-License-Identifier: Apache-2.0
import {
  createExportArtifactStore,
  type ExportArtifactLookup,
  type ExportArtifactStoreDependencies,
} from "@web/lib/export-artifacts.server.js";

const ARCHIVE_FILENAME = "screenshot-studio-project.zip" as const;

export interface ProjectArchiveArtifactTicket {
  downloadUrl: string;
  expiresAt: string;
  filename: typeof ARCHIVE_FILENAME;
}

export interface ProjectArchiveArtifactStore {
  stage(sourceZipPath: string): Promise<ProjectArchiveArtifactTicket>;
  consume(token: string): Promise<ExportArtifactLookup>;
  close(): Promise<void>;
}

export function createProjectArchiveArtifactStore(
  dependencies: ExportArtifactStoreDependencies = {},
): ProjectArchiveArtifactStore {
  const store = createExportArtifactStore({
    ...dependencies,
    downloadPathPrefix: "/api/project-archive/artifacts",
    downloadFilename: ARCHIVE_FILENAME,
  });
  return {
    async stage(sourceZipPath) {
      const ticket = await store.stage(sourceZipPath);
      return {
        downloadUrl: ticket.downloadUrl,
        expiresAt: ticket.expiresAt,
        filename: ARCHIVE_FILENAME,
      };
    },
    consume: (token) => store.consume(token),
    close: () => store.close(),
  };
}

const PROJECT_ARCHIVE_STORE_GLOBAL_KEY = Symbol.for(
  "screenshot-studio.project-archive-artifact-store",
);

function sharedStore(): ProjectArchiveArtifactStore {
  const serverGlobal = globalThis as typeof globalThis & { [key: symbol]: unknown };
  const existing = serverGlobal[PROJECT_ARCHIVE_STORE_GLOBAL_KEY] as
    | ProjectArchiveArtifactStore
    | undefined;
  if (existing) return existing;
  const store = createProjectArchiveArtifactStore();
  serverGlobal[PROJECT_ARCHIVE_STORE_GLOBAL_KEY] = store;
  return store;
}

const projectArchiveArtifactStore = sharedStore();

export const stageProjectArchiveArtifact = (sourceZipPath: string) => (
  projectArchiveArtifactStore.stage(sourceZipPath)
);

export const consumeProjectArchiveArtifact = (token: string) => (
  projectArchiveArtifactStore.consume(token)
);
