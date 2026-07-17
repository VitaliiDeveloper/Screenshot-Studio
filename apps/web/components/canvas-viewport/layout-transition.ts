// SPDX-License-Identifier: Apache-2.0
import type { CanvasMode } from "@screenshot-studio/core/model";
import type { WorkspaceView } from "../../lib/editor-workspace";

export interface CanvasTransitionState {
  layoutId: string | null;
  layoutMode: CanvasMode | null;
  view: WorkspaceView;
}

export type CanvasTransitionKind = "none" | "view" | "layout";

export function canvasTransitionKind(
  previous: CanvasTransitionState,
  next: CanvasTransitionState,
): CanvasTransitionKind {
  if (previous.layoutId !== null && next.layoutId !== null && (
    previous.layoutId !== next.layoutId || previous.layoutMode !== next.layoutMode
  )) {
    return "layout";
  }
  return previous.view === next.view ? "none" : "view";
}
