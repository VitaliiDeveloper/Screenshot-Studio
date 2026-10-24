// SPDX-License-Identifier: Apache-2.0
import {
  deviceFramePreset,
  elementLeaves,
  type DeviceFrameId,
  type Element,
  type ShapeElement,
  type TextElement,
  type ThemeRole,
} from "@screenshot-studio/core/model";
import type { DesignPack } from "@screenshot-studio/core/themes";

type Box = { x: number; y: number; width: number; height: number };

export interface StyleScreenCopy {
  key: string;
  name: string;
  slot: "hero" | "feature" | "proof" | "cta";
  eyebrow: string;
  headline: string;
  subline: string;
  action?: string;
}

/** Shared narrative: hero, three features, social proof, call to action. */
export const STYLE_PACK_SCREENS: readonly StyleScreenCopy[] = [
  { key: "hero", name: "Hero", slot: "hero", eyebrow: "YOUR APP", headline: "Everything you need, in one place", subline: "Say what your app does in one short, confident line." },
  { key: "feature-1", name: "Feature 1", slot: "feature", eyebrow: "FEATURE 01", headline: "Plan your day in seconds", subline: "Show one feature per screen with a short supporting line." },
  { key: "feature-2", name: "Feature 2", slot: "feature", eyebrow: "FEATURE 02", headline: "Stay in sync on every device", subline: "Keep each subline to one idea and about ten words." },
  { key: "feature-3", name: "Feature 3", slot: "feature", eyebrow: "FEATURE 03", headline: "Insights that keep you going", subline: "Drop a screenshot of this feature into the device." },
  { key: "proof", name: "Social proof", slot: "proof", eyebrow: "", headline: "“The app I open every morning.”", subline: "4.9 average rating from 12,000 reviews" },
  { key: "cta", name: "Call to action", slot: "cta", eyebrow: "GET STARTED", headline: "Start free today", subline: "No account needed to try every feature.", action: "Download now" },
];

export interface DecorContext {
  width: number;
  height: number;
  shortSide: number;
  device: Box;
  pack: DesignPack;
}

export interface StyleComposition {
  align: "left" | "center";
  /** Physical side the device sits on; RTL mirrors it once at materialization. */
  devicePosition: "center" | "right";
  textAt: (screenIndex: number) => "top" | "bottom";
  /** Share of the device height allowed below the artboard. */
  bleed: number;
  maxDeviceWidth: number;
  headingLines: number;
  /** Generated art drawn behind everything; it must stay clear of text boxes. */
  decor: (context: DecorContext) => ShapeElement[];
}

const shape = (id: string, name: string, box: Box, fields: Partial<ShapeElement> & Pick<ShapeElement, "kind" | "fill">): ShapeElement => ({
  id, type: "shape", name, ...roundBox(box), rotation: 0, opacity: 1, locked: false, visible: true, radius: 0, ...fields,
});

function roundBox(box: Box): Box {
  return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
}

