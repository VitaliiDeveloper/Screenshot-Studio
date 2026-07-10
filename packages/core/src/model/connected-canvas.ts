// SPDX-License-Identifier: Apache-2.0
import {
  Project as ProjectSchema,
  type CanvasMode,
  type Element,
  type Project,
  type Screen,
} from "./schema.js";

/** One screen projected into its exact platform/device/locale strip. */
export interface ProjectedScreen {
  screen: Screen;
  x: number;
  y: 0;
}

export function sameScreenGroup(first: Screen, second: Screen): boolean {
  return first.platform === second.platform
    && first.device === second.device
    && first.locale === second.locale;
}

/**
 * Project an exact export group into a gapless, top-aligned horizontal strip in project order.
 * Screen/element storage remains unchanged; this is the single connected-coordinate derivation.
 */
export function projectScreenGroup(project: Project, screenId: string): ProjectedScreen[] {
  const target = project.screens.find((screen) => screen.id === screenId);
  if (!target) throw new Error(`Screen "${screenId}" not found`);

  let x = 0;
  return project.screens
    .filter((screen) => sameScreenGroup(screen, target))
    .map((screen) => {
      const projected = { screen, x, y: 0 as const };
      x += screen.artboard.width;
      return projected;
    });
}

export interface ElementBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface OwnerOverflow {
  screenId: string;
  elementId: string;
  bounds: ElementBounds;
}

/** Axis-aligned bounds for Konva's default top-left rotation origin. */
export function rotatedElementBounds(element: Element): ElementBounds {
  const radians = element.rotation * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const corners = [
    [0, 0],
    [element.width, 0],
    [0, element.height],
    [element.width, element.height],
  ] as const;
  const points = corners.map(([x, y]) => ({
    x: element.x + x * cos - y * sin,
    y: element.y + x * sin + y * cos,
  }));
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

interface Point {
  x: number;
  y: number;
}

function leafCorners(element: Exclude<Element, { type: "group" }>): Point[] {
  const radians = element.rotation * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    [0, 0],
    [element.width, 0],
    [0, element.height],
    [element.width, element.height],
  ].map(([x, y]) => ({
    x: element.x + x! * cos - y! * sin,
    y: element.y + x! * sin + y! * cos,
  }));
}

/** Pixel-bearing bounds, including persisted group transforms and visible child overflow. */
export function renderedElementBounds(element: Element): ElementBounds | null {
  if (!element.visible || element.opacity === 0) return null;
  const points = element.type === "group"
    ? element.children
      .filter((child) => child.visible && child.opacity !== 0)
      .flatMap((child) => leafCorners(child))
      .map((point) => {
        const radians = element.rotation * Math.PI / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        return {
          x: element.x + point.x * cos - point.y * sin,
          y: element.y + point.x * sin + point.y * cos,
        };
      })
    : leafCorners(element);
  if (points.length === 0) return null;
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

export function findOwnerOverflows(project: Project): OwnerOverflow[] {
  const epsilon = 1e-9;
  const overflows: OwnerOverflow[] = [];
  for (const screen of project.screens) {
    for (const element of screen.elements) {
      const bounds = renderedElementBounds(element);
      if (!bounds) continue;
      if (
        bounds.minX < -epsilon
        || bounds.minY < -epsilon
        || bounds.maxX > screen.artboard.width + epsilon
        || bounds.maxY > screen.artboard.height + epsilon
      ) {
        overflows.push({ screenId: screen.id, elementId: element.id, bounds });
      }
    }
  }
  return overflows;
}

/** Explicit, loss-aware canvas-mode transition; never clips connected pixels silently. */
export function setCanvasMode(project: Project, mode: CanvasMode): Project {
  if (project.mode === mode) return project;
  if (mode === "isolated") {
    const overflows = findOwnerOverflows(project);
    if (overflows.length > 0) {
      const first = overflows[0]!;
      const suffix = overflows.length === 1 ? "" : ` and ${overflows.length - 1} more`;
      throw new Error(
        `Cannot switch to isolated mode: element "${first.elementId}" on screen "${first.screenId}" crosses its owner artboard${suffix}`,
      );
    }
  }
  return ProjectSchema.parse({ ...project, mode });
}
