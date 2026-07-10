"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Konva from "konva";
import { Stage, Layer, Text, Rect, Image as KonvaImage, Group, Transformer } from "react-konva";
import { useStore } from "zustand";
import { assertNever, type Element } from "@screenshot-studio/core/model";
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
function renderNodeConfigChild(child: NodeConfig, key: number, listening: boolean) {
  switch (child.konva) {
    case "Image":
      return <KonvaImage key={key} {...child.config} listening={listening} />;
    case "Rect":
      return <Rect key={key} {...child.config} listening={listening} />;
    case "Text":
    case "Group":
      // Screenshot/device-frame groups only contain Rect/Image today; keep exhaustive for future groups.
      return null;
    default:
      return assertNever(child);
  }
}

export function EditorStage({
  images,
  zoom = 1,
  screenId,
  interactive = true,
}: {
  images: ImageCache;
  zoom?: number;
  screenId?: string;
  interactive?: boolean;
}) {
  const activeScreenId = useStore(editorStore, (s) => s.activeScreenId);
  const selectedId = useStore(editorStore, (s) => s.selectedId);
  const screen = useStore(editorStore, (state) => {
    const id = screenId ?? state.activeScreenId;
    return id ? state.project?.screens.find((candidate) => candidate.id === id) : undefined;
  });

  const trRef = useRef<Konva.Transformer>(null);
  const nodeRefs = useRef(new Map<string, Konva.Node>());
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const endingEditRef = useRef(false);

  const canEdit = Boolean(screen && interactive && screen.id === activeScreenId);
  const selectedElement = canEdit && selectedId
    ? screen?.elements.find((element) => element.id === selectedId)
    : undefined;
  const editingElement = editing && canEdit
    ? screen?.elements.find((element) => element.id === editing.id && element.type === "text")
    : undefined;

  // Keep the Transformer attached to whatever node is selected.
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = canEdit && selectedId && !editingElement ? nodeRefs.current.get(selectedId) : undefined;
    tr.nodes(node ? [node] : []);
    tr.forceUpdate();
    tr.getLayer()?.batchDraw();
  }, [canEdit, editingElement, screen, selectedId]);

  if (!screen) return null;
  const { width, height } = screen.artboard;

  const commit = (id: string, patch: ElementPatch) => {
    mutateAndSave(() => editorStore.getState().patchElement(id, patch));
  };

  const liveElement = (id: string): Element | undefined => {
    const state = editorStore.getState();
    const active = state.project?.screens.find((candidate) => candidate.id === state.activeScreenId);
    return active?.elements.find((element) => element.id === id);
  };

  const onDragEnd = (id: string) => (e: Konva.KonvaEventObject<DragEvent>) => {
    if (liveElement(id)?.locked) return;
    commit(id, { x: e.target.x(), y: e.target.y() });
  };

  // Konva applies scale on transform; bake it into width/height and reset scale to 1.
  const onTransformEnd = (id: string) => (e: Konva.KonvaEventObject<Event>) => {
    const node = e.target;
    const element = liveElement(id);
    if (!element || element.locked) {
      node.position({ x: element?.x ?? node.x(), y: element?.y ?? node.y() });
      node.rotation(element?.rotation ?? node.rotation());
      node.width(element?.width ?? node.width());
      node.height(element?.height ?? node.height());
      node.scale({ x: 1, y: 1 });
      trRef.current?.forceUpdate();
      node.getLayer()?.batchDraw();
      return;
    }
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

  const finishEditing = (save: boolean) => {
    if (!editing || endingEditRef.current) return;
    endingEditRef.current = true;
    if (save && !liveElement(editing.id)?.locked) commit(editing.id, { content: editing.value });
    setEditing(null);
    queueMicrotask(() => { endingEditRef.current = false; });
  };

  const beginTextEditing = (element: Extract<Element, { type: "text" }>, value: string) => {
    if (!canEdit || element.locked) return;
    endingEditRef.current = false;
    editorStore.getState().select(element.id);
    setEditing({ id: element.id, value });
  };

  const editingStyle: CSSProperties | undefined = editingElement?.type === "text" ? {
    left: editingElement.x * zoom,
    top: editingElement.y * zoom,
    width: editingElement.width * zoom,
    height: editingElement.height * zoom,
    transform: `rotate(${editingElement.rotation}deg)`,
    transformOrigin: "top left",
    fontFamily: `"${editingElement.fontFamily}"`,
    fontSize: editingElement.size * zoom,
    fontWeight: editingElement.weight,
    lineHeight: editingElement.lineHeight,
    letterSpacing: editingElement.letterSpacing * zoom,
    textAlign: editingElement.align,
    color: editingElement.color,
    opacity: editingElement.opacity,
  } : undefined;

  return (
    <div style={{ position: "relative", width: width * zoom, height: height * zoom }}>
      <Stage
        width={width * zoom}
        height={height * zoom}
        scaleX={zoom}
        scaleY={zoom}
        style={{ pointerEvents: canEdit ? "auto" : "none" }}
        onMouseDown={(e) => {
          // Click on empty stage clears the selection.
          if (canEdit && e.target === e.target.getStage()) editorStore.getState().select(null);
        }}
      >
        <Layer>
          {screen.background.type === "solid" && (
            <Rect x={0} y={0} width={width} height={height} fill={screen.background.color} listening={false} />
          )}
          {screen.elements.map((element) => {
            if (!element.visible) return null;
            const nc = elementToNodeConfig(element, images);
            const interaction = canEdit ? {
              draggable: !element.locked,
              ref: (n: Konva.Node | null) => {
                if (n) nodeRefs.current.set(element.id, n);
                else nodeRefs.current.delete(element.id);
              },
              onClick: () => editorStore.getState().select(element.id),
              onTap: () => editorStore.getState().select(element.id),
              onDragEnd: onDragEnd(element.id),
              onTransformEnd: onTransformEnd(element.id),
            } : { listening: false };
            switch (nc.konva) {
              case "Text": {
                if (element.type !== "text") return null;
                return (
                  <Text
                    key={element.id}
                    {...nc.config}
                    {...interaction}
                    visible={editing?.id !== element.id}
                    onClick={(event) => {
                      editorStore.getState().select(element.id);
                      if (event.evt.detail >= 2) beginTextEditing(element, nc.config.text ?? "");
                    }}
                    onDblClick={() => beginTextEditing(element, nc.config.text ?? "")}
                  />
                );
              }
              case "Image":
                return <KonvaImage key={element.id} {...nc.config} {...interaction} />;
              case "Group":
                return (
                  <Group key={element.id} {...nc.config} {...interaction}>
                    {/* Groups have no hit shape of their own; listening children bubble selection to the Group. */}
                    {nc.children.map((child, i) => renderNodeConfigChild(child, i, canEdit))}
                  </Group>
                );
              case "Rect":
                return <Rect key={element.id} {...nc.config} {...interaction} />;
              default:
                return assertNever(nc);
            }
          })}
          {canEdit ? (
            <Transformer
              ref={trRef}
              resizeEnabled={!selectedElement?.locked}
              rotateEnabled={!selectedElement?.locked}
            />
          ) : null}
        </Layer>
      </Stage>

      {canEdit && editing && editingElement?.type === "text" && (
        <textarea
          autoFocus
          aria-label={`Edit ${editingElement.name ?? "text"}`}
          value={editing.value}
          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
          onBlur={() => finishEditing(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              finishEditing(false);
            } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              finishEditing(true);
            }
          }}
          spellCheck={false}
          style={editingStyle}
          className="absolute z-10 resize-none overflow-hidden border border-blue-500 bg-transparent p-0 outline-none ring-2 ring-blue-500/20"
        />
      )}
    </div>
  );
}
