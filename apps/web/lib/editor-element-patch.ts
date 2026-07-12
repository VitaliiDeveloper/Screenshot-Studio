// SPDX-License-Identifier: Apache-2.0
import {
  resizeGroupUniform,
  type DeviceFrameElement,
  type Element,
  type IconElement,
  type ImageElement,
  type LinearGradientPaint,
  type MediaCrop,
  type ScreenshotElement,
  type ShapeElement,
  type ShapeStroke,
  type TextElement,
  type TextShadow,
  type ThemeRole,
} from "@screenshot-studio/core/model";

export type CommonElementPatch = Partial<
  Pick<Element, "x" | "y" | "width" | "height" | "rotation" | "opacity" | "locked" | "visible" | "name">
>;

type RolePatch = { role?: ThemeRole | null };
type TextPatch = Partial<
  Pick<
    TextElement,
    "content" | "fontFamily" | "size" | "weight" | "lineHeight" | "letterSpacing" | "align" | "color"
  >
> & { shadow?: TextShadow | null };
type ShapePatch = Partial<Pick<ShapeElement, "kind" | "fill" | "radius">> & {
  gradient?: LinearGradientPaint | null;
  stroke?: ShapeStroke | null;
};
type ScreenshotPatch = Partial<Pick<ScreenshotElement, "assetUrl" | "fit" | "cornerRadius">> & {
  crop?: MediaCrop | null;
};
type ImagePatch = Partial<Pick<ImageElement, "assetUrl" | "fit" | "cornerRadius">> & {
  crop?: MediaCrop | null;
};
type IconPatch = Partial<Pick<IconElement, "icon" | "color" | "strokeWidth">>;
type DeviceFramePatch = Partial<Pick<DeviceFrameElement, "assetUrl" | "fit" | "deviceType">>;

interface ElementPatchByType {
  text: CommonElementPatch & RolePatch & TextPatch;
  shape: CommonElementPatch & RolePatch & ShapePatch;
  screenshot: CommonElementPatch & ScreenshotPatch;
  image: CommonElementPatch & ImagePatch;
  icon: CommonElementPatch & IconPatch;
  "device-frame": CommonElementPatch & DeviceFramePatch;
  group: CommonElementPatch;
}

export type ElementPatchFor<T extends Element["type"]> = ElementPatchByType[T];
export type ElementPatch = ElementPatchFor<Element["type"]>;
export type ElementPatchRequest<T extends Element["type"] = Element["type"]> = {
  type: T;
  patch: ElementPatchFor<NoInfer<T>>;
};

type ElementFor<T extends Element["type"]> = Extract<Element, { type: T }>;

function applyCommonPatch(element: Element, patch: CommonElementPatch): void {
  if (patch.x !== undefined) element.x = patch.x;
  if (patch.y !== undefined) element.y = patch.y;
  if (patch.width !== undefined) element.width = patch.width;
  if (patch.height !== undefined) element.height = patch.height;
  if (patch.rotation !== undefined) element.rotation = patch.rotation;
  if (patch.opacity !== undefined) element.opacity = patch.opacity;
  if (patch.locked !== undefined) element.locked = patch.locked;
  if (patch.visible !== undefined) element.visible = patch.visible;
  if (patch.name !== undefined) element.name = patch.name;
}

