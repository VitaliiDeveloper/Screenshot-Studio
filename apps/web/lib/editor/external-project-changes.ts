// SPDX-License-Identifier: Apache-2.0
import type { Project } from "@screenshot-studio/core/model";
import {
  getProjectPersistenceIdentity,
  getProjectRevision,
} from "@web/lib/clients/save-project.js";
import { hasPendingProjectSave, withDrainedProjectSaves } from "./debounced-save.js";
import { editorStore } from "./editor-store.js";

/** How often a visible Workspace asks whether another writer changed the project file. */
export const EXTERNAL_CHANGE_POLL_MS = 2000;

export type ExternalProjectChange = "unchanged" | "changed" | "conflict";

type ProjectProbeFetch = (init: RequestInit) => Promise<Response>;

const fetchProjectProbe: ProjectProbeFetch = (init) => fetch("/api/project", init);

/**
 * True only when the server read a valid project for the same identity at another revision. A
 * half-written or invalid file (422), another project, or a network failure all mean "not now".
 */
export async function projectChangedOnDisk(
  fetchProject: ProjectProbeFetch = fetchProjectProbe,
): Promise<boolean> {
  const identity = getProjectPersistenceIdentity();
  if (!identity) return false;
  const response = await fetchProject({
    cache: "no-store",
    headers: { "if-none-match": identity.revision },
  });
  await response.body?.cancel();
  return response.status === 200
    && response.headers.get("x-project-id") === identity.projectId
    && response.headers.get("etag") !== identity.revision;
}

/**
 * Probe behind every dispatched save, so the editor's own write never reads as external. A buffered
 * or running save is left to finish; if it was rejected, the change is a conflict the user resolves.
 */
export async function checkExternalProjectChange(
  probe: () => Promise<boolean> = projectChangedOnDisk,
): Promise<ExternalProjectChange> {
  if (hasPendingProjectSave()) return "unchanged";
  const changed = await withDrainedProjectSaves(() => probe().catch(() => false));
  const { saveStatus } = editorStore.getState();
  if (!changed || hasPendingProjectSave() || saveStatus === "saving") return "unchanged";
  return saveStatus === "error" ? "conflict" : "changed";
}

/** Apply a reloaded disk project only over the exact, unedited editor copy that was found stale. */
export function shouldApplyExternalReload(seen: Project | null, revision: string): boolean {
  return seen !== null
    && editorStore.getState().project === seen
    && revision !== getProjectRevision();
}
