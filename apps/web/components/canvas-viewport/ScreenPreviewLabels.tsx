// SPDX-License-Identifier: Apache-2.0

import type { CSSProperties } from "react";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import type { Screen } from "@screenshot-studio/core/model";
import { cx } from "@web/components/editor-ui";
import { screenSizeLabel } from "@web/lib/editor/editor-issues";
import { screenStoreTarget } from "@web/lib/editor/editor-workspace";

function previewWidthStyle(width?: number): CSSProperties | undefined {
  return width === undefined ? undefined : { width };
}

export function screenPreviewMetadata(screen: Screen, specs?: StoreSpecs): string {
  const target = screenStoreTarget(screen, specs);
  return [
    screenSizeLabel(screen, specs),
    target ? `${target.width} × ${target.height}` : null,
    screen.locale,
  ].filter(Boolean).join(" · ");
}

/** Every canvas mode uses the same preview hierarchy: title above artwork, metadata below it. */
export function ScreenPreviewTitle({
  screen,
  active,
  width,
  className,
}: {
  screen: Screen;
  active: boolean;
  width?: number;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "mb-2 flex h-5 min-w-0 shrink-0 items-center overflow-hidden text-[11px] font-semibold leading-5 transition-colors duration-200 ease-[var(--editor-motion-ease)] motion-reduce:transition-none",
        active ? "text-blue-700" : "text-slate-500",
        className,
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

export function ScreenPreviewMetadata({
  screen,
  specs,
  width,
  className,
}: {
  screen: Screen;
  specs?: StoreSpecs;
  width?: number;
  className?: string;
}) {
  const metadata = screenPreviewMetadata(screen, specs);
  return (
    <div
      className={cx(
        "mt-2 flex h-5 min-w-0 shrink-0 items-center overflow-hidden text-[10px] font-normal leading-5 text-slate-400",
        className,
      )}
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
