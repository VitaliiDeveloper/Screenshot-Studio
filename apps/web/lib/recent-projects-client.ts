// SPDX-License-Identifier: Apache-2.0
export type RecentProjectSummary = {
  recentId: string;
  sourceKind: "managed-project" | "local-file";
  name: string;
  lastOpenedAt: string;
  availability: "available" | "unavailable";
};

export type RecentProjectsResult = { entries: RecentProjectSummary[] };

export type RecentProjectsTransport = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

const RECENT_ID_PATTERN = /^recent_[0-9a-f]{32}$/;
const PROJECT_ID_PATTERN = /^project_[0-9a-f]{32}$/;
const LOCAL_PROJECT_ID_PATTERN = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

function parseSummary(value: unknown): RecentProjectSummary {
  if (!isRecord(value) || !exactKeys(value, [
    "recentId", "sourceKind", "name", "lastOpenedAt", "availability",
  ]) || typeof value.recentId !== "string" || !RECENT_ID_PATTERN.test(value.recentId)
    || (value.sourceKind !== "managed-project" && value.sourceKind !== "local-file")
    || typeof value.name !== "string" || value.name.length === 0 || value.name.length > 200
    || typeof value.lastOpenedAt !== "string"
    || Number.isNaN(new Date(value.lastOpenedAt).valueOf())
    || new Date(value.lastOpenedAt).toISOString() !== value.lastOpenedAt
    || (value.availability !== "available" && value.availability !== "unavailable")) {
    throw new Error("Invalid recent projects response");
  }
  return {
    recentId: value.recentId,
    sourceKind: value.sourceKind,
    name: value.name,
    lastOpenedAt: value.lastOpenedAt,
    availability: value.availability,
  };
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const value = await response.json().catch(() => null) as unknown;
  return new Error(isRecord(value) && typeof value.error === "string" ? value.error : fallback);
}

const defaultTransport: RecentProjectsTransport = (url, init) => fetch(url, init);

export async function fetchRecentProjects({
  transport = defaultTransport,
}: {
  transport?: RecentProjectsTransport;
} = {}): Promise<RecentProjectsResult> {
  const response = await transport("/api/recent-projects", { cache: "no-store" });
  if (!response.ok) throw await responseError(response, "Recent projects could not be loaded.");
  const value = await response.json() as unknown;
  if (!isRecord(value) || !exactKeys(value, ["entries"]) || !Array.isArray(value.entries)) {
    throw new Error("Invalid recent projects response");
  }
  return { entries: value.entries.map(parseSummary) };
}

async function mutateRecent(
  url: string,
  method: "POST" | "DELETE",
  recentId: string,
  transport: RecentProjectsTransport,
): Promise<Response> {
  if (!RECENT_ID_PATTERN.test(recentId)) throw new Error("Invalid recent project id");
  return transport(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recentId }),
  });
}

export async function openRecentProject(
  recentId: string,
  { transport = defaultTransport }: { transport?: RecentProjectsTransport } = {},
): Promise<{ projectId: string }> {
  const response = await mutateRecent("/api/recent-projects/open", "POST", recentId, transport);
  if (!response.ok) throw await responseError(response, "Recent project could not be opened.");
  const value = await response.json() as unknown;
  if (!isRecord(value) || !exactKeys(value, ["projectId"])
    || typeof value.projectId !== "string"
    || (!PROJECT_ID_PATTERN.test(value.projectId) && !LOCAL_PROJECT_ID_PATTERN.test(value.projectId))) {
    throw new Error("Invalid recent project response");
  }
  return { projectId: value.projectId };
}

export async function removeRecentProject(
  recentId: string,
  { transport = defaultTransport }: { transport?: RecentProjectsTransport } = {},
): Promise<void> {
  const response = await mutateRecent("/api/recent-projects", "DELETE", recentId, transport);
  if (!response.ok) throw await responseError(response, "Recent project could not be removed.");
}
