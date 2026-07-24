// SPDX-License-Identifier: Apache-2.0
import type { ProjectScaffoldInput } from "@screenshot-studio/core/scaffold";
import { recommendedDeviceForPlatform } from "@screenshot-studio/core/scaffold";
import { DEFAULT_STORE_SPECS, type StoreSpecs } from "@screenshot-studio/core/export";
import type {
  CaptureImportDestination,
  CaptureImportPreview,
  CaptureImportRequest,
} from "@web/lib/capture-import-client.js";

export interface CaptureImportCurrentTarget {
  projectId: string;
  revision: string;
  projectName: string;
  preferredLayoutId: string;
  layouts: Array<{ id: string; name: string }>;
}

export interface CaptureImportDraft {
  files: readonly File[];
  destinationKind: CaptureImportDestination["kind"] | null;
  currentTarget: CaptureImportCurrentTarget | null;
  currentLayoutId: string;
  newProject: ProjectScaffoldInput & { templateId: null };
}

type EditingState = { status: "editing"; draft: CaptureImportDraft; notice?: string };
type PreviewingState = { status: "previewing"; draft: CaptureImportDraft };
type ReviewingState = {
  status: "reviewing";
  draft: CaptureImportDraft;
  preview: CaptureImportPreview;
};
type ApplyingState = {
  status: "applying";
  draft: CaptureImportDraft;
  preview: CaptureImportPreview;
};
type ErrorState = {
  status: "error";
  draft: CaptureImportDraft;
  preview?: CaptureImportPreview;
  message: string;
  staleTarget: boolean;
  recovering?: boolean;
};

export type CaptureImportState =
  | { status: "closed" }
  | EditingState
  | PreviewingState
  | ReviewingState
  | ApplyingState
  | ErrorState;

export type CaptureImportNewProjectPatch = Partial<{
  name: ProjectScaffoldInput["name"];
  platform: ProjectScaffoldInput["platform"];
  layoutMode: ProjectScaffoldInput["layoutMode"];
}>;

export type CaptureImportAction =
  | { type: "open"; currentTarget: CaptureImportCurrentTarget | null }
  | { type: "choose-files"; files: readonly File[] }
  | { type: "choose-destination"; kind: CaptureImportDestination["kind"] }
  | { type: "choose-current-layout"; layoutId: string }
  | { type: "change-new-project"; patch: CaptureImportNewProjectPatch }
  | { type: "request-preview" }
  | { type: "preview-succeeded"; preview: CaptureImportPreview }
  | { type: "apply" }
  | { type: "failed"; message: string; staleTarget?: boolean }
  | { type: "cancelled"; phase: "preview" | "apply" }
  | { type: "retry" }
  | { type: "request-recovery" }
  | { type: "recovery-succeeded" }
  | { type: "recovery-failed"; message: string }
  | { type: "complete" }
  | { type: "close" };

function draft(currentTarget: CaptureImportCurrentTarget | null, specs: StoreSpecs): CaptureImportDraft {
  return {
    files: [],
    destinationKind: null,
    currentTarget,
    currentLayoutId: currentTarget?.preferredLayoutId ?? currentTarget?.layouts[0]?.id ?? "",
    newProject: {
      name: "Imported captures",
      platform: "apple",
      device: recommendedDeviceForPlatform("apple", specs),
      layoutMode: "isolated",
      templateId: null,
    },
  };
}

export function createCaptureImportState(
  currentTarget: CaptureImportCurrentTarget | null,
  specs: StoreSpecs = DEFAULT_STORE_SPECS,
): EditingState {
  return { status: "editing", draft: draft(currentTarget, specs) };
}

function editable(state: CaptureImportState): EditingState | null {
  if (state.status === "editing") return state;
  if (state.status === "reviewing" || state.status === "error") {
    return { status: "editing", draft: state.draft };
  }
  return null;
}

export function captureImportRequest(state: Exclude<CaptureImportState, { status: "closed" }>): CaptureImportRequest | null {
  const { draft: value } = state;
  let destination: CaptureImportDestination;
  if (value.destinationKind === "current-project") {
    if (!value.currentTarget || !value.currentLayoutId) return null;
    destination = {
      kind: "current-project",
      projectId: value.currentTarget.projectId,
      revision: value.currentTarget.revision,
      projectName: value.currentTarget.projectName,
      layoutId: value.currentLayoutId,
    };
  } else if (value.destinationKind === "new-project") {
    if (!value.newProject.name.trim()) return null;
    destination = { kind: "new-project", ...value.newProject, name: value.newProject.name.trim() };
  } else {
    return null;
  }
  return value.files.length === 0 ? null : { files: value.files, destination };
}

