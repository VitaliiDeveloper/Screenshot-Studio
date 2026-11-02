// SPDX-License-Identifier: Apache-2.0
import {
  projectLayoutScreenGroup,
  type DesignLayout,
  type Element,
  type Screen,
} from "@screenshot-studio/core/model";
import { primarySelection, type SelectionRef } from "@web/lib/editor/editor-selection";

export interface StageProjection {
  screen: Screen;
  x: number;
  y: number;
}

export function deriveStageModel({
  layout,
  requestedScreenId,
  activeScreenId,
  selectedItems,
  interactive,
  connectedOverview,
}: {
  layout: DesignLayout | null;
  requestedScreenId: string | null | undefined;
  activeScreenId: string | null;
  selectedItems: readonly SelectionRef[];
  interactive: boolean;
  connectedOverview: boolean;
}) {
  const requestedScreen = requestedScreenId
    ? layout?.screens.find((candidate) => candidate.id === requestedScreenId)
    : undefined;
  let projections: StageProjection[] = [];
  let baseX = 0;
  let stageWidth = requestedScreen?.artboard.width ?? 0;
  let stageHeight = requestedScreen?.artboard.height ?? 0;

  if (layout && requestedScreen) {
    if (layout.mode === "connected") {
      projections = projectLayoutScreenGroup(layout, requestedScreen);
      const target = projections.find((entry) => entry.screen.id === requestedScreen.id)!;
      if (connectedOverview) {
        stageWidth = projections.reduce((sum, entry) => sum + entry.screen.artboard.width, 0);
        stageHeight = Math.max(...projections.map((entry) => entry.screen.artboard.height));
      } else {
        baseX = -target.x;
      }
    } else {
      projections = [{ screen: requestedScreen, x: 0, y: 0 }];
    }
  }

  const canEdit = Boolean(
    layout
    && requestedScreen
    && interactive
    && (layout.mode === "connected" ? connectedOverview : requestedScreen.id === activeScreenId),
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
