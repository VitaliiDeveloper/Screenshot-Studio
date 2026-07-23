// SPDX-License-Identifier: Apache-2.0
import type {
  ProjectScaffoldInput,
  ProjectTemplateSummary,
} from "@screenshot-studio/core/scaffold";
import {
  isDeviceSupportedForPlatform,
  recommendedDeviceForPlatform,
} from "@screenshot-studio/core/scaffold";

export const initialProjectCreationState: ProjectCreationState = { status: "closed" };

export type ProjectCreationForm = ProjectScaffoldInput;
export type ProjectCreationFormPatch = Partial<{
  name: ProjectCreationForm["name"];
  platform: ProjectCreationForm["platform"];
  device: ProjectCreationForm["device"];
  layoutMode: ProjectCreationForm["layoutMode"];
  templateId: ProjectCreationForm["templateId"];
}>;

export type ProjectCreationState =
  | { status: "closed" }
  | { status: "editing"; form: ProjectCreationForm; previousErrorMessage?: string }
  | { status: "creating"; form: ProjectCreationForm; previousErrorMessage?: string }
  | { status: "completing"; form: ProjectCreationForm; projectId: string }
  | { status: "error"; form: ProjectCreationForm; message: string };

export type ProjectCreationAction =
  | { type: "open"; form?: ProjectCreationForm }
  | { type: "close" }
  | { type: "change"; patch: ProjectCreationFormPatch }
  | { type: "submit" }
  | { type: "fail"; message: string }
  | { type: "complete"; projectId: string };

const DEFAULT_FORM: ProjectCreationForm = {
  name: "My App Screenshots",
  platform: "apple",
  device: "iphone",
  layoutMode: "isolated",
  templateId: null,
};

export function isProjectTemplateSupported(
  template: ProjectTemplateSummary,
  platform: ProjectCreationForm["platform"],
  device: ProjectCreationForm["device"],
): boolean {
  return template.supportedPlatforms.includes(platform)
    && (template.device === undefined || template.device === device);
}

function changedForm(
  form: ProjectCreationForm,
  patch: ProjectCreationFormPatch,
): ProjectCreationForm {
  const merged = { ...form, ...patch };
  const device = isDeviceSupportedForPlatform(merged.platform, merged.device)
    ? merged.device
    : recommendedDeviceForPlatform(merged.platform);
  return { ...merged, device } as ProjectCreationForm;
}

export function reduceProjectCreationState(
  state: ProjectCreationState,
  action: ProjectCreationAction,
): ProjectCreationState {
  switch (action.type) {
    case "open":
      return state.status === "closed"
        ? { status: "editing", form: action.form ? { ...action.form } : { ...DEFAULT_FORM } }
        : state;
    case "close":
      return state.status === "creating" || state.status === "completing"
        ? state
        : { status: "closed" };
    case "change":
      return state.status === "editing"
        ? {
            status: "editing",
            form: changedForm(state.form, action.patch),
            previousErrorMessage: state.previousErrorMessage,
          }
        : state.status === "error"
          ? {
              status: "editing",
              form: changedForm(state.form, action.patch),
              previousErrorMessage: state.message,
            }
          : state;
    case "submit":
      return state.status === "editing"
        ? {
            status: "creating",
            form: state.form,
            previousErrorMessage: state.previousErrorMessage,
          }
        : state.status === "error"
          ? { status: "creating", form: state.form, previousErrorMessage: state.message }
          : state;
    case "fail":
      return state.status === "creating"
        ? { status: "error", form: state.form, message: action.message }
        : state;
    case "complete":
      return state.status === "creating"
        ? { status: "completing", form: state.form, projectId: action.projectId }
        : state;
  }
}
