// SPDX-License-Identifier: Apache-2.0

export interface ProjectSourceCapabilities {
  writeInPlace: boolean;
  revealLocation: boolean;
  watchExternalChanges: boolean;
  nativePicker: boolean;
  projectLocalResources: boolean;
}

export interface ActiveProjectDescriptor {
  sessionId: string;
  name: string;
  sourceKind: string;
  displayLocation?: string;
  capabilities: ProjectSourceCapabilities;
}

export type ProjectSessionFetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

async function responseError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => ({})) as { error?: unknown };
  return new Error(typeof body.error === "string"
    ? body.error
    : `Project session request failed (${response.status})`);
}

export async function fetchActiveProject(
  fetcher: ProjectSessionFetcher = fetch,
): Promise<ActiveProjectDescriptor | null> {
  const response = await fetcher("/api/project-session", { cache: "no-store" });
  if (response.status === 204) return null;
  if (!response.ok) throw await responseError(response);
  return await response.json() as ActiveProjectDescriptor;
}
