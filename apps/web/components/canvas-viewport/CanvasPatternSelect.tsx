// SPDX-License-Identifier: Apache-2.0
"use client";

import { Grid3X3, Grip, SquareDashed } from "lucide-react";
import type { CanvasPattern } from "@web/lib/editor/editor-workspace";
import { MenuSelect, type MenuSelectOption } from "@web/components/editor-ui";

const canvasPatternOptions: MenuSelectOption<CanvasPattern>[] = [
  { value: "dots", label: "Dots", icon: Grip },
  { value: "grid", label: "Grid", icon: Grid3X3 },
  { value: "none", label: "None", icon: SquareDashed },
];

/** Canvas background pattern menu, pinned to the top-right corner clear of the inspector. */
export function CanvasPatternSelect({
  pattern,
  rightInset,
  onPatternChange,
}: {
  pattern: CanvasPattern;
  rightInset: number;
  onPatternChange: (pattern: CanvasPattern) => void;
}) {
  return (
    <div className="absolute top-3 z-30" style={{ right: rightInset + 12 }}>
      <MenuSelect
        ariaLabel={`Canvas background: ${canvasPatternOptions.find((option) => option.value === pattern)?.label ?? "Dots"}`}
        menuLabel="Canvas background"
        value={pattern}
        options={canvasPatternOptions}
        onChange={onPatternChange}
        className="min-w-28"
        triggerClassName="h-9 min-w-28 rounded-xl border-slate-200/80 px-2 font-medium text-slate-600"
        menuClassName="w-40"
        showSelectedIcon
      />
    </div>
  );
}