export const STYLE_COMPOSITIONS: Readonly<Record<string, StyleComposition>> = {
  clean: {
    align: "center", devicePosition: "center", textAt: () => "top", bleed: 0, maxDeviceWidth: 0.66, headingLines: 3,
    decor: ({ width, height, shortSide, device, pack }) => [shape("stage", "Stage", {
      x: shortSide * 0.06, y: device.y + device.height * 0.3, width: width - shortSide * 0.12, height: height - device.y - device.height * 0.3 - shortSide * 0.06,
    }, { kind: "rect", fill: pack.palette.surface, radius: Math.round(shortSide * 0.06), role: "surface" })],
  },
  aurora: {
    align: "left", devicePosition: "right", textAt: () => "top", bleed: 0, maxDeviceWidth: 0.62, headingLines: 3,
    decor: ({ width, device }) => [
      shape("glow-large", "Glow", { x: device.x - width * 0.45, y: device.y + device.height * 0.1, width: width * 0.9, height: width * 0.9 }, { kind: "ellipse", fill: "#FFFFFF", opacity: 0.1 }),
      shape("glow-small", "Glow", { x: device.x + device.width * 0.6, y: device.y, width: width * 0.36, height: width * 0.36 }, { kind: "ellipse", fill: "#F9A8D4", opacity: 0.22 }),
    ],
  },
  midnight: {
    align: "center", devicePosition: "center", textAt: (index) => (index % 2 === 0 ? "top" : "bottom"), bleed: 0, maxDeviceWidth: 0.64, headingLines: 3,
    decor: ({ device, pack }) => [
      shape("glow", "Glow", { x: device.x - device.width * 0.35, y: device.y + device.height * 0.08, width: device.width * 1.7, height: device.height * 0.84 }, { kind: "ellipse", fill: pack.palette.accent, opacity: 0.2 }),
      shape("ring", "Ring", { x: device.x - device.width * 0.2, y: device.y + device.height * 0.2, width: device.width * 1.4, height: device.height * 0.6 }, {
        kind: "ellipse", fill: "#00000000", stroke: { color: pack.palette.accent, width: Math.max(1, Math.round(device.width * 0.006)) }, opacity: 0.5,
      }),
    ],
  },
  poster: {
    align: "left", devicePosition: "center", textAt: () => "top", bleed: 0.12, maxDeviceWidth: 0.72, headingLines: 4,
    decor: () => [],
  },
  sunrise: {
    align: "left", devicePosition: "center", textAt: () => "top", bleed: 0, maxDeviceWidth: 0.62, headingLines: 3,
    decor: ({ width, height, device }) => [
      shape("sun", "Sun", { x: width * 0.5, y: device.y - width * 0.04, width: width * 0.62, height: width * 0.62 }, {
        kind: "ellipse", fill: "#FB923C", gradient: { from: "#FDBA74", to: "#FB923C", angle: 90 },
      }),
      shape("horizon", "Horizon", { x: 0, y: device.y + device.height * 0.62, width, height: height - device.y - device.height * 0.62 }, {
        kind: "rect", fill: "#FDBA74", gradient: { from: "#FDBA74", to: "#F97316", angle: 90 },
      }),
    ],
  },
};

