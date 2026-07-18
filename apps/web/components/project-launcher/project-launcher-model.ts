// SPDX-License-Identifier: Apache-2.0
import type { BrowserProjectImportSource } from "@web/lib/project-import-client.js";

type LauncherImportKind = BrowserProjectImportSource["kind"];

export const launcherActions = {
  createEnabled: false,
  importEnabled: true,
  recentProjects: [],
} as const;

export type LauncherImportState =
  | { status: "idle" }
  | { status: "choosing" }
  | { status: "uploading"; kind: LauncherImportKind; cancellable: true }
  | { status: "publishing"; kind: LauncherImportKind; cancellable: false }
  | { status: "error"; message: string; missingResources: readonly string[] }
  | { status: "cancelled" };

export type LauncherImportAction =
  | { type: "choose" }
  | { type: "upload"; kind: LauncherImportKind }
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
    case "upload":
      return { status: "uploading", kind: action.kind, cancellable: true };
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
