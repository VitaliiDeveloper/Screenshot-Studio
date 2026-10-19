// SPDX-License-Identifier: Apache-2.0
import type { ActiveProjectSelection } from "@web/lib/clients/project-session.js";
import { openProjectLibraryEntry } from "@web/lib/clients/project-library-client.js";

const MANAGED_ENTRY_ID_PATTERN = /^project_[0-9a-f]{32}$/;
const RECENT_ENTRY_ID_PATTERN = /^recent_[0-9a-f]{32}$/;
const LOCAL_PROJECT_ID_PATTERN = /^[0-9a-f]{64}$/;

export function isProjectLibraryEntryId(value: string): boolean {
  return MANAGED_ENTRY_ID_PATTERN.test(value) || RECENT_ENTRY_ID_PATTERN.test(value);
}

export function editorProjectUrl(entryId: string, intent?: string): string {
  if (!isProjectLibraryEntryId(entryId)) throw new Error("Invalid project library entry id");
  const pathname = `/editor/${encodeURIComponent(entryId)}`;
  return intent ? `${pathname}?${new URLSearchParams({ intent }).toString()}` : pathname;
}

export function projectInfoUrl(projectId: string, entryId: string): string {
  const searchParams = new URLSearchParams({ project: projectId });
  if (MANAGED_ENTRY_ID_PATTERN.test(entryId) && entryId === projectId) {
    searchParams.set("entry", entryId);
  }
  return `/home?${searchParams.toString()}`;
}

export function projectInfoEntryBindingError(
  expectedProjectId: string | undefined,
  expectedEntryId: string | undefined,
): string | null {
  if (!expectedEntryId) return null;
  if (!isProjectLibraryEntryId(expectedEntryId)) {
    return "The Project Info link contains an invalid project entry id.";
  }
  if (expectedEntryId !== expectedProjectId) {
    return "The Project Info link does not match its project entry.";
  }
  return null;
}

export async function activateEditorRouteEntry(
  entryId: string,
  activate: typeof openProjectLibraryEntry = openProjectLibraryEntry,
): Promise<{ projectId: string }> {
  if (!isProjectLibraryEntryId(entryId)) {
    throw new Error("This workspace link does not contain a valid project entry id.");
  }
  const activated = await activate(entryId);
  if (MANAGED_ENTRY_ID_PATTERN.test(entryId) && activated.projectId !== entryId) {
    throw new Error("The workspace link activated a different project.");
  }
  if (RECENT_ENTRY_ID_PATTERN.test(entryId)
    && !LOCAL_PROJECT_ID_PATTERN.test(activated.projectId)) {
    throw new Error("The workspace link returned an invalid local project identity.");
  }
  return activated;
}

export function canonicalEditorUrlForSelection(
  selection: ActiveProjectSelection,
): string | null {
  return selection.sourceKind === "managed-project"
    && MANAGED_ENTRY_ID_PATTERN.test(selection.projectId)
    ? editorProjectUrl(selection.projectId)
    : null;
}