/** Physical LTR literals for one styled pack screen; geometry derives from the exact artboard. */
export function styledScreenElements(
  composition: StyleComposition,
  copy: StyleScreenCopy,
  screenIndex: number,
  frame: DeviceFrameId,
  pack: DesignPack,
  width: number,
  height: number,
): Element[] {
  const shortSide = Math.min(width, height);
  // Landscape copy keeps a portrait-width column, so it wraps exactly as on a phone; the device takes the rest.
  const landscape = width > height;
  const column = landscape ? shortSide : width;
  const safe = Math.round(shortSide * 0.08);
  const gap = Math.round(shortSide * 0.024);
  const top = Math.round(shortSide * 0.12);
  const size = (role: ThemeRole) => Math.round(shortSide * pack.typography[role].sizeRatio);
  const lines = (role: ThemeRole, count: number) => Math.ceil(size(role) * pack.typography[role].lineHeight * count);
  const center = composition.align === "center";
  const text = (role: ThemeRole, id: string, content: string, box: Box, fields: Partial<TextElement> = {}): TextElement => {
    const typography = pack.typography[role];
    return {
      id, type: "text", role, ...roundBox(box), rotation: 0, opacity: 1, locked: false, visible: true, content,
      fontFamily: typography.family, weight: typography.weight, size: size(role), lineHeight: typography.lineHeight,
      letterSpacing: Math.round(size(role) * typography.letterSpacingEm * 100) / 100,
      align: composition.align, color: pack.palette[role], ...fields,
    };
  };

  const proof = copy.slot === "proof";
  const pad = proof ? Math.round(shortSide * 0.05) : 0;
  const innerX = safe + pad;
  const innerWidth = column - safe * 2 - pad * 2;
  const iconSize = Math.round(size("accent") * 2.4);
  const pillHeight = lines("surface", 1) + Math.round(shortSide * 0.07);
  const pillWidth = Math.round(column * 0.56);
  const rows: { height: number; build: (y: number) => Element[] }[] = [];
  if (proof) {
    rows.push({ height: iconSize, build: (y) => {
      const spacing = Math.round(iconSize * 0.25);
      const rowWidth = iconSize * 5 + spacing * 4;
      const start = center ? Math.round((column - rowWidth) / 2) : innerX;
      return Array.from({ length: 5 }, (_, star): Element => ({
        id: `star-${star + 1}`, type: "icon", role: "accent", name: "Rating star", x: start + star * (iconSize + spacing), y,
        width: iconSize, height: iconSize, rotation: 0, opacity: 1, locked: false, visible: true,
        icon: "star", color: pack.palette.accent, strokeWidth: 2.5,
      }));
    } });
  } else {
    rows.push({ height: lines("accent", 1), build: (y) => [text("accent", "eyebrow", copy.eyebrow, { x: innerX, y, width: innerWidth, height: lines("accent", 1) })] });
  }
  rows.push(
    // Bottom-aligned so a short headline still sits on its subline; the spare lines absorb longer copy.
    { height: lines("heading", composition.headingLines), build: (y) => [text("heading", "headline", copy.headline, { x: innerX, y, width: innerWidth, height: lines("heading", composition.headingLines) }, { verticalAlign: "bottom" })] },
    { height: lines("body", 3), build: (y) => [text("body", "subline", copy.subline, { x: innerX, y, width: innerWidth, height: lines("body", 3) })] },
  );
  if (copy.action) {
    rows.push({ height: pillHeight, build: (y) => {
      const box = { x: center ? (column - pillWidth) / 2 : innerX, y, width: pillWidth, height: pillHeight };
      return [
        shape("action-pill", "Action button", box, { kind: "rect", fill: pack.palette.accent, radius: Math.round(pillHeight / 2), role: "accent" }),
        text("surface", "action", copy.action!, box, { align: "center", verticalAlign: "middle" }),
      ];
    } });
  }
  const blockHeight = rows.reduce((sum, row) => sum + row.height, 0) + gap * (rows.length - 1) + pad * 2;
  const textAt = composition.textAt(screenIndex);
  const blockY = landscape ? Math.round((height - blockHeight) / 2) : textAt === "top" ? top : height - safe - blockHeight;

  const aspectRatio = deviceFramePreset(frame).recipe.spec.aspectRatio;
  let device: Box;
  if (landscape) {
    const deviceHeight = Math.min((width - column - gap) / aspectRatio, height - safe * 2);
    const deviceWidth = deviceHeight * aspectRatio;
    device = roundBox({
      x: width - safe - deviceWidth,
      y: composition.bleed > 0 ? height - deviceHeight * (1 - composition.bleed) : (height - deviceHeight) / 2,
      width: deviceWidth,
      height: deviceHeight,
    });
  } else {
    const areaTop = textAt === "top" ? blockY + blockHeight + gap * 2 : top;
    const areaBottom = textAt === "top" ? (composition.bleed > 0 ? height : height - safe) : blockY - gap * 2;
    let deviceHeight = (areaBottom - areaTop) / (1 - composition.bleed);
    let deviceWidth = deviceHeight * aspectRatio;
    if (deviceWidth > width * composition.maxDeviceWidth) {
      deviceWidth = width * composition.maxDeviceWidth;
      deviceHeight = deviceWidth / aspectRatio;
    }
    device = roundBox({
      x: composition.devicePosition === "center" ? (width - deviceWidth) / 2 : width - safe - deviceWidth,
      y: textAt === "top" ? areaTop : areaBottom - deviceHeight,
      width: deviceWidth,
      height: deviceHeight,
    });
  }

  // Style art is laid out around a portrait stack and would cross the landscape copy column.
  const elements: Element[] = landscape ? [] : composition.decor({ width, height, shortSide, device, pack });
  if (proof) {
    elements.push(shape("card", "Quote card", { x: safe, y: blockY, width: column - safe * 2, height: blockHeight }, {
      kind: "rect", fill: pack.palette.surface, radius: Math.round(shortSide * 0.04), role: "surface",
    }));
  }
  let y = blockY + pad;
  for (const row of rows) {
    elements.push(...row.build(Math.round(y)));
    y += row.height + gap;
  }
  elements.push({
    id: "mockup", type: "device-frame", name: "Drop screenshot here", ...device,
    rotation: 0, opacity: 1, locked: false, visible: true, deviceType: frame, fit: "cover",
  });
  return elements;
}

