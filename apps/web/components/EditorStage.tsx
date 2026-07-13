// SPDX-License-Identifier: Apache-2.0
"use client";

import { useRef, useState, type CSSProperties, type Key } from "react";
import Konva from "konva";
import { Stage, Layer, Text, Rect, Ellipse, Image as KonvaImage, Group, Line, Path, Transformer } from "react-konva";
import { useStore } from "zustand";
import {
  assertNever,
  rotatedElementBounds,
  type Element,
} from "@screenshot-studio/core/model";
import { backgroundToNodeConfig, elementToNodeConfig, type NodeConfig } from "@screenshot-studio/core/engine";
import type { ImageCache } from "@screenshot-studio/core/assets";
import { editorStore, type CommonElementPatch } from "../lib/editor-store";
import { boundsIntersect, isSelected, toggleSelection, type SelectionRef } from "../lib/editor-selection";
import { snapElementDrag, type SnapGuide } from "../lib/editor-snapping";
import { mutateAndSave } from "../lib/mutate-and-save";
import { deriveStageModel, type StageEditingText } from "./editor-stage/stage-model";
import { nodeSelectionKey, useTransformerSelection } from "./editor-stage/use-transformer-selection";

/**
 * Interactive canvas over the same elementToNodeConfig map used by export. Isolated mode renders
 * one screen. Connected Overview renders one gapless group stage; owner offset Groups translate
 * screen-local element coordinates without changing persisted ownership or geometry. Connected
 * Focus uses the same projection with the active artboard as a non-interactive exact crop preview.
 */
function renderNodeConfigChild(child: NodeConfig, key: Key, listening: boolean, name?: string) {
  switch (child.konva) {
    case "Image":
      return <KonvaImage key={key} {...child.config} name={name} listening={listening} />;
    case "Ellipse":
      return <Ellipse key={key} {...child.config} name={name} listening={listening} />;
    case "Path":
      return <Path key={key} {...child.config} name={name} listening={listening} />;
    case "Rect":
      return <Rect key={key} {...child.config} name={name} listening={listening} />;
    case "Text":
      return <Text key={key} {...child.config} name={name} listening={listening} />;
    case "Group":
      return (
        <Group key={key} {...child.config} name={name} listening={listening}>
          {child.children.map((nested, index) => renderNodeConfigChild(nested, index, listening, name))}
        </Group>
      );
    default:
      return assertNever(child);
  }
}

interface MarqueeState {
  start: { x: number; y: number };
  current: { x: number; y: number };
  initial: SelectionRef[];
  toggle: boolean;
}

