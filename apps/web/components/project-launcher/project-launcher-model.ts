// SPDX-License-Identifier: Apache-2.0
import type { BrowserProjectImportSource } from "@web/lib/project-import-client.js";

type LauncherImportKind = BrowserProjectImportSource["kind"];

export const launcherActions = {
  createEnabled: true,
  importEnabled: true,
  recentProjects: [],
} as const;

export type LauncherImportState =
  | { status: "idle" }
  | { status: "choosing" }
  | { status: "confirming"; kind: LauncherImportKind }
  | { status: "uploading"; kind: LauncherImportKind; cancellable: true }
  | { status: "publishing"; kind: LauncherImportKind; cancellable: false }
  | { status: "error"; message: string; missingResources: readonly string[] }
  | { status: "cancelled" };

export type LauncherImportAction =
  | { type: "choose" }
  | { type: "select"; kind: LauncherImportKind }
  | { type: "confirm" }
  | { type: "publishing" }
  | { type: "complete" }
  | { type: "cancel" }
  | { type: "fail"; message: string; missingResources?: readonly string[] }
  | { type: "retry" }
  | { type: "close" };

export function reduceLauncherImportState(
  state: LauncherImportState,
  action: LauncherImportAction,
): LauncherImportState {
  switch (action.type) {
    case "choose":
    case "retry":
      return { status: "choosing" };
    case "select":
      return { status: "confirming", kind: action.kind };
    case "confirm":
      return state.status === "confirming"
        ? { status: "uploading", kind: state.kind, cancellable: true }
        : state;
    case "publishing":
      return state.status === "uploading"
        ? { status: "publishing", kind: state.kind, cancellable: false }
        : state;
    case "complete":
    case "close":
      return { status: "idle" };
    case "cancel":
      return state.status === "publishing" ? state : { status: "cancelled" };
    case "fail":
      return {
        status: "error",
        message: action.message,
        missingResources: action.missingResources ?? [],
      };
  }
}
