// SPDX-License-Identifier: Apache-2.0

import type { ImageCache } from "@screenshot-studio/core/assets";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import type { ProjectIssue } from "@screenshot-studio/core/validation";
import type { WorkspaceOutputFamily } from "@web/lib/editor/editor-workspace";
import { EditorStage } from "@web/components/EditorStage";
import { OutputFamilySection } from "./OutputFamilySection";
import { ScreenPreviewMetadata, ScreenPreviewTitle } from "./ScreenPreviewLabels";

export function ConnectedOutputRow({
  row,
  activeScreenId,
  images,
  zoom,
  issues,
  specs,
  onActivate,
}: {
  row: WorkspaceOutputFamily;
  activeScreenId: string | null;
  images: ImageCache;
  zoom: number;
  issues?: readonly ProjectIssue[];
  specs?: StoreSpecs;
  onActivate: (screenId: string) => void;
}) {
  const stageScreenId = row.editing
    && activeScreenId
    && row.screens.some((screen) => screen.id === activeScreenId)
    ? activeScreenId
    : row.screens[0]!.id;
  const artworkWidth = row.screens.reduce((sum, screen) => sum + screen.artboard.width, 0) * zoom;

  return (
    <OutputFamilySection
      label={row.label}
      editing={row.editing}
      artworkWidth={artworkWidth}
      activationLabel={`Edit ${row.label} connected row`}
      onActivate={() => onActivate(row.screens[0]!.id)}
    >
      <div
        className="w-fit"
        data-testid={row.editing ? "connected-artboards" : undefined}
      >
        <div className="flex">
          {row.screens.map((screen) => (
            <div
              key={screen.id}
              data-artboard-screen-id={screen.id}
              style={{ width: screen.artboard.width * zoom }}
            >
              <ScreenPreviewTitle
                screen={screen}
                active={row.editing && screen.id === activeScreenId}
              />
            </div>
          ))}
        </div>
        <div className="relative bg-[var(--editor-color-artboard)] shadow-[0_8px_28px_rgba(15,23,42,0.12)] ring-1 ring-[var(--editor-color-border-strong)]">
          <EditorStage
            images={images}
            zoom={zoom}
          issues={issues}
            screenId={stageScreenId}
            connectedOverview
            interactive={row.editing}
          />
        </div>
        <div className="flex">
          {row.screens.map((screen) => (
            <ScreenPreviewMetadata
              key={screen.id}
              screen={screen}
              specs={specs}
              width={screen.artboard.width * zoom}
            />
          ))}
        </div>
      </div>
    </OutputFamilySection>
  );
}
