// SPDX-License-Identifier: Apache-2.0

import type { CSSProperties } from "react";
import type { Screen } from "@screenshot-studio/core/model";
import { cx } from "@web/components/editor-ui";

function previewWidthStyle(width?: number): CSSProperties | undefined {
  return width === undefined ? undefined : { width };
}

export function screenPreviewMetadata(screen: Screen): string {
  return `${screen.device} · ${screen.locale}${screen.storeTargetId ? ` · ${screen.storeTargetId}` : ""}`;
}

/** Every canvas mode uses the same preview hierarchy: title above artwork, metadata below it. */
export function ScreenPreviewTitle({
  screen,
  active,
  width,
}: {
  screen: Screen;
  active: boolean;
  width?: number;
}) {
  return (
    <div
      className={cx(
        "mb-2 flex h-5 min-w-0 shrink-0 items-center overflow-hidden text-[11px] font-semibold leading-5",
        active ? "text-blue-700" : "text-slate-500",
      )}
      data-testid="artboard-preview-label"
      style={previewWidthStyle(width)}
    >
      <span
        data-testid="artboard-preview-name"
        className="min-w-0 truncate whitespace-nowrap"
        title={screen.name}
      >
        {screen.name}
      </span>
    </div>
  );
}

export function ScreenPreviewMetadata({ screen, width }: { screen: Screen; width?: number }) {
  const metadata = screenPreviewMetadata(screen);
  return (
    <div
      className="mt-2 flex h-5 min-w-0 shrink-0 items-center overflow-hidden text-[10px] font-normal leading-5 text-slate-400"
      data-testid="artboard-preview-caption"
      style={previewWidthStyle(width)}
    >
      <span
        data-testid="artboard-preview-metadata"
        className="min-w-0 truncate whitespace-nowrap"
        title={metadata}
      >
        {metadata}
      </span>
    </div>
  );
}
