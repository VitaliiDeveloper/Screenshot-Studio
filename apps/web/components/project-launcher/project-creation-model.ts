// SPDX-License-Identifier: Apache-2.0
import type {
  ProjectScaffoldInput,
  ProjectTemplateSummary,
} from "@screenshot-studio/core/scaffold";

export const initialProjectCreationState: ProjectCreationState = { status: "closed" };

export type ProjectCreationForm = ProjectScaffoldInput;

export type ProjectCreationState =
  | { status: "closed" }
  | { status: "editing"; form: ProjectCreationForm }
  | { status: "creating"; form: ProjectCreationForm }
  | { status: "error"; form: ProjectCreationForm; message: string };

export type ProjectCreationAction =
  | { type: "open" }
  | { type: "close" }
  | { type: "change"; patch: Partial<ProjectCreationForm> }
  | { type: "submit" }
  | { type: "fail"; message: string }
  | { type: "complete" };

const DEFAULT_FORM: ProjectCreationForm = {
  name: "My App Screenshots",
  platform: "apple",
  layoutMode: "isolated",
  templateId: null,
};

export function isProjectTemplateSupported(
  template: ProjectTemplateSummary,
  platform: ProjectCreationForm["platform"],
): boolean {
  return template.supportedPlatforms.includes(platform);
}

export function reduceProjectCreationState(
  state: ProjectCreationState,
  action: ProjectCreationAction,
): ProjectCreationState {
  switch (action.type) {
    case "open":
      return state.status === "closed"
        ? { status: "editing", form: { ...DEFAULT_FORM } }
        : state;
    case "close":
      return state.status === "creating" ? state : { status: "closed" };
    case "change":
      return state.status === "editing" || state.status === "error"
        ? { status: "editing", form: { ...state.form, ...action.patch } }
        : state;
    case "submit":
      return state.status === "editing" || state.status === "error"
        ? { status: "creating", form: state.form }
        : state;
    case "fail":
      return state.status === "creating"
        ? { status: "error", form: state.form, message: action.message }
        : state;
    case "complete":
      return { status: "closed" };
  }
}
