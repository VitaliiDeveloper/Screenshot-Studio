// SPDX-License-Identifier: Apache-2.0
"use client";

import type { CSSProperties } from "react";
import { fontIdentityKey, type FontAsset, type TextElement } from "@screenshot-studio/core/model";
import type { ElementPatchFor } from "@web/lib/editor/editor-store";
import { MenuSelect } from "@web/components/editor-ui";
import { fontIdentityOptions } from "@web/components/inspector/inspector-fields";

const item = "flex h-6 items-center gap-1.5 rounded-md px-2 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)]";

/** Text layer actions above the selection (Handoff 6a), the same edits the Layer tab makes. */
export function SelectionToolbar({
  element,
  fonts,
  fitSize,
  style,
  onChange,
  onFit,
}: {
  element: TextElement;
  fonts: FontAsset[];
  /** Fit text size when the layer overflows; null when even 1 px does not fit, undefined when it fits. */
  fitSize: number | null | undefined;
  style: CSSProperties;
  onChange: (change: ElementPatchFor<"text">) => void;
  onFit: (size: number) => void;
}) {
  const fontOptions = fontIdentityOptions(fonts, { family: element.fontFamily, weight: element.weight })
    .map((option) => ({ ...option, triggerLabel: "Font" }));
  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      className="absolute z-20 flex items-center gap-0.5 whitespace-nowrap rounded-lg bg-slate-900 p-1 text-[11px] text-white shadow-lg shadow-slate-950/30"
      style={style}
      onClick={(event) => event.stopPropagation()}
    >
      <MenuSelect
        ariaLabel="Selection font"
        menuLabel="Fonts"
        value={fontIdentityKey({ family: element.fontFamily, weight: element.weight })}
        options={fontOptions}
        appearance="breadcrumb"
        density="compact"
        triggerClassName="!h-6 !min-h-6 !px-2 hover:!bg-white/10 [&>span]:!text-white"
        menuClassName="!left-0 !right-auto w-56 text-[color:var(--editor-color-text)]"
        onChange={(value) => {
          const [fontFamily, weight] = JSON.parse(value) as [string, number];
          onChange({ fontFamily, weight });
        }}
      />
      <label className={`${item} cursor-pointer focus-within:ring-2 focus-within:ring-[var(--editor-color-focus)]`}>
        <input
          type="color"
          aria-label="Selection color"
          value={element.color}
          onChange={(event) => onChange({ color: event.currentTarget.value })}
          className="size-3.5 shrink-0 cursor-pointer rounded-sm border-0 bg-transparent p-0"
        />
        Color
      </label>
      <button
        type="button"
        aria-label="Fit text"
        disabled={!fitSize}
        title={fitSize === undefined
          ? "The text fits its box."
          : fitSize === null
            ? "The text overflows even at 1 px. Resize the layer instead."
            : "Set the largest size that fits, on this screen only."}
        className={`${item} disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent`}
        onClick={() => {
          if (fitSize) onFit(fitSize);
        }}
      >
        Fit
      </button>
    </div>
  );
}