export function EditorStage({
  images,
  zoom = 1,
  screenId,
  interactive = true,
  connectedOverview = false,
}: {
  images: ImageCache;
  zoom?: number;
  screenId?: string;
  interactive?: boolean;
  connectedOverview?: boolean;
}) {
  const project = useStore(editorStore, (state) => state.project);
  const activeScreenId = useStore(editorStore, (state) => state.activeScreenId);
  const selectedItems = useStore(editorStore, (state) => state.selectedItems);
  const requestedScreenId = screenId ?? activeScreenId;

  const trRef = useRef<Konva.Transformer>(null);
  const nodeRefs = useRef(new Map<string, Konva.Node>());
  const wrapperRef = useRef<HTMLDivElement>(null);
  const verticalGuideRef = useRef<Konva.Line>(null);
  const horizontalGuideRef = useRef<Konva.Line>(null);
  const marqueeMovedRef = useRef(false);
  const [editing, setEditing] = useState<StageEditingText | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const endingEditRef = useRef(false);

  const {
    requestedScreen,
    projections,
    baseX,
    stageWidth,
    stageHeight,
    canEdit,
    selectedElement,
    editingProjection,
    editingElement,
  } = deriveStageModel({
    project,
    requestedScreenId,
    activeScreenId,
    selectedItems,
    editing,
    interactive,
    connectedOverview,
  });

  useTransformerSelection({
    transformerRef: trRef,
    nodeRefs,
    canEdit,
    editingText: Boolean(editingElement),
    project,
    selectedItems,
  });

  if (!project || !requestedScreen || projections.length === 0) return null;

  const commit = (ownerScreenId: string, element: Element, patch: CommonElementPatch) => {
    mutateAndSave(() => editorStore.getState().patchElement({
      id: element.id,
      type: element.type,
      patch,
      screenId: ownerScreenId,
    }));
  };

  const liveElement = (ownerScreenId: string, id: string): Element | undefined => {
    const state = editorStore.getState();
    return state.project?.screens
      .find((candidate) => candidate.id === ownerScreenId)
      ?.elements.find((element) => element.id === id);
  };

  const showSnapGuides = (guides: readonly SnapGuide[]) => {
    const vertical = guides.find((guide) => guide.axis === "x");
    const horizontal = guides.find((guide) => guide.axis === "y");
    const verticalNode = verticalGuideRef.current;
    const horizontalNode = horizontalGuideRef.current;
    if (verticalNode) {
      verticalNode.points([vertical?.position ?? 0, 0, vertical?.position ?? 0, stageHeight]);
      verticalNode.visible(Boolean(vertical));
    }
    if (horizontalNode) {
      horizontalNode.points([0, horizontal?.position ?? 0, stageWidth, horizontal?.position ?? 0]);
      horizontalNode.visible(Boolean(horizontal));
    }
    const wrapper = wrapperRef.current;
    if (wrapper) {
      if (vertical) wrapper.dataset.snapGuideX = String(vertical.position);
      else delete wrapper.dataset.snapGuideX;
      if (horizontal) wrapper.dataset.snapGuideY = String(horizontal.position);
      else delete wrapper.dataset.snapGuideY;
    }
    verticalNode?.getLayer()?.batchDraw();
  };

  const clearSnapGuides = () => showSnapGuides([]);

  const onDragMove = (ownerScreenId: string, id: string) => (
    event: Konva.KonvaEventObject<DragEvent>,
  ) => {
    const element = liveElement(ownerScreenId, id);
    if (!element || element.locked) return;
    const candidate = { screenId: ownerScreenId, elementId: id };
    if (selectedItems.length > 1 && isSelected(selectedItems, candidate)) {
      clearSnapGuides();
      const delta = { x: event.target.x() - element.x, y: event.target.y() - element.y };
      for (const selection of selectedItems) {
        if (selection.screenId === ownerScreenId && selection.elementId === id) continue;
        const selected = liveElement(selection.screenId, selection.elementId);
        const node = nodeRefs.current.get(nodeSelectionKey(selection.screenId, selection.elementId));
        if (selected && node && !selected.locked) node.position({ x: selected.x + delta.x, y: selected.y + delta.y });
      }
      event.target.getLayer()?.batchDraw();
      return;
    }
    const result = snapElementDrag({
      element,
      ownerScreenId,
      position: { x: event.target.x(), y: event.target.y() },
      projections,
      stage: { width: stageWidth, height: stageHeight },
      zoom,
    });
    event.target.position(result.position);
    showSnapGuides(result.guides);
  };

  const onDragEnd = (ownerScreenId: string, id: string) => (
    event: Konva.KonvaEventObject<DragEvent>,
  ) => {
    clearSnapGuides();
    const element = liveElement(ownerScreenId, id);
    if (!element || element.locked) return;
    if (selectedItems.length > 1 && isSelected(selectedItems, { screenId: ownerScreenId, elementId: id })) {
      const delta = { x: event.target.x() - element.x, y: event.target.y() - element.y };
      mutateAndSave(() => editorStore.getState().moveSelected(delta));
      return;
    }
    commit(ownerScreenId, element, { x: event.target.x(), y: event.target.y() });
  };

  const onTransformEnd = (ownerScreenId: string, id: string) => (
    event: Konva.KonvaEventObject<Event>,
  ) => {
    clearSnapGuides();
    const node = event.target;
    const element = liveElement(ownerScreenId, id);
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
    node.scale({ x: 1, y: 1 });
    const dimensions = element.type === "group"
      ? (() => {
          const scale = Math.max(
            5 / element.width,
            5 / element.height,
            (Math.abs(scaleX) + Math.abs(scaleY)) / 2,
          );
          return { width: element.width * scale, height: element.height * scale };
        })()
      : {
          width: Math.max(5, node.width() * scaleX),
          height: Math.max(5, node.height() * scaleY),
        };
    commit(ownerScreenId, element, {
      x: node.x(),
      y: node.y(),
      rotation: node.rotation(),
      ...dimensions,
    });
  };

  const finishEditing = (save: boolean) => {
    if (!editing || endingEditRef.current) return;
    endingEditRef.current = true;
    if (save && !liveElement(editing.screenId, editing.id)?.locked) {
      mutateAndSave(() => editorStore.getState().patchElement({
        id: editing.id,
        type: "text",
        patch: { content: editing.value },
        screenId: editing.screenId,
      }));
    }
    setEditing(null);
    queueMicrotask(() => { endingEditRef.current = false; });
  };

  const beginTextEditing = (
    ownerScreenId: string,
    element: Extract<Element, { type: "text" }>,
    value: string,
  ) => {
    if (!canEdit || element.locked) return;
    endingEditRef.current = false;
    editorStore.getState().select(element.id, ownerScreenId);
    setEditing({ screenId: ownerScreenId, id: element.id, value });
  };

  const selectionModifier = (event: Konva.KonvaEventObject<Event>) => {
    const native = event.evt as MouseEvent;
    return native.shiftKey || native.metaKey || native.ctrlKey;
  };

  const selectElement = (event: Konva.KonvaEventObject<Event>, screenId: string, elementId: string) => {
    const candidate = { screenId, elementId };
    if (!selectionModifier(event) && selectedItems.length > 1 && isSelected(selectedItems, candidate)) {
      return;
    }
    editorStore.getState().select(
      elementId,
      screenId,
      selectionModifier(event) ? "toggle" : "replace",
    );
  };

  const finishElementClick = (
    event: Konva.KonvaEventObject<Event>,
    screenId: string,
    elementId: string,
  ) => {
    if (selectionModifier(event)) return;
    const state = editorStore.getState();
    const candidate = { screenId, elementId };
    if (state.selectedItems.length > 1 && isSelected(state.selectedItems, candidate)) {
      state.select(elementId, screenId, "replace");
    }
  };

  const pointerPosition = (stage: Konva.Stage) => {
    const point = stage.getPointerPosition();
    return point ? { x: point.x / zoom, y: point.y / zoom } : null;
  };

  const marqueeBounds = (value: MarqueeState) => ({
    minX: Math.min(value.start.x, value.current.x),
    minY: Math.min(value.start.y, value.current.y),
    maxX: Math.max(value.start.x, value.current.x),
    maxY: Math.max(value.start.y, value.current.y),
  });

  const marqueeHasMoved = (value: MarqueeState) =>
    Math.hypot(value.current.x - value.start.x, value.current.y - value.start.y) >= 3 / zoom;

  const beginMarquee = (event: Konva.KonvaEventObject<MouseEvent>) => {
    if (!canEdit) return;
    const stage = event.target.getStage();
    const blank = event.target === stage || event.target.name() === "artboard-background";
    if (!stage || !blank) return;
    const point = pointerPosition(stage);
    if (!point) return;
    marqueeMovedRef.current = false;
    setMarquee({
      start: point,
      current: point,
      initial: [...selectedItems],
      toggle: selectionModifier(event),
    });
  };

  const updateMarquee = (event: Konva.KonvaEventObject<MouseEvent>) => {
    if (!marquee) return;
    const stage = event.target.getStage();
    if (!stage) return;
    const point = pointerPosition(stage);
    if (!point) return;
    const moved = marqueeHasMoved({ ...marquee, current: point });
    if (moved) marqueeMovedRef.current = true;
    setMarquee({ ...marquee, current: point });
  };

  const finishMarquee = () => {
    if (!marquee) return;
    if (marqueeMovedRef.current) {
      const area = marqueeBounds(marquee);
      const hits: SelectionRef[] = [];
      for (const projection of projections) {
        for (const element of projection.screen.elements) {
          if (!element.visible) continue;
          const local = rotatedElementBounds(element);
          const bounds = {
            minX: local.minX + projection.x + baseX,
            minY: local.minY + projection.y,
            maxX: local.maxX + projection.x + baseX,
            maxY: local.maxY + projection.y,
          };
          if (boundsIntersect(area, bounds)) {
            hits.push({ screenId: projection.screen.id, elementId: element.id });
          }
        }
      }
      const next = marquee.toggle
        ? hits.reduce((items, hit) => toggleSelection(items, hit), marquee.initial)
        : hits;
      editorStore.getState().setSelection(next);
    }
    setMarquee(null);
    window.setTimeout(() => { marqueeMovedRef.current = false; }, 0);
  };

  const editingStyle: CSSProperties | undefined = editingElement?.type === "text" && editingProjection
    ? {
      left: (editingProjection.x + baseX + editingElement.x) * zoom,
      top: (editingProjection.y + editingElement.y) * zoom,
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
      direction: editingProjection.screen.direction,
      color: editingElement.color,
      opacity: editingElement.opacity,
    }
    : undefined;

  return (
    <div
      ref={wrapperRef}
      data-testid="editor-stage"
      data-active-screen-id={activeScreenId ?? undefined}
      data-stage-screen-ids={projections.map((projection) => projection.screen.id).join(" ")}
      data-selection-count={selectedItems.length}
      style={{ position: "relative", width: stageWidth * zoom, height: stageHeight * zoom }}
    >
      <Stage
        width={stageWidth * zoom}
        height={stageHeight * zoom}
        scaleX={zoom}
        scaleY={zoom}
        style={{ pointerEvents: canEdit ? "auto" : "none" }}
        onMouseDown={beginMarquee}
        onMouseMove={updateMarquee}
        onMouseUp={finishMarquee}
      >
        <Layer>
          {projections.map(({ screen, x, y }) => (
            <Group
              key={`background-${screen.id}`}
              listening={canEdit}
              onClick={(event) => {
                if (marqueeMovedRef.current || selectionModifier(event)) return;
                editorStore.getState().selectScreen(screen.id);
              }}
              onTap={() => editorStore.getState().selectScreen(screen.id)}
            >
              {renderNodeConfigChild(
                backgroundToNodeConfig(screen.background, {
                  x: x + baseX,
                  y,
                  width: screen.artboard.width,
                  height: screen.artboard.height,
                }, images),
                screen.id,
                canEdit,
                "artboard-background",
              )}
            </Group>
          ))}

          {projections.map(({ screen, x, y }) => (
            <Group key={`owner-${screen.id}`} x={x + baseX} y={y}>
              {screen.elements.map((element) => {
                if (!element.visible) return null;
                const nc = elementToNodeConfig(element, { images, direction: screen.direction });
                const key = nodeSelectionKey(screen.id, element.id);
                const interaction = canEdit ? {
                  draggable: !element.locked,
                  ref: (node: Konva.Node | null) => {
                    if (node) nodeRefs.current.set(key, node);
                    else nodeRefs.current.delete(key);
                  },
                  onMouseDown: (event: Konva.KonvaEventObject<MouseEvent>) => {
                    selectElement(event, screen.id, element.id);
                  },
                  onClick: (event: Konva.KonvaEventObject<MouseEvent>) => {
                    finishElementClick(event, screen.id, element.id);
                  },
                  onTap: () => editorStore.getState().select(element.id, screen.id),
                  onDragMove: onDragMove(screen.id, element.id),
                  onDragEnd: onDragEnd(screen.id, element.id),
                  onTransformEnd: onTransformEnd(screen.id, element.id),
                } : { listening: false };
                switch (nc.konva) {
                  case "Text":
                    if (element.type !== "text") return null;
                    return (
                      <Text
                        key={element.id}
                        {...nc.config}
                        {...interaction}
                        visible={!(editing?.screenId === screen.id && editing.id === element.id)}
                        onClick={(event) => {
                          finishElementClick(event, screen.id, element.id);
                          if (event.evt.detail >= 2) {
                            beginTextEditing(screen.id, element, nc.config.text ?? "");
                          }
                        }}
                        onDblClick={() => beginTextEditing(screen.id, element, nc.config.text ?? "")}
                      />
                    );
                  case "Image":
                    return <KonvaImage key={element.id} {...nc.config} {...interaction} />;
                  case "Ellipse":
                    return <Ellipse key={element.id} {...nc.config} {...interaction} />;
                  case "Path":
                    return <Path key={element.id} {...nc.config} {...interaction} />;
                  case "Group":
                    return (
                      <Group key={element.id} {...nc.config} {...interaction}>
                        {nc.children.map((child, index) => renderNodeConfigChild(child, index, canEdit))}
                      </Group>
                    );
                  case "Rect":
                    return <Rect key={element.id} {...nc.config} {...interaction} />;
                  default:
                    return assertNever(nc);
                }
              })}
            </Group>
          ))}

          {project.mode === "connected" && connectedOverview
            ? projections.map(({ screen, x, y }) => (
              <Rect
                key={`boundary-${screen.id}`}
                x={x}
                y={y}
                width={screen.artboard.width}
                height={screen.artboard.height}
                stroke={screen.id === activeScreenId ? "#2563EB" : "#94A3B8"}
                strokeWidth={(screen.id === activeScreenId ? 2 : 1) / zoom}
                listening={false}
              />
            ))
            : null}

          {canEdit ? (
            <>
              <Line
                ref={verticalGuideRef}
                visible={false}
                listening={false}
                stroke="#EC4899"
                strokeWidth={1 / zoom}
                dash={[6 / zoom, 4 / zoom]}
              />
              <Line
                ref={horizontalGuideRef}
                visible={false}
                listening={false}
                stroke="#EC4899"
                strokeWidth={1 / zoom}
                dash={[6 / zoom, 4 / zoom]}
              />
            </>
          ) : null}

          {canEdit ? (
            <Transformer
              ref={trRef}
              resizeEnabled={selectedItems.length === 1 && !selectedElement?.locked}
              rotateEnabled={selectedItems.length === 1 && !selectedElement?.locked}
              keepRatio={selectedElement?.type === "group"}
              flipEnabled={selectedElement?.type !== "group"}
              enabledAnchors={selectedElement?.type === "group"
                ? ["top-left", "top-right", "bottom-left", "bottom-right"]
                : undefined}
            />
          ) : null}

          {canEdit && marquee && marqueeHasMoved(marquee) ? (() => {
            const bounds = marqueeBounds(marquee);
            return (
              <Rect
                data-testid="selection-marquee"
                x={bounds.minX}
                y={bounds.minY}
                width={bounds.maxX - bounds.minX}
                height={bounds.maxY - bounds.minY}
                fill="rgba(37, 99, 235, 0.12)"
                stroke="#2563EB"
                strokeWidth={1 / zoom}
                dash={[5 / zoom, 3 / zoom]}
                listening={false}
              />
            );
          })() : null}
        </Layer>
      </Stage>

      {canEdit && editing && editingElement?.type === "text" && editingProjection ? (
        <textarea
          autoFocus
          dir={editingProjection.screen.direction}
          aria-label={`Edit ${editingElement.name ?? "text"}`}
          value={editing.value}
          onChange={(event) => setEditing({ ...editing, value: event.target.value })}
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
      ) : null}
    </div>
  );
}
