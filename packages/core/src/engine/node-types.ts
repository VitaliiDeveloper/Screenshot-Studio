// SPDX-License-Identifier: Apache-2.0
import type Konva from "konva";
import type { LayoutDirection } from "@screenshot-studio/core/model";

export type ImageCache = Map<string, HTMLImageElement>;

export interface ElementRenderContext {
  images?: ImageCache;
  direction?: LayoutDirection;
  zoom?: number; // Editor stage scale, which `strokeScaleEnabled: false` drops. Export leaves it unset.
}

export type NodeFilter = { kind: "blur"; radius: number };

export type NodeConfig =
  | { konva: "Text"; config: Konva.TextConfig }
  | { konva: "Rect"; config: Konva.RectConfig }
  | { konva: "Image"; config: Konva.ImageConfig; filter?: NodeFilter }
  | { konva: "Ellipse"; config: Konva.EllipseConfig }
  | { konva: "Path"; config: Konva.PathConfig }
  | { konva: "Group"; config: Konva.GroupConfig; children: NodeConfig[] };

export interface Box {
  width: number;
  height: number;
}
