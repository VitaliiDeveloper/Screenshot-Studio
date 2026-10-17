// SPDX-License-Identifier: Apache-2.0
import { responseError } from "./json-response.js";

export interface ProjectSourceCapabilities {
  writeInPlace: boolean;
  revealLocation: boolean;
  watchExternalChanges: boolean;
  nativePicker: boolean;
  projectLocalResources: boolean;
  exportProjectArchive: boolean;
  deleteProjectPermanently: boolean;
}

export interface ActiveProjectDescriptor {
  sessionId: string;
  name: string;
  sourceKind: string;
  displayLocation?: string;
  lifecycleRevision?: number;
  capabilities: ProjectSourceCapabilities;
}

export interface ActiveProjectSelection extends ActiveProjectDescriptor {
  projectId: string;
}

export type ProjectSessionFetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export async function fetchActiveProject(
  fetcher: ProjectSessionFetcher = fetch,
): Promise<ActiveProjectSelection | null> {
  const response = await fetcher("/api/project-session", { cache: "no-store" });
  if (response.status === 204) return null;
  if (!response.ok) throw await responseError(response, `Project session request failed (${response.status})`);
  const projectId = response.headers.get("x-project-id")?.trim();
  if (!projectId) throw new Error("Project session response is missing its project identity");
  return {
    ...await response.json() as ActiveProjectDescriptor,
    projectId,
  };
}

export async function closeActiveProject(
  projectId: string,
  fetcher: ProjectSessionFetcher = fetch,
): Promise<void> {
  const response = await fetcher("/api/project-session", {
    method: "DELETE",
    headers: { "x-project-id": projectId },
  });
  if (!response.ok) throw await responseError(response, `Project session request failed (${response.status})`);
}
