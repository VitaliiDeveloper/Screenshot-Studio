// SPDX-License-Identifier: Apache-2.0
import { parseProject, type Project } from "@screenshot-studio/core/model";

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
  previewProject: Project | null;
}

export interface ProjectLibraryResult {
  entries: ProjectLibraryEntry[];
}

export type ProjectLibraryTransport = (url: string, init?: RequestInit) => Promise<Response>;

const ENTRY_ID_PATTERN = /^(?:project|recent)_[0-9a-f]{32}$/;
const PROJECT_ID_PATTERN = /^(?:project_[0-9a-f]{32}|[0-9a-f]{64})$/;
const ENTRY_KEYS = [
  "entryId", "sourceKind", "name", "lastOpenedAt", "availability", "platforms",
  "screenCount", "layoutCount", "previewLayoutId", "previewScreenIds", "previewProject",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

function boundedString(value: unknown, maximum = 200): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function isoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function boundedCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 100_000;
}

function parseEntry(value: unknown): ProjectLibraryEntry {
  try {
    if (!isRecord(value) || !hasExactKeys(value, ENTRY_KEYS)
      || typeof value.entryId !== "string" || !ENTRY_ID_PATTERN.test(value.entryId)
      || (value.sourceKind !== "managed-project" && value.sourceKind !== "local-file")
      || !boundedString(value.name) || !isoTimestamp(value.lastOpenedAt)
      || (value.availability !== "available" && value.availability !== "unavailable")
      || !Array.isArray(value.platforms) || value.platforms.length > 20
      || !value.platforms.every((platform) => boundedString(platform, 100))
      || !boundedCount(value.screenCount) || !boundedCount(value.layoutCount)
      || (value.previewLayoutId !== null && !boundedString(value.previewLayoutId, 200))
      || !Array.isArray(value.previewScreenIds) || value.previewScreenIds.length > 3
      || !value.previewScreenIds.every((screenId) => boundedString(screenId, 200))) {
      throw new Error("shape");
    }
    const previewProject = value.previewProject === null ? null : parseProject(value.previewProject);
    if (value.availability === "available" && !previewProject) {
      throw new Error("available preview project missing");
    }
    if (value.availability === "unavailable" && previewProject) {
      throw new Error("unavailable preview project present");
    }
    return {
      entryId: value.entryId,
      sourceKind: value.sourceKind,
      name: value.name,
      lastOpenedAt: value.lastOpenedAt,
      availability: value.availability,
      platforms: [...value.platforms],
      screenCount: value.screenCount,
      layoutCount: value.layoutCount,
      previewLayoutId: value.previewLayoutId,
      previewScreenIds: [...value.previewScreenIds],
      previewProject,
    };
  } catch {
    throw new Error("Invalid project library response");
  }
}

export function projectLibraryEntriesEqual(
  left: readonly ProjectLibraryEntry[],
  right: readonly ProjectLibraryEntry[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const value = await response.json().catch(() => null) as unknown;
  return new Error(isRecord(value) && typeof value.error === "string" ? value.error : fallback);
}

const defaultTransport: ProjectLibraryTransport = (url, init) => fetch(url, init);

export async function fetchProjectLibrary({
  transport = defaultTransport,
}: { transport?: ProjectLibraryTransport } = {}): Promise<ProjectLibraryResult> {
  const response = await transport("/api/project-library", { cache: "no-store" });
  if (!response.ok) throw await responseError(response, "Projects could not be loaded.");
  const value = await response.json() as unknown;
  if (!isRecord(value) || !hasExactKeys(value, ["entries"]) || !Array.isArray(value.entries)) {
    throw new Error("Invalid project library response");
  }
  return { entries: value.entries.map(parseEntry) };
}

export async function openProjectLibraryEntry(
  entryId: string,
  { transport = defaultTransport }: { transport?: ProjectLibraryTransport } = {},
): Promise<{ projectId: string }> {
  if (!ENTRY_ID_PATTERN.test(entryId)) throw new Error("Invalid project library entry id");
  const response = await transport("/api/project-library", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entryId }),
  });
  if (!response.ok) throw await responseError(response, "Project could not be opened.");
  const value = await response.json() as unknown;
  if (!isRecord(value) || !hasExactKeys(value, ["projectId"])
    || typeof value.projectId !== "string" || !PROJECT_ID_PATTERN.test(value.projectId)) {
    throw new Error("Invalid project library response");
  }
  return { projectId: value.projectId };
}

export function projectLibraryAssetUrl(entryId: string, path: string): string {
  if (!ENTRY_ID_PATTERN.test(entryId)) throw new Error("Invalid project library entry id");
  const query = new URLSearchParams({ entryId, path });
  return `/api/project-library/asset?${query.toString()}`;
}
