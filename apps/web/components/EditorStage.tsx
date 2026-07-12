// SPDX-License-Identifier: Apache-2.0
"use client";

import { useRef, type Key } from "react";
import Konva from "konva";
import { Stage, Layer, Text, Rect, Ellipse, Image as KonvaImage, Group, Line, Path, Transformer } from "react-konva";
import { useStore } from "zustand";
import {
  assertNever,
  type Element,
} from "@screenshot-studio/core/model";
import { backgroundToNodeConfig, elementToNodeConfig, type NodeConfig } from "@screenshot-studio/core/engine";
import type { ImageCache } from "@screenshot-studio/core/assets";
import { editorStore, type CommonElementPatch } from "../lib/editor-store";
import { isSelected } from "../lib/editor-selection";
import { mutateAndSave } from "../lib/mutate-and-save";
import { deriveStageModel } from "./editor-stage/stage-model";
import { useElementTransform } from "./editor-stage/use-element-transform";
import { useInlineTextEditing } from "./editor-stage/use-inline-text-editing";
import { useMarqueeSelection } from "./editor-stage/use-marquee-selection";
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

  const {
    requestedScreen,
    projections,
    baseX,
    stageWidth,
    stageHeight,
    canEdit,
    selectedElement,
  } = deriveStageModel({
    project,
    requestedScreenId,
    activeScreenId,
    selectedItems,
    interactive,
    connectedOverview,
  });

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

  const {
    verticalGuideRef,
    horizontalGuideRef,
    onDragMove,
    onDragEnd,
    onTransformEnd,
  } = useElementTransform({
    projections,
    selectedItems,
    zoom,
    stageSize: { width: stageWidth, height: stageHeight },
    nodeRefs,
    transformerRef: trRef,
    wrapperRef,
    getLiveElement: liveElement,
    patchElement: commit,
    moveSelected: (delta) => mutateAndSave(() => editorStore.getState().moveSelected(delta)),
  });

  const {
    marquee,
    movedRef: marqueeMovedRef,
    selectionModifier,
    hasMoved: marqueeHasMoved,
    bounds: currentMarqueeBounds,
    onMouseDown: beginMarquee,
    onMouseMove: updateMarquee,
    onMouseUp: finishMarquee,
  } = useMarqueeSelection({
    canEdit,
    zoom,
    projections,
    baseX,
    selectedItems,
    setSelection: (items) => editorStore.getState().setSelection(items),
  });

  const {
    editing,
    editingProjection,
    editingElement,
    style: editingStyle,
    beginTextEditing,
    finishEditing,
    setValue: setEditingValue,
  } = useInlineTextEditing({
    projections,
    baseX,
    zoom,
    canEdit,
    getLiveElement: liveElement,
    selectElement: (screen, element) => editorStore.getState().select(element, screen),
    commitText: (screen, element, value) => mutateAndSave(() => editorStore.getState().patchElement({
      id: element,
      type: "text",
      patch: { content: value },
      screenId: screen,
    })),
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

          {canEdit && marquee && marqueeHasMoved(marquee) && currentMarqueeBounds ? (() => {
            const bounds = currentMarqueeBounds;
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
          onChange={(event) => setEditingValue(event.target.value)}
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