function applyRolePatch(element: TextElement | ShapeElement, patch: RolePatch): void {
  if (patch.role === null) delete element.role;
  else if (patch.role !== undefined) element.role = patch.role;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported element type: ${String(value)}`);
}

export function applyElementPatch<T extends Element["type"]>(
  element: ElementFor<T>,
  patch: ElementPatchFor<T>,
): void;
export function applyElementPatch(element: Element, patch: ElementPatch): void {
  if (element.type === "group" && (patch.width !== undefined || patch.height !== undefined)) {
    const scale = patch.width !== undefined
      ? patch.width / element.width
      : patch.height! / element.height;
    const resized = resizeGroupUniform(
      element,
      patch.width ?? element.width * scale,
      patch.height ?? element.height * scale,
    );
    element.children = resized.children;
    patch = { ...patch, width: resized.width, height: resized.height };
  }

  applyCommonPatch(element, patch);
  switch (element.type) {
    case "text": {
      const typedPatch = patch as ElementPatchFor<"text">;
      applyRolePatch(element, typedPatch);
      if (typedPatch.content !== undefined) element.content = typedPatch.content;
      if (typedPatch.fontFamily !== undefined) element.fontFamily = typedPatch.fontFamily;
      if (typedPatch.size !== undefined) element.size = typedPatch.size;
      if (typedPatch.weight !== undefined) element.weight = typedPatch.weight;
      if (typedPatch.lineHeight !== undefined) element.lineHeight = typedPatch.lineHeight;
      if (typedPatch.letterSpacing !== undefined) element.letterSpacing = typedPatch.letterSpacing;
      if (typedPatch.align !== undefined) element.align = typedPatch.align;
      if (typedPatch.color !== undefined) element.color = typedPatch.color;
      if (typedPatch.shadow === null) delete element.shadow;
      else if (typedPatch.shadow !== undefined) element.shadow = typedPatch.shadow;
      return;
    }
    case "shape": {
      const typedPatch = patch as ElementPatchFor<"shape">;
      applyRolePatch(element, typedPatch);
      if (typedPatch.fill !== undefined) element.fill = typedPatch.fill;
      if (typedPatch.radius !== undefined) element.radius = typedPatch.radius;
      if (typedPatch.kind !== undefined) element.kind = typedPatch.kind;
      if (typedPatch.gradient === null) delete element.gradient;
      else if (typedPatch.gradient !== undefined) element.gradient = typedPatch.gradient;
      if (typedPatch.stroke === null) delete element.stroke;
      else if (typedPatch.stroke !== undefined) element.stroke = typedPatch.stroke;
      return;
    }
    case "screenshot": {
      const typedPatch = patch as ElementPatchFor<"screenshot">;
      if (typedPatch.assetUrl !== undefined) element.assetUrl = typedPatch.assetUrl;
      if (typedPatch.fit !== undefined) element.fit = typedPatch.fit;
      if (typedPatch.cornerRadius !== undefined) element.cornerRadius = typedPatch.cornerRadius;
      if (typedPatch.crop === null) delete element.crop;
      else if (typedPatch.crop !== undefined) element.crop = typedPatch.crop;
      return;
    }
    case "image": {
      const typedPatch = patch as ElementPatchFor<"image">;
      if (typedPatch.assetUrl !== undefined) element.assetUrl = typedPatch.assetUrl;
      if (typedPatch.fit !== undefined) element.fit = typedPatch.fit;
      if (typedPatch.cornerRadius !== undefined) element.cornerRadius = typedPatch.cornerRadius;
      if (typedPatch.crop === null) delete element.crop;
      else if (typedPatch.crop !== undefined) element.crop = typedPatch.crop;
      return;
    }
    case "icon": {
      const typedPatch = patch as ElementPatchFor<"icon">;
      if (typedPatch.icon !== undefined) element.icon = typedPatch.icon;
      if (typedPatch.color !== undefined) element.color = typedPatch.color;
      if (typedPatch.strokeWidth !== undefined) element.strokeWidth = typedPatch.strokeWidth;
      return;
    }
    case "device-frame": {
      const typedPatch = patch as ElementPatchFor<"device-frame">;
      if (typedPatch.assetUrl !== undefined) element.assetUrl = typedPatch.assetUrl;
      if (typedPatch.fit !== undefined) element.fit = typedPatch.fit;
      if (typedPatch.deviceType !== undefined) element.deviceType = typedPatch.deviceType;
      return;
    }
    case "group":
      return;
    default:
      return assertNever(element);
  }
}

/** Apply only after the caller-supplied discriminant matches the live element. */
export function applyMatchingElementPatch<T extends Element["type"]>(
  element: Element,
  request: ElementPatchRequest<T>,
): boolean {
  if (element.type !== request.type) return false;
  applyElementPatch(element as ElementFor<T>, request.patch);
  return true;
}
