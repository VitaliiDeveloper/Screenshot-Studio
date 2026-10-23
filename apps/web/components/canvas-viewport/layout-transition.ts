// SPDX-License-Identifier: Apache-2.0
import type { CanvasMode } from "@screenshot-studio/core/model";
import type { WorkspaceView } from "@web/lib/editor/editor-workspace";

export interface CanvasTransitionState {
  layoutId: string | null;
  layoutMode: CanvasMode | null;
  view: WorkspaceView;
  activeScreenId: string | null;
  screenIds: readonly string[];
}

export type CanvasTransitionKind = "none" | "view" | "layout" | "screen";

export function canvasTransitionKind(
  previous: CanvasTransitionState,
  next: CanvasTransitionState,
): CanvasTransitionKind {
  if (previous.layoutId !== null && next.layoutId !== null && (
    previous.layoutId !== next.layoutId || previous.layoutMode !== next.layoutMode
  )) {
    return "layout";
  }
  if (previous.view !== next.view) return "view";
  // Both screens existing before and after excludes screen creation and deletion.
  if (
    next.view === "focus"
    && previous.activeScreenId !== next.activeScreenId
    && previous.activeScreenId !== null
    && next.activeScreenId !== null
    && previous.screenIds.includes(next.activeScreenId)
    && next.screenIds.includes(previous.activeScreenId)
  ) {
    return "screen";
  }
  return "none";
}