export interface SpanContext {
  width: number;
  height: number;
  shortSide: number;
  count: number;
  /** First y the art may use: below every text block and card on every screen. */
  top: number;
  pack: DesignPack;
}

export interface PanoramaSpan {
  summary: string;
  /** Shapes in strip coordinates, inside `[0, count × width]`. */
  draw: (context: SpanContext) => ShapeElement[];
}

/** Inner seams only: art past either strip end would land on a neighbouring, unrelated screen. */
const seams = (count: number) => Array.from({ length: count - 1 }, (_, index) => index + 1);

// Backgrounds still restart per screen in a connected layout, so only styles whose background is
// solid or vertical can span.
export const PANORAMA_SPANS: Readonly<Record<string, PanoramaSpan>> = {
  clean: {
    summary: "one stage and a timeline run under every device",
    draw: ({ width, height, shortSide, count, top, pack }) => {
      const margin = shortSide * 0.06;
      const stageY = top + (height - top) * 0.3;
      const track = shortSide * 0.01;
      const trackY = stageY - shortSide * 0.08;
      const dot = shortSide * 0.06;
      return [
        shape("stage", "Stage", { x: margin, y: stageY, width: count * width - margin * 2, height: height - stageY - margin }, {
          kind: "rect", fill: pack.palette.surface, radius: Math.round(shortSide * 0.06), role: "surface",
        }),
        shape("track", "Timeline", { x: margin, y: trackY, width: count * width - margin * 2, height: track }, {
          kind: "rect", fill: pack.palette.accent, opacity: 0.3, radius: Math.round(track / 2),
        }),
        ...seams(count).map((seam) => shape(`joint-${seam}`, `Joint (screens ${seam}–${seam + 1})`, {
          x: seam * width - dot / 2, y: trackY + track / 2 - dot / 2, width: dot, height: dot,
        }, { kind: "ellipse", fill: pack.palette.accent, role: "accent" })),
      ];
    },
  },
  midnight: {
    summary: "glowing orbit rings link each pair of screens",
    draw: ({ width, height, shortSide, count, top, pack }) => {
      const room = height - top;
      const radius = Math.min(width * 0.46, room * 0.4);
      const stroke = Math.max(1, Math.round(shortSide * 0.006));
      const center = (seam: number) => top + room * (seam % 2 === 0 ? 0.4 : 0.62);
      const ring = (seam: number, scale: number, opacity: number, id: string) => shape(id, `Orbit ring (screens ${seam}–${seam + 1})`, {
        x: seam * width - radius * scale, y: center(seam) - radius * scale, width: radius * scale * 2, height: radius * scale * 2,
      }, { kind: "ellipse", fill: "#00000000", stroke: { color: pack.palette.accent, width: stroke }, opacity });
      return seams(count).flatMap((seam) => [
        shape(`glow-${seam}`, `Glow (screens ${seam}–${seam + 1})`, {
          x: seam * width - radius * 1.3, y: center(seam) - radius, width: radius * 2.6, height: radius * 2,
        }, { kind: "ellipse", fill: pack.palette.accent, opacity: 0.14 }),
        ring(seam, 1, 0.6, `ring-${seam}`),
        ring(seam, 0.7, 0.35, `ring-${seam}-inner`),
      ]);
    },
  },
  poster: {
    summary: "a bold stripe and split discs cross every screen edge",
    draw: ({ width, height, count, top, pack }) => {
      const room = height - top;
      const band = room * 0.14;
      const bandY = top + room * 0.42;
      const disc = Math.min(width * 0.62, room * 0.5);
      return [
        shape("stripe", "Stripe", { x: 0, y: bandY, width: count * width, height: band }, { kind: "rect", fill: pack.palette.accent, role: "accent" }),
        shape("stripe-thin", "Thin stripe", { x: 0, y: bandY + band * 1.35, width: count * width, height: band * 0.25 }, {
          kind: "rect", fill: pack.palette.accent, role: "accent",
        }),
        ...seams(count).map((seam) => shape(`disc-${seam}`, `Disc (screens ${seam}–${seam + 1})`, {
          x: seam * width - disc / 2, y: seam % 2 === 0 ? bandY - disc * 0.6 : bandY + band - disc * 0.4, width: disc, height: disc,
        }, { kind: "ellipse", fill: pack.palette.surface, role: "surface" })),
      ];
    },
  },
  sunrise: {
    summary: "one horizon with rolling hills, and a sun rising between the first two screens",
    draw: ({ width, height, count, top }) => {
      const horizon = top + (height - top) * 0.58;
      const sun = Math.min(width * 0.36, (horizon - top) / 1.5);
      const hill = (height - horizon) * 1.2;
      return [
        shape("sun", "Sun (screens 1–2)", { x: width - sun, y: horizon - sun * 1.5, width: sun * 2, height: sun * 2 }, {
          kind: "ellipse", fill: "#FB923C", gradient: { from: "#FDE68A", to: "#FB923C", angle: 90 },
        }),
        shape("horizon", "Horizon", { x: 0, y: horizon, width: count * width, height: height - horizon }, {
          kind: "rect", fill: "#FDBA74", gradient: { from: "#FDBA74", to: "#F97316", angle: 90 },
        }),
        ...seams(count).map((seam) => shape(`hill-${seam}`, `Hill (screens ${seam}–${seam + 1})`, {
          x: seam * width - width * 0.65, y: horizon - hill * 0.3, width: width * 1.3, height: hill,
        }, seam % 2 === 0
          ? { kind: "ellipse", fill: "#F97316", gradient: { from: "#FB923C", to: "#EA580C", angle: 90 } }
          : { kind: "ellipse", fill: "#EA580C", gradient: { from: "#F97316", to: "#C2410C", angle: 90 } })),
      ];
    },
  },
};

