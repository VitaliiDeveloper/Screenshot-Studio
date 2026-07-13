// SPDX-License-Identifier: Apache-2.0

import type { KeyboardEvent } from "react";
import type { ImageCache } from "@screenshot-studio/core/assets";
import type { WorkspaceOverviewRow } from "../../lib/editor-workspace";
import { cx } from "../editor-ui";
import { EditorStage } from "../EditorStage";
import { ScreenPreviewMetadata, ScreenPreviewTitle } from "./ScreenPreviewLabels";

export function ConnectedOutputRow({
  row,
  activeScreenId,
  images,
  zoom,
  interactive,
  onActivate,
}: {
  row: WorkspaceOverviewRow;
  activeScreenId: string | null;
  images: ImageCache;
  zoom: number;
  interactive: boolean;
  onActivate: (screenId: string) => void;
}) {
  const stageScreenId = interactive
    && activeScreenId
    && row.screens.some((screen) => screen.id === activeScreenId)
    ? activeScreenId
    : row.screens[0]!.id;
  const activate = () => {
    if (!interactive) onActivate(row.screens[0]!.id);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (interactive || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    activate();
  };

  return (
    <section
      aria-label={interactive ? `${row.label} output row` : `Edit ${row.label} connected row`}
      role={interactive ? undefined : "button"}
      tabIndex={interactive ? undefined : 0}
      data-testid="connected-output-row"
      data-editing={interactive ? "true" : "false"}
      className={cx(
        "w-fit shrink-0 self-start rounded-xl",
        interactive && "ring-2 ring-blue-500/30 ring-offset-8 ring-offset-slate-50",
        !interactive && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
      )}
      onClick={activate}
      onKeyDown={onKeyDown}
    >
      <header className="mb-3 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        <span>{row.label}</span>
        {interactive ? (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[9px] tracking-normal text-blue-700">
            Editing
          </span>
        ) : null}
        <span className="h-px min-w-12 flex-1 bg-slate-200" aria-hidden="true" />
      </header>
      <div
        className="w-fit"
        data-testid={interactive ? "connected-artboards" : undefined}
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
                active={interactive && screen.id === activeScreenId}
              />
            </div>
          ))}
        </div>
        <div className="relative overflow-hidden bg-white shadow-[0_8px_28px_rgba(15,23,42,0.12)] ring-1 ring-slate-300">
          <EditorStage
            images={images}
            zoom={zoom}
            screenId={stageScreenId}
            connectedOverview
            interactive={interactive}
          />
        </div>
        <div className="flex">
          {row.screens.map((screen) => (
            <ScreenPreviewMetadata
              key={screen.id}
              screen={screen}
              width={screen.artboard.width * zoom}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
