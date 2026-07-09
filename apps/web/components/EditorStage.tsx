"use client";

import { useEffect, useRef, useState } from "react";
import Konva from "konva";
import { Stage, Layer, Text, Rect, Image as KonvaImage, Group, Transformer } from "react-konva";
import { useStore } from "zustand";
import { assertNever, getScreen } from "@screenshot-studio/core/model";
import { elementToNodeConfig, type NodeConfig } from "@screenshot-studio/core/engine";
import type { ImageCache } from "@screenshot-studio/core/assets";
import { editorStore, type ElementPatch } from "../lib/editor-store";
import { mutateAndSave } from "../lib/mutate-and-save";

/**
 * Interactive editor canvas. Elements are rendered through the SAME elementToNodeConfig map the
 * export renderer uses (spec §1). Interaction props (draggable, listeners) and the Transformer
 * are layered on here only — they never touch the shared map, so export output is unaffected.
 * Each committed change flows through the store then mutateAndSave.
 */
function renderNodeConfigChild(child: NodeConfig, key: number) {
  switch (child.konva) {
    case "Image":
      return <KonvaImage key={key} {...child.config} listening={false} />;
    case "Rect":
      return <Rect key={key} {...child.config} listening={false} />;
    case "Text":
    case "Group":
      // Device-frame children are only Rect/Image today; keep exhaustive for future groups.
      return null;
    default:
      return assertNever(child);
  }
}

export function EditorStage({ images, zoom = 1 }: { images: ImageCache; zoom?: number }) {
  const project = useStore(editorStore, (s) => s.project);
  const activeScreenId = useStore(editorStore, (s) => s.activeScreenId);
  const selectedId = useStore(editorStore, (s) => s.selectedId);

  const trRef = useRef<Konva.Transformer>(null);
  const nodeRefs = useRef(new Map<string, Konva.Node>());
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);

  // Keep the Transformer attached to whatever node is selected.
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = selectedId ? nodeRefs.current.get(selectedId) : undefined;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, project]);

  if (!project || !activeScreenId) return null;
  const screen = getScreen(project, activeScreenId);
  const { width, height } = screen.artboard;

  const commit = (id: string, patch: ElementPatch) => {
    mutateAndSave(() => editorStore.getState().patchElement(id, patch));
  };

  const onDragEnd = (id: string) => (e: Konva.KonvaEventObject<DragEvent>) => {
    commit(id, { x: e.target.x(), y: e.target.y() });
  };

  // Konva applies scale on transform; bake it into width/height and reset scale to 1.
  const onTransformEnd = (id: string) => (e: Konva.KonvaEventObject<Event>) => {
    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    commit(id, {
      x: node.x(),
      y: node.y(),
      rotation: node.rotation(),
      width: Math.max(5, node.width() * scaleX),
      height: Math.max(5, node.height() * scaleY),
    });
  };

  return (
    <div style={{ position: "relative", width: width * zoom, height: height * zoom }}>
      <Stage
        width={width * zoom}
        height={height * zoom}
        scaleX={zoom}
        scaleY={zoom}
        className="bg-neutral-200"
        onMouseDown={(e) => {
          // Click on empty stage clears the selection.
          if (e.target === e.target.getStage()) editorStore.getState().select(null);
        }}
      >
        <Layer>
          {screen.background.type === "solid" && (
            <Rect x={0} y={0} width={width} height={height} fill={screen.background.color} listening={false} />
          )}
          {screen.elements.map((element) => {
            if (!element.visible) return null;
            const nc = elementToNodeConfig(element, images);
            const interaction = {
              draggable: !element.locked,
              ref: (n: Konva.Node | null) => {
                if (n) nodeRefs.current.set(element.id, n);
                else nodeRefs.current.delete(element.id);
              },
              onClick: () => editorStore.getState().select(element.id),
              onTap: () => editorStore.getState().select(element.id),
              onDragEnd: onDragEnd(element.id),
              onTransformEnd: onTransformEnd(element.id),
            };
            switch (nc.konva) {
              case "Text":
                return (
                  <Text
                    key={element.id}
                    {...nc.config}
                    {...interaction}
                    onDblClick={() =>
                      setEditing({ id: element.id, value: nc.config.text ?? "" })
                    }
                  />
                );
              case "Image":
                return <KonvaImage key={element.id} {...nc.config} {...interaction} />;
              case "Group":
                return (
                  <Group key={element.id} {...nc.config} {...interaction}>
                    {nc.children.map((child, i) => renderNodeConfigChild(child, i))}
                  </Group>
                );
              case "Rect":
                return <Rect key={element.id} {...nc.config} {...interaction} />;
              default:
                return assertNever(nc);
            }
          })}
          <Transformer ref={trRef} rotateEnabled />
        </Layer>
      </Stage>

      {editing && (
        <textarea
          autoFocus
          value={editing.value}
          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
          onBlur={() => {
            commit(editing.id, { content: editing.value });
            setEditing(null);
          }}
          className="absolute left-0 top-0 z-10 border border-blue-500 p-1"
        />
      )}
    </div>
  );
}
