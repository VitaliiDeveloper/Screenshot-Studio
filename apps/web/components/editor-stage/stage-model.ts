// SPDX-License-Identifier: Apache-2.0
import {
  projectScreenGroup,
  type Element,
  type Project,
  type Screen,
} from "@screenshot-studio/core/model";
import { primarySelection, type SelectionRef } from "../../lib/editor-selection";

export interface StageProjection {
  screen: Screen;
  x: number;
  y: number;
}

export function deriveStageModel({
  project,
  requestedScreenId,
  activeScreenId,
  selectedItems,
  interactive,
  connectedOverview,
}: {
  project: Project | null;
  requestedScreenId: string | null | undefined;
  activeScreenId: string | null;
  selectedItems: readonly SelectionRef[];
  interactive: boolean;
  connectedOverview: boolean;
}) {
  const requestedScreen = requestedScreenId
    ? project?.screens.find((candidate) => candidate.id === requestedScreenId)
    : undefined;
  let projections: StageProjection[] = [];
  let baseX = 0;
  let stageWidth = requestedScreen?.artboard.width ?? 0;
  let stageHeight = requestedScreen?.artboard.height ?? 0;

  if (project && requestedScreen) {
    if (project.mode === "connected") {
      projections = projectScreenGroup(project, requestedScreen.id);
      const target = projections.find((entry) => entry.screen.id === requestedScreen.id)!;
      if (connectedOverview) {
        const last = projections.at(-1)!;
        stageWidth = last.x + last.screen.artboard.width;
        stageHeight = Math.max(...projections.map((entry) => entry.screen.artboard.height));
      } else {
        baseX = -target.x;
      }
    } else {
      projections = [{ screen: requestedScreen, x: 0, y: 0 }];
    }
  }

  const canEdit = Boolean(
    project
    && requestedScreen
    && interactive
    && (project.mode === "connected" ? connectedOverview : requestedScreen.id === activeScreenId),
  );
  const primary = primarySelection(selectedItems);
  const selectedProjection = primary
    ? projections.find((entry) => entry.screen.id === primary.screenId)
    : undefined;
  const selectedElement: Element | undefined = canEdit && primary && selectedProjection
    ? selectedProjection.screen.elements.find((element) => element.id === primary.elementId)
    : undefined;
  return {
    requestedScreen,
    projections,
    baseX,
    stageWidth,
    stageHeight,
    canEdit,
    selectedElement,
  };
}
