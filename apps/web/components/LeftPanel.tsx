"use client";

import { ScreensSection } from "./ScreensSection";
import { LayersSection } from "./LayersSection";

/** The editor's left panel: Screens on top, Layers below (active screen). */
export function LeftPanel() {
  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-neutral-200 bg-white">
      <ScreensSection />
      <LayersSection />
    </aside>
  );
}
