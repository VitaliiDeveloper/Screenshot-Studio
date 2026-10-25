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

export function CanvasPatternSelect({
  pattern,
  onPatternChange,
}: {
  pattern: CanvasPattern;
  onPatternChange: (pattern: CanvasPattern) => void;
}) {
  return (
    <MenuSelect
      ariaLabel={`Canvas background: ${canvasPatternOptions.find((option) => option.value === pattern)?.label ?? "Dots"}`}
      menuLabel="Canvas background"
      value={pattern}
      options={canvasPatternOptions}
      onChange={onPatternChange}
      className="min-w-28"
      triggerClassName="!h-8 min-w-28 !border-transparent !shadow-none px-1.5 font-medium text-[color:var(--editor-color-text-muted)] hover:bg-[var(--editor-color-surface-subtle)]"
      menuClassName="w-40"
      showSelectedIcon
    />
  );
}