/**
 * Draw the strip once below every screen's copy. A connected layout renders each element once from
 * its owner across the gapless strip, so every shape belongs to the screen holding its left edge
 * and comes first there: behind that screen's content and every later screen's.
 */
export function spanPanorama(span: PanoramaSpan, screens: readonly Element[][], pack: DesignPack, width: number, height: number): Element[][] {
  const shortSide = Math.min(width, height);
  const copyBottom = Math.max(...screens.flat().flatMap(elementLeaves)
    .filter((leaf) => leaf.type !== "device-frame")
    .map((leaf) => leaf.y + leaf.height));
  const strip = span.draw({ width, height, shortSide, count: screens.length, top: copyBottom + Math.round(shortSide * 0.048), pack });
  // shortcut: art is placed for LTR at the lead size; RTL mirroring and fitted store sizes misalign it, upgrade when connected layouts mirror the whole strip.
  const owners = strip.map((art) => Math.min(screens.length - 1, Math.floor(art.x / width)));
  // Rendering stacks art by owner first, so art drawn out of owner order would layer unlike its design.
  if (owners.some((owner, index) => index > 0 && owner < owners[index - 1]!)) {
    throw new Error("Panorama art must be drawn in owner-screen order");
  }
  return screens.map((elements, index) => [
    ...strip.filter((_, art) => owners[art] === index).map((art) => ({ ...art, x: art.x - index * width })),
    ...elements,
  ]);
}
