// SPDX-License-Identifier: Apache-2.0
import {
  flushScheduledSave,
  saveLatestProject,
} from "./debounced-save.js";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  type CanvasPattern,
  type WorkspacePanel,
  type WorkspaceTool,
  type WorkspaceView,
} from "./editor-workspace.js";

const STORAGE_PREFIX = "screenshot-studio:workspace-navigation:v1:";

export interface WorkspaceNavigationState {
  zoom: number;
  view: WorkspaceView;
  tool: WorkspaceTool;
  pattern: CanvasPattern;
  panel: WorkspacePanel | null;
  lastPanel: WorkspacePanel;
  inspectorOpen: boolean;
}

function browserStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(projectId)}`;
}

const VIEWS = new Set<WorkspaceView>(["focus", "overview"]);
const TOOLS = new Set<WorkspaceTool>(["select", "hand"]);
const PATTERNS = new Set<CanvasPattern>(["dots", "grid", "none"]);
const PANELS = new Set<WorkspacePanel>(["structure", "resources", "add"]);

function isWorkspaceNavigationState(value: unknown): value is WorkspaceNavigationState & { version: 1 } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WorkspaceNavigationState> & { version?: unknown };
  return candidate.version === 1
    && typeof candidate.zoom === "number"
    && Number.isFinite(candidate.zoom)
    && candidate.zoom >= MIN_ZOOM
    && candidate.zoom <= MAX_ZOOM
    && VIEWS.has(candidate.view as WorkspaceView)
    && TOOLS.has(candidate.tool as WorkspaceTool)
    && PATTERNS.has(candidate.pattern as CanvasPattern)
    && (candidate.panel === null || PANELS.has(candidate.panel as WorkspacePanel))
    && PANELS.has(candidate.lastPanel as WorkspacePanel)
    && typeof candidate.inspectorOpen === "boolean";
}

export function readWorkspaceNavigationState(
  projectId: string,
  storage?: Storage,
): WorkspaceNavigationState | null {
  try {
    const serialized = browserStorage(storage)?.getItem(storageKey(projectId));
    if (!serialized) return null;
    const parsed: unknown = JSON.parse(serialized);
    if (!isWorkspaceNavigationState(parsed)) return null;
    const { version: _version, ...state } = parsed;
    return state;
  } catch {
    return null;
  }
}

export function writeWorkspaceNavigationState(
  projectId: string,
  state: WorkspaceNavigationState,
  storage?: Storage,
): void {
  try {
    browserStorage(storage)?.setItem(storageKey(projectId), JSON.stringify({ version: 1, ...state }));
  } catch {
    // Session storage is optional; the mounted editor still retains the current state.
  }
}

export function clearWorkspaceNavigationState(projectId: string, storage?: Storage): void {
  try {
    browserStorage(storage)?.removeItem(storageKey(projectId));
  } catch {
    // Storage can be blocked without changing the active project session.
  }
}

export async function navigateToProjectHome(dependencies: {
  flushPending?: () => Promise<void>;
  saveLatest?: () => Promise<void>;
  navigate: () => void;
}): Promise<void> {
  await (dependencies.flushPending ?? flushScheduledSave)();
  await (dependencies.saveLatest ?? saveLatestProject)();
  dependencies.navigate();
}
