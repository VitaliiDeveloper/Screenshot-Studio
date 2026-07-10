// SPDX-License-Identifier: Apache-2.0
import type { FontIdentity } from "./font-identity.js";
import type { GroupElement, IconElement, ShapeElement, TextElement } from "./schema.js";

export const BADGE_PRIMITIVE_KINDS = ["rating", "as-seen-on"] as const;
export type BadgePrimitiveKind = typeof BADGE_PRIMITIVE_KINDS[number];

export interface CreateBadgePrimitiveInput {
  kind: BadgePrimitiveKind;
  font: FontIdentity;
  x?: number;
  y?: number;
  createId?: () => string;
}

function base(id: string, width: number, height: number, name: string) {
  return {
    id,
    name,
    x: 0,
    y: 0,
    width,
    height,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
  };
}

export function createBadgePrimitive(input: CreateBadgePrimitiveInput): GroupElement {
  const createId = input.createId ?? (() => crypto.randomUUID());
  const groupId = createId();
  if (input.kind === "rating") {
    const background: ShapeElement = {
      ...base(createId(), 420, 120, "Badge background"),
      type: "shape",
      kind: "rect",
      fill: "#111827",
      radius: 60,
    };
    const star: IconElement = {
      ...base(createId(), 64, 64, "Rating star"),
      type: "icon",
      x: 28,
      y: 28,
      icon: "star",
      color: "#FBBF24",
      strokeWidth: 4,
    };
    const copy: TextElement = {
      ...base(createId(), 280, 70, "Rating copy"),
      type: "text",
      x: 112,
      y: 25,
      content: "4.9 • 12K ratings",
      fontFamily: input.font.family,
      weight: input.font.weight,
      size: 32,
      lineHeight: 1.2,
      letterSpacing: 0,
      align: "left",
      color: "#FFFFFF",
    };
    return {
      ...base(groupId, 420, 120, "Rating badge"),
      type: "group",
      x: input.x ?? 100,
      y: input.y ?? 100,
      children: [background, star, copy],
    };
  }

  const background: ShapeElement = {
    ...base(createId(), 460, 120, "Badge background"),
    type: "shape",
    kind: "rect",
    fill: "#F8FAFC",
    radius: 20,
  };
  const sparkles: IconElement = {
    ...base(createId(), 56, 56, "Badge sparkles"),
    type: "icon",
    x: 24,
    y: 32,
    icon: "sparkles",
    color: "#7C3AED",
    strokeWidth: 3,
  };
  const copy: TextElement = {
    ...base(createId(), 330, 68, "Badge copy"),
    type: "text",
    x: 100,
    y: 26,
    content: "AS SEEN ON",
    fontFamily: input.font.family,
    weight: input.font.weight,
    size: 30,
    lineHeight: 1.2,
    letterSpacing: 2,
    align: "left",
    color: "#111827",
  };
  return {
    ...base(groupId, 460, 120, "As seen on badge"),
    type: "group",
    x: input.x ?? 100,
    y: input.y ?? 100,
    children: [background, sparkles, copy],
  };
}
