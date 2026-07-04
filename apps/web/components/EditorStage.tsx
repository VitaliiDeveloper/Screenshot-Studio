"use client";

import { Stage, Layer, Text, Rect } from "react-konva";
import { useStore } from "zustand";
import { getScreen } from "@screenshot-studio/core/model";
import { elementToNodeConfig } from "@screenshot-studio/core/engine";
import { editorStore } from "../lib/editor-store";

/**
 * Interactive editor canvas. Renders the active screen's elements through the SAME
 * elementToNodeConfig map the export renderer uses (spec §1) — never a parallel react-konva tree
 * with its own prop logic. Interaction (selection, transform, inline edit) is layered on in a
 * later task; this version is the static read-only render.
 */
export function EditorStage() {
  const project = useStore(editorStore, (s) => s.project);
  const activeScreenId = useStore(editorStore, (s) => s.activeScreenId);
  if (!project || !activeScreenId) return null;

  const screen = getScreen(project, activeScreenId);
  const { width, height } = screen.artboard;

  return (
    <Stage width={width} height={height} className="bg-neutral-200">
      <Layer>
        {screen.background.type === "solid" && (
          <Rect x={0} y={0} width={width} height={height} fill={screen.background.color} />
        )}
        {screen.elements.map((element) => {
          if (!element.visible) return null;
          const { konva, config } = elementToNodeConfig(element);
          return konva === "Text" ? (
            <Text key={element.id} {...config} />
          ) : (
            <Rect key={element.id} {...config} />
          );
        })}
      </Layer>
    </Stage>
  );
}