export function canPreviewCaptureImport(state: CaptureImportState): boolean {
  return state.status === "editing" && captureImportRequest(state) !== null;
}

export function canApplyCaptureImport(state: CaptureImportState): state is ReviewingState {
  return state.status === "reviewing" && state.preview.canApply;
}

export function reduceCaptureImportState(
  state: CaptureImportState,
  action: CaptureImportAction,
  specs: StoreSpecs = DEFAULT_STORE_SPECS,
): CaptureImportState {
  if (action.type === "open") {
    return state.status === "closed" ? createCaptureImportState(action.currentTarget, specs) : state;
  }
  if (action.type === "complete") return { status: "closed" };
  if (action.type === "close") {
    return state.status === "previewing" || state.status === "applying"
      || (state.status === "error" && (state.recovering || state.staleTarget))
      ? state : { status: "closed" };
  }
  if (state.status === "closed") return state;
  if (action.type === "request-recovery") {
    return state.status === "error" && state.staleTarget && !state.recovering
      ? { ...state, recovering: true }
      : state;
  }
  if (action.type === "recovery-succeeded") {
    return state.status === "error" && state.recovering ? { status: "closed" } : state;
  }
  if (action.type === "recovery-failed") {
    return state.status === "error" && state.recovering
      ? { ...state, message: action.message, recovering: false }
      : state;
  }
  if (action.type === "choose-files") {
    const next = editable(state);
    return next ? { status: "editing", draft: { ...next.draft, files: action.files } } : state;
  }
  if (action.type === "choose-destination") {
    const next = editable(state);
    if (!next || (action.kind === "current-project" && !next.draft.currentTarget)) return state;
    return { status: "editing", draft: { ...next.draft, destinationKind: action.kind } };
  }
  if (action.type === "choose-current-layout") {
    const next = editable(state);
    if (!next?.draft.currentTarget?.layouts.some(({ id }) => id === action.layoutId)) return state;
    return { status: "editing", draft: { ...next.draft, currentLayoutId: action.layoutId } };
  }
  if (action.type === "change-new-project") {
    const next = editable(state);
    if (!next) return state;
    const merged = { ...next.draft.newProject, ...action.patch };
    return {
      status: "editing",
      draft: {
        ...next.draft,
        newProject: {
          name: merged.name,
          platform: merged.platform,
          device: recommendedDeviceForPlatform(merged.platform, specs),
          layoutMode: merged.layoutMode,
          templateId: null,
        } as CaptureImportDraft["newProject"],
      },
    };
  }
  if (action.type === "request-preview") {
    return canPreviewCaptureImport(state) ? { status: "previewing", draft: state.draft } : state;
  }
  if (action.type === "preview-succeeded") {
    return state.status === "previewing"
      ? { status: "reviewing", draft: state.draft, preview: action.preview }
      : state;
  }
  if (action.type === "apply") {
    return canApplyCaptureImport(state)
      ? { status: "applying", draft: state.draft, preview: state.preview }
      : state;
  }
  if (action.type === "failed") {
    if (state.status !== "previewing" && state.status !== "applying") return state;
    return {
      status: "error",
      draft: state.draft,
      ...(state.status === "applying" ? { preview: state.preview } : {}),
      message: action.message,
      staleTarget: action.staleTarget ?? false,
    };
  }
  if (action.type === "cancelled") {
    if (action.phase === "preview" && state.status === "previewing") {
      return { status: "editing", draft: state.draft, notice: "Capture import preview cancelled" };
    }
    if (action.phase === "apply" && state.status === "applying") {
      return {
        status: "error",
        draft: state.draft,
        preview: state.preview,
        message: "The confirmation request was cancelled. Its final server result is unknown.",
        staleTarget: true,
      };
    }
    return state;
  }
  if (action.type === "retry") {
    if (state.status === "error" && state.staleTarget) return state;
    const next = editable(state);
    return next ?? state;
  }
  return state;
}
