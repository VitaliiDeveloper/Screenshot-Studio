// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import {
  getScreen,
  type Project,
} from "@screenshot-studio/core/model";
import {
  parseStoreSpecs,
  findStoreTarget,
  type StoreSize,
  type BundleEntry,
  type ExportProfile,
} from "@screenshot-studio/core/export";
import {
  readIdentifiedProjectSnapshot,
  resolveExistingProjectPath,
  withProjectMutation,
  type ProjectFileIdentity,
  type ProjectLockOptions,
} from "@screenshot-studio/core/storage";
import { renderScreenToPng, type RenderBrowserSession } from "./render-driver.js";
import { renderStoreReadyPng } from "./store-ready-png.js";
import { writeBundleOutputs, type RenderedBundleEntry } from "./bundle-publisher.js";
import { buildWebSharePackage } from "./web-share.js";
import { loadProjectSnapshot } from "./project-io.js";

export { writeBundleOutputs, type RenderedBundleEntry };

export interface StableProjectExportContext {
  projectPath: string;
  project: Project;
  revision: string;
  publish<T>(operation: () => Promise<T>): Promise<T>;
}

function sameProjectIdentity(left: ProjectFileIdentity, right: ProjectFileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

/**
 * Holds the canonical project mutation lease for one export and exposes a guarded publication
 * boundary. The render host remains lock-free and is pinned separately by `revision`; immediately
 * before output publication, `publish()` reopens the project and verifies exact bytes and identity.
 */
export async function withStableProjectExport<T>(
  projectPath: string,
  operation: (context: StableProjectExportContext) => Promise<T>,
  lockOptions: ProjectLockOptions = {},
): Promise<T> {
  const canonicalProjectPath = await resolveExistingProjectPath(projectPath);
  return withProjectMutation(canonicalProjectPath, async () => {
    const initial = await readIdentifiedProjectSnapshot(canonicalProjectPath);
    let active = true;
    const publications: Promise<unknown>[] = [];
    const publish = async <Result>(publication: () => Promise<Result>): Promise<Result> => {
      if (!active) throw new Error("Project export lease is no longer active");
      const task = (async () => {
        const current = await readIdentifiedProjectSnapshot(canonicalProjectPath);
        if (!active) throw new Error("Project export lease is no longer active");
        if (current.revision !== initial.revision) {
          throw new Error(
            `Project revision changed before export publication: expected ${initial.revision}, found ${current.revision}`,
          );
        }
        if (!sameProjectIdentity(current.identity, initial.identity)) {
          throw new Error("Project file identity changed before export publication");
        }
        return publication();
      })();
      publications.push(task);
      return task;
    };

    let result: T | undefined;
    let primaryError: unknown;
    let hasPrimaryError = false;
    try {
      result = await operation({
        projectPath: canonicalProjectPath,
        project: initial.project,
        revision: initial.revision,
        publish,
      });
    } catch (error) {
      primaryError = error;
      hasPrimaryError = true;
    }

    // A Promise.race at the caller may stop awaiting a render/export promise after the server
    // exits. Invalidate guards first, then keep the lease until every publication that already
    // crossed this boundary settles. A losing promise can therefore neither publish late nor keep
    // mutating outputs after the lease is released.
    active = false;
    const publicationResults = await Promise.allSettled(publications);
    const publicationErrors = publicationResults.flatMap((publicationResult) => (
      publicationResult.status === "rejected"
        && (!hasPrimaryError || publicationResult.reason !== primaryError)
        ? [publicationResult.reason]
        : []
    ));
    if (hasPrimaryError) {
      if (publicationErrors.length > 0) {
        throw new AggregateError(
          [primaryError, ...publicationErrors],
          `${primaryError instanceof Error ? primaryError.message : String(primaryError)}; export publication failed while closing its lease`,
          { cause: primaryError },
        );
      }
      throw primaryError;
    }
    if (publicationErrors.length === 1) throw publicationErrors[0];
    if (publicationErrors.length > 1) {
      throw new AggregateError(publicationErrors, "Multiple export publications failed");
    }
    return result!;
  }, lockOptions);
}

/**
 * Export orchestration (Node side). Renders a screen through the served web renderer, then does
 * the store post-processing that must happen off-canvas: strip alpha (stores reject
 * transparency) and assert exact target dimensions (docs/architecture.md). One export path,
 * shared by the CLI command and the parity harness — the same result the UI button must match.
 */
export interface ExportScreenOptions {
  baseUrl: string;
  projectPath: string;
  projectRevision: string;
  layoutId: string;
  screenId: string;
  target: StoreSize;
  headless?: boolean;
}

/** Render + flatten + verify one screen, returning a store-ready PNG buffer. */
export async function exportScreenToPng(opts: ExportScreenOptions): Promise<Buffer> {
  const { baseUrl, projectPath, projectRevision, layoutId, screenId, target, headless } = opts;
  const snapshot = await loadProjectSnapshot(projectPath);
  if (snapshot.revision !== projectRevision) {
    throw new Error(
      `Project revision changed before export: expected ${projectRevision}, found ${snapshot.revision}`,
    );
  }
  const screen = getScreen(snapshot.project, layoutId, screenId);

  return renderStoreReadyPng({
    screen,
    target,
    render: (pixelRatio) => renderScreenToPng({
      baseUrl,
      projectPath,
      projectRevision,
      layoutId,
      screenId,
      pixelRatio,
      headless,
    }),
  });
}

/** Resolve a target store size for a screen from store-specs.json. */
export async function resolveTarget(
  storeSpecsPath: string,
  platform: string,
  device: string,
  sizeId: string,
): Promise<StoreSize> {
  const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
  return findStoreTarget(specs, platform, device, sizeId);
}

export async function exportBundle({
  baseUrl,
  projectPath,
  projectRevision,
  layoutId,
  outDir,
  entries,
  renderSession,
  publicationGuard,
  profile = "store-bundle",
  project,
}: {
  baseUrl: string;
  projectPath: string;
  projectRevision: string;
  layoutId: string;
  outDir: string;
  entries: BundleEntry[];
  renderSession: Pick<RenderBrowserSession, "renderScreenToPng">;
  publicationGuard: <T>(publish: () => Promise<T>) => Promise<T>;
  profile?: ExportProfile;
  project?: Project;
}): Promise<string> {
  const rendered: RenderedBundleEntry[] = [];

  for (const entry of entries) {
    try {
      const png = await renderStoreReadyPng({
        screen: entry.screen,
        target: entry.target,
        render: (pixelRatio) => renderSession.renderScreenToPng({
          baseUrl,
          projectPath,
          projectRevision,
          layoutId,
          screenId: entry.screen.id,
          pixelRatio,
        }),
      });
      rendered.push({ entry, png });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to export screen "${entry.screen.id}" target "${entry.target.id}": ${message}`, {
        cause: err,
      });
    }
  }

  if (profile === "web-share") {
    if (!project) throw new Error("Web Share export requires the validated project snapshot");
    const webShare = buildWebSharePackage(project, rendered);
    return publicationGuard(() => writeBundleOutputs({
      outDir,
      entries: webShare.screenshots,
      extraFiles: webShare.extraFiles,
      zipFilename: "web-share-package.zip",
    }));
  }
  return publicationGuard(() => writeBundleOutputs({ outDir, entries: rendered }));
}
