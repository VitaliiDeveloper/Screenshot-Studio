// SPDX-License-Identifier: Apache-2.0
import Konva from "konva";
import type { Project, Screen, Element, LayoutDirection } from "../model/schema.js";
import { assertNever } from "../model/assert-never.js";
import type { ImageCache, NodeConfig } from "./node-config.js";
import { getLayout, getScreen } from "../model/index.js";
import { projectScreenGroup } from "../model/connected-canvas.js";
import { backgroundToNodeConfig, elementToNodeConfig } from "./node-config.js";

/**
 * The single rendering path (docs/architecture.md). Both the web /render route and the CLI
 * export (via a headless browser) call this exact code, so UI and CLI share one renderer — never
 * add a second. Runs in a browser: Konva draws onto a real `<canvas>`.
 *
 * In isolated mode z-order is array order in `screen.elements`. In connected mode backgrounds for
 * the exact platform/device/locale group draw first, then elements flatten by screen order and each
 * screen's element-array order. The requested stage dimensions are the precise export crop.
 */
export function renderScreen(
  container: HTMLDivElement,
  project: Project,
  layoutId: string,
  screenId: string,
  images: ImageCache,
): Konva.Stage {
  const layout = getLayout(project, layoutId);
  const screen = getScreen(project, layoutId, screenId);
  const { width, height } = screen.artboard;

  const stage = new Konva.Stage({ container, width, height });
  const layer = new Konva.Layer({ listening: false });
  stage.add(layer);

  if (layout.mode === "connected") {
    const group = projectScreenGroup(project, layoutId, screenId);
    const target = group.find((entry) => entry.screen.id === screenId)!;
    for (const entry of group) {
      drawBackground(layer, entry.screen, entry.x - target.x, entry.y - target.y, images);
    }
    for (const entry of group) {
      const offset = { x: entry.x - target.x, y: entry.y - target.y };
      for (const element of entry.screen.elements) {
        if (!element.visible) continue;
        drawElement(layer, element, images, entry.screen.direction, offset);
      }
    }
  } else {
    drawBackground(layer, screen, 0, 0, images);
    for (const element of screen.elements) {
      if (!element.visible) continue;
      drawElement(layer, element, images, screen.direction);
    }
  }

  layer.draw();
  return stage;
}

function drawBackground(
  layer: Konva.Layer,
  screen: Screen,
  x: number,
  y: number,
  images: ImageCache,
): void {
  const { width, height } = screen.artboard;
  layer.add(buildNode(
    backgroundToNodeConfig(screen.background, { x, y, width, height }, images),
  ) as Konva.Group | Konva.Shape);
}

function drawElement(
  layer: Konva.Layer,
  element: Element,
  images: ImageCache,
  direction: LayoutDirection,
  offset?: { x: number; y: number },
): void {
  const node = buildNode(elementToNodeConfig(element, { images, direction })) as Konva.Group | Konva.Shape;
  if (!offset || (offset.x === 0 && offset.y === 0)) {
    layer.add(node);
    return;
  }
  const owner = new Konva.Group({ x: offset.x, y: offset.y, listening: false });
  owner.add(node);
  layer.add(owner);
}

/** Realise a NodeConfig as Konva nodes, recursing into composite screenshot/device-frame Groups. */
function buildNode(nc: NodeConfig): Konva.Node {
  switch (nc.konva) {
    case "Text":
      return new Konva.Text(nc.config);
    case "Image":
      return new Konva.Image(nc.config);
    case "Ellipse":
      return new Konva.Ellipse(nc.config);
    case "Path":
      return new Konva.Path(nc.config);
    case "Rect":
      return new Konva.Rect(nc.config);
    case "Group": {
      const group = new Konva.Group(nc.config);
      for (const child of nc.children) group.add(buildNode(child) as Konva.Group | Konva.Shape);
      return group;
    }
    default:
      return assertNever(nc);
  }
}
