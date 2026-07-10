// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Konva from "konva";
import { Stage, Layer, Text, Rect, Image as KonvaImage, Group, Line, Transformer } from "react-konva";
import { useStore } from "zustand";
import {
  assertNever,
  projectScreenGroup,
  type Element,
  type Screen,
} from "@screenshot-studio/core/model";
import { elementToNodeConfig, type NodeConfig } from "@screenshot-studio/core/engine";
import type { ImageCache } from "@screenshot-studio/core/assets";
import { editorStore, type ElementPatch } from "../lib/editor-store";
import { snapElementDrag, type SnapGuide } from "../lib/editor-snapping";
import { mutateAndSave } from "../lib/mutate-and-save";

/**
 * Interactive canvas over the same elementToNodeConfig map used by export. Isolated mode renders
 * one screen. Connected Overview renders one gapless group stage; owner offset Groups translate
 * screen-local element coordinates without changing persisted ownership or geometry. Connected
 * Focus uses the same projection with the active artboard as a non-interactive exact crop preview.
 */
function renderNodeConfigChild(child: NodeConfig, key: number, listening: boolean) {
  switch (child.konva) {
    case "Image":
      return <KonvaImage key={key} {...child.config} listening={listening} />;
    case "Rect":
      return <Rect key={key} {...child.config} listening={listening} />;
    case "Text":
    case "Group":
      return null;
    default:
      return assertNever(child);
  }
}

function selectionKey(screenId: string, elementId: string): string {
  return `${screenId}\u0000${elementId}`;
}

interface EditingText {
  screenId: string;
  id: string;
  value: string;
}

interface StageProjection {
  screen: Screen;
  x: number;
  y: number;
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
  const selectedId = useStore(editorStore, (state) => state.selectedId);
  const selectedScreenId = useStore(editorStore, (state) => state.selectedScreenId);
  const requestedScreenId = screenId ?? activeScreenId;
  const requestedScreen = requestedScreenId
    ? project?.screens.find((candidate) => candidate.id === requestedScreenId)
    : undefined;

  const trRef = useRef<Konva.Transformer>(null);
  const nodeRefs = useRef(new Map<string, Konva.Node>());
  const wrapperRef = useRef<HTMLDivElement>(null);
  const verticalGuideRef = useRef<Konva.Line>(null);
  const horizontalGuideRef = useRef<Konva.Line>(null);
  const [editing, setEditing] = useState<EditingText | null>(null);
  const endingEditRef = useRef(false);

  let projections: StageProjection[] = [];
  let baseX = 0;
  let stageWidth = requestedScreen?.artboard.width ?? 0;
  let stageHeight = requestedScreen?.artboard.height ?? 0;
  if (project && requestedScreen) {
    if (project.mode === "connected") {
      projections = projectScreenGroup(project, requestedScreen.id);
      const target = projections.find((entry) => entry.screen.id === requestedScreen.id)!;
      if (connectedOverview) {
        const last = projections.at(-1)!;
        stageWidth = last.x + last.screen.artboard.width;
        stageHeight = Math.max(...projections.map((entry) => entry.screen.artboard.height));
      } else {
        baseX = -target.x;
      }
    } else {
      projections = [{ screen: requestedScreen, x: 0, y: 0 }];
    }
  }

  const canEdit = Boolean(
    project
    && requestedScreen
    && interactive
    && (project.mode === "connected" ? connectedOverview : requestedScreen.id === activeScreenId),
  );
  const selectedProjection = selectedScreenId
    ? projections.find((entry) => entry.screen.id === selectedScreenId)
    : undefined;
  const selectedElement = canEdit && selectedId && selectedProjection
    ? selectedProjection.screen.elements.find((element) => element.id === selectedId)
    : undefined;
  const editingProjection = editing
    ? projections.find((entry) => entry.screen.id === editing.screenId)
    : undefined;
  const editingElement = editing && canEdit
    ? editingProjection?.screen.elements.find(
      (element) => element.id === editing.id && element.type === "text",
    )
    : undefined;

  useEffect(() => {
    const transformer = trRef.current;
    if (!transformer) return;
    const key = selectedId && selectedScreenId
      ? selectionKey(selectedScreenId, selectedId)
      : null;
    const node = canEdit && key && !editingElement ? nodeRefs.current.get(key) : undefined;
    transformer.nodes(node ? [node] : []);
    transformer.forceUpdate();
    transformer.getLayer()?.batchDraw();
  }, [canEdit, editingElement, project, selectedId, selectedScreenId]);

  if (!project || !requestedScreen || projections.length === 0) return null;

  const commit = (ownerScreenId: string, id: string, patch: ElementPatch) => {
    mutateAndSave(() => editorStore.getState().patchElement(id, patch, ownerScreenId));
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
    if (liveElement(ownerScreenId, id)?.locked) return;
    commit(ownerScreenId, id, { x: event.target.x(), y: event.target.y() });
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
    commit(ownerScreenId, id, {
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
    if (save && !liveElement(editing.screenId, editing.id)?.locked) {
      commit(editing.screenId, editing.id, { content: editing.value });
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
      style={{ position: "relative", width: stageWidth * zoom, height: stageHeight * zoom }}
    >
      <Stage
        width={stageWidth * zoom}
        height={stageHeight * zoom}
        scaleX={zoom}
        scaleY={zoom}
        style={{ pointerEvents: canEdit ? "auto" : "none" }}
        onMouseDown={(event) => {
          if (canEdit && event.target === event.target.getStage()) editorStore.getState().select(null);
        }}
      >
        <Layer>
          {projections.map(({ screen, x, y }) => screen.background.type === "solid" ? (
            <Rect
              key={`background-${screen.id}`}
              x={x + baseX}
              y={y}
              width={screen.artboard.width}
              height={screen.artboard.height}
              fill={screen.background.color}
              listening={canEdit}
              onClick={() => editorStore.getState().selectScreen(screen.id)}
              onTap={() => editorStore.getState().selectScreen(screen.id)}
            />
          ) : null)}

          {projections.map(({ screen, x, y }) => (
            <Group key={`owner-${screen.id}`} x={x + baseX} y={y}>
              {screen.elements.map((element) => {
                if (!element.visible) return null;
                const nc = elementToNodeConfig(element, { images, direction: screen.direction });
                const key = selectionKey(screen.id, element.id);
                const interaction = canEdit ? {
                  draggable: !element.locked,
                  ref: (node: Konva.Node | null) => {
                    if (node) nodeRefs.current.set(key, node);
                    else nodeRefs.current.delete(key);
                  },
                  onClick: () => editorStore.getState().select(element.id, screen.id),
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
                          editorStore.getState().select(element.id, screen.id);
                          if (event.evt.detail >= 2) {
                            beginTextEditing(screen.id, element, nc.config.text ?? "");
                          }
                        }}
                        onDblClick={() => beginTextEditing(screen.id, element, nc.config.text ?? "")}
                      />
                    );
                  case "Image":
                    return <KonvaImage key={element.id} {...nc.config} {...interaction} />;
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
              resizeEnabled={!selectedElement?.locked}
              rotateEnabled={!selectedElement?.locked}
            />
          ) : null}
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
