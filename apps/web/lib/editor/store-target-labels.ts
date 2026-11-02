// SPDX-License-Identifier: Apache-2.0
import type { Screen } from "@screenshot-studio/core/model";
import {
  DEFAULT_STORE_SPECS,
  destinationLabel,
  findStoreTarget,
  leadStoreSizeId,
  listOutputFamilies,
  outputFamilyLabel,
  type StoreSize,
  type StoreSpecs,
} from "@screenshot-studio/core/export";

const STORE_SIZE_DEVICE_LABELS: Record<string, string> = {
  iphone: "iPhone",
  ipad: "iPad",
  macos: "Mac",
  tvos: "Apple TV",
  watchos: "Apple Watch",
  phone: "Android phone",
  desktop: "Windows desktop",
  laptop: "Web laptop",
  tablet: "Web tablet",
  mobile: "Web mobile",
  "tablet-7": "7-inch Android tablet",
  "tablet-10": "10-inch Android tablet",
};

export function storeOutputLabel(
  platform: string,
  device: string,
  specs: StoreSpecs = DEFAULT_STORE_SPECS,
): string {
  return outputFamilyLabel(platform, device, specs);
}

function capitalizeDisplayLabel(value: string): string {
  if (/^(?:iPhone|iPad|macOS|tvOS|watchOS)\b/.test(value)) return value;
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Short family copy for UI that already supplies the destination and output context. */
export function outputFamilyEditorLabel(
  platform: string,
  device: string,
  specs: StoreSpecs = DEFAULT_STORE_SPECS,
): string {
  const family = listOutputFamilies(specs).find(({ key }) => key === `${platform}/${device}`);
  if (!family) return storeOutputLabel(platform, device, specs);
  const legacySuffix = /\s+\(legacy\)$/i.test(family.label) ? " (legacy)" : "";
  const base = family.label
    .replace(/\s+\(legacy\)$/i, "")
    .replace(/\bAndroid\s+/i, "")
    .replace(/\bWindows\s+/i, "");
  return `${capitalizeDisplayLabel(base)}${legacySuffix}`;
}

/** Remove output-level device copy from a size label while preserving its useful discriminator. */
export function compactStoreSizeLabel(label: string, device: string): string {
  const withoutLead = label.replace(/\s+\(lead\)$/i, "");
  if (device === "tablet-7") {
    const canonicalTabletSize = /^(\d+-inch|\d+:\d+) Android tablet(?: (.+))?$/.exec(withoutLead);
    if (canonicalTabletSize) {
      return [canonicalTabletSize[1], canonicalTabletSize[2]].filter(Boolean).join(" ");
    }
  }
  const deviceLabel = STORE_SIZE_DEVICE_LABELS[device];
  if (!deviceLabel) return withoutLead;
  return withoutLead
    .replace(new RegExp(`(?:^|\\s)${escapeRegExp(deviceLabel)}(?=\\s|$)`, "i"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The exact store target a screen exports to: its own target, or its family's lead for a master. */
export function screenStoreTarget(screen: Screen, specs: StoreSpecs = DEFAULT_STORE_SPECS): StoreSize | null {
  try {
    const targetId = screen.storeTargetId ?? leadStoreSizeId(specs, screen.platform, screen.device);
    return findStoreTarget(specs, screen.platform, screen.device, targetId);
  } catch {
    return null;
  }
}

/** Append artboard px to any label its list repeats, so two exact sizes never read the same. */
export function distinctSizeLabels(
  entries: readonly { label: string; screen: Pick<Screen, "artboard"> }[],
): string[] {
  return entries.map(({ label, screen }) =>
    entries.filter((entry) => entry.label === label).length > 1
      ? `${label} · ${screen.artboard.width} × ${screen.artboard.height}`
      : label
  );
}

/**
 * Format every target as `discriminator · orientation · qualifier`.
 * The family card supplies destination/device context, so this copy never repeats it.
 */
export function conciseStoreTargetLabel(
  target: StoreSize,
  platform: string,
  device: string,
  specs: StoreSpecs = DEFAULT_STORE_SPECS,
): string {
  if (target.kind === "promotion") {
    const withoutDestination = target.label.replace(
      new RegExp(`^${escapeRegExp(destinationLabel(platform, specs))}\\s+`, "i"),
      "",
    );
    return target.id === "play-feature-graphic"
      ? "Feature graphic"
      : capitalizeDisplayLabel(withoutDestination);
  }

  let compact = compactStoreSizeLabel(target.label, device);
  const family = listOutputFamilies(specs).find(({ key }) => key === `${platform}/${device}`);
  if (family) {
    const familyLabel = family.label.replace(/\s+\(legacy\)$/i, "");
    compact = compact.replace(
      new RegExp(
        `^(?:${platform === "web" ? "Web\\s+" : ""}${escapeRegExp(familyLabel)})(?:\\s+|$)`,
        "i",
      ),
      "",
    );
  }

  const qualifiers: string[] = [];
  if (/\bhigh resolution\b/i.test(compact)) qualifiers.push("High-res");
  if (/\(frameless\)/i.test(compact)) qualifiers.push("Frameless");
  const base = compact
    .replace(/\bhigh resolution\b/gi, "")
    .replace(/\s*\(frameless\)\s*/gi, " ")
    .replace(/\b(?:portrait|landscape|square)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return [
    base ? capitalizeDisplayLabel(base) : "",
    capitalizeDisplayLabel(target.orientation),
    ...qualifiers,
  ].filter(Boolean).join(" · ");
}

const SHOWN_TARGET_DEVICES = 3;

/**
 * Size copy where people pick or edit a size: the devices the upload reaches as the title
 * (`iPhone 18 Pro · 17 Pro · 17 +5`), and the store slot with its pixels as the detail. Targets the
 * catalog lists no devices for keep the concise target label as the title.
 */
export function storeTargetDeviceCopy(
  target: StoreSize,
  platform: string,
  device: string,
  specs: StoreSpecs = DEFAULT_STORE_SPECS,
): { title: string; detail: string; devices: string | null } {
  const slot = conciseStoreTargetLabel(target, platform, device, specs);
  const pixels = `${target.width} × ${target.height} px`;
  if (!target.devices) return { title: slot, detail: pixels, devices: null };
  const [first, ...rest] = target.devices;
  const shown = [first, ...rest.slice(0, SHOWN_TARGET_DEVICES - 1).map((name) => name.replace(/^iPhone /, ""))];
  const more = target.devices.length - shown.length;
  const orientation = target.orientation === "portrait" ? "" : ` · ${capitalizeDisplayLabel(target.orientation)}`;
  return {
    title: `${shown.join(" · ")}${more > 0 ? ` +${more}` : ""}${orientation}`,
    detail: `${slot.replace(/ · (?:Portrait|Landscape)\b/, "")} · ${pixels}`,
    devices: target.devices.join(", "),
  };
}
