import Konva from "konva";
import type { Project, Screen, Element } from "../model/schema.js";
import type { ImageCache } from "./node-config.js";
import { getScreen } from "../model/index.js";
import { elementToNodeConfig } from "./node-config.js";

/**
 * The single rendering path (docs/architecture.md §2). Both the web /render route and the CLI
 * export (via a headless browser) call this exact code, so UI and CLI share one renderer — never
 * add a second. Runs in a browser: Konva draws onto a real `<canvas>`.
 *
 * z-order is array order in `screen.elements` (docs/architecture.md §3): later elements draw on
 * top. The layer is not clipped here because Phase 0 renders one isolated artboard at 1:1; the
 * isolated-artboard clip is an editor concern (editor.md §2), not an export concern.
 */
export function renderScreen(
  container: HTMLDivElement,
  project: Project,
  screenId: string,
  images: ImageCache,
): Konva.Stage {
  const screen = getScreen(project, screenId);
  const { width, height } = screen.artboard;

  const stage = new Konva.Stage({ container, width, height });
  const layer = new Konva.Layer({ listening: false });
  stage.add(layer);

  drawBackground(layer, screen);
  for (const element of screen.elements) {
    if (!element.visible) continue;
    drawElement(layer, element, images);
  }

  layer.draw();
  return stage;
}

function drawBackground(layer: Konva.Layer, screen: Screen): void {
  const { width, height } = screen.artboard;
  if (screen.background.type === "solid") {
    layer.add(new Konva.Rect({ x: 0, y: 0, width, height, fill: screen.background.color }));
  }
}

function drawElement(layer: Konva.Layer, element: Element, images: ImageCache): void {
  const { konva, config } = elementToNodeConfig(element, images);
  if (konva === "Text") layer.add(new Konva.Text(config));
  else if (konva === "Image") layer.add(new Konva.Image(config));
  else layer.add(new Konva.Rect(config));
}
