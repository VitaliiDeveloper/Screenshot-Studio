// SPDX-License-Identifier: Apache-2.0
import { SCREEN_DEVICES_BY_PLATFORM, type Platform } from "./schema.js";

type DeviceByPlatform<P extends Platform> = (typeof SCREEN_DEVICES_BY_PLATFORM)[P][number];

export type OutputFamilyKey = {
  [P in Platform]: `${P}/${DeviceByPlatform<P>}`;
}[Platform];

export interface OutputDestination {
  id: Platform;
  label: string;
  shortLabel: string;
  kind: "store" | "web";
}

export interface OutputDeviceFamily {
  key: OutputFamilyKey;
  label: string;
  creatable: boolean;
  recommended: boolean;
  leadStoreSizeId: string;
  replacementKey?: OutputFamilyKey;
}

/** User-facing destination metadata. Persisted projects continue to store only the destination ID. */
export const OUTPUT_DESTINATIONS = [
  { id: "apple", label: "App Store", shortLabel: "Apple", kind: "store" },
  { id: "android", label: "Google Play", shortLabel: "Android", kind: "store" },
  { id: "windows", label: "Microsoft Store", shortLabel: "Windows", kind: "store" },
  { id: "web", label: "Web", shortLabel: "Web", kind: "web" },
] as const satisfies readonly OutputDestination[];

/**
 * Presentation and creation policy for every strict-schema output family.
 * Legacy families remain here so existing project documents can always be labelled and exported.
 */
export const OUTPUT_DEVICE_FAMILIES = [
  { key: "apple/iphone", label: "iPhone", creatable: true, recommended: true, leadStoreSizeId: "6.9" },
  { key: "apple/ipad", label: "iPad", creatable: true, recommended: false, leadStoreSizeId: "13" },
  { key: "apple/macos", label: "macOS", creatable: true, recommended: false, leadStoreSizeId: "2880x1800" },
  { key: "apple/tvos", label: "tvOS", creatable: true, recommended: false, leadStoreSizeId: "4k" },
  { key: "apple/watchos", label: "watchOS", creatable: true, recommended: false, leadStoreSizeId: "ultra-3" },
  { key: "android/phone", label: "Android phone", creatable: true, recommended: true, leadStoreSizeId: "phone-portrait" },
  { key: "android/tablet-7", label: "7-inch Android tablet", creatable: true, recommended: false, leadStoreSizeId: "tablet-7-portrait" },
  { key: "android/tablet-10", label: "10-inch Android tablet", creatable: true, recommended: false, leadStoreSizeId: "tablet-10-portrait" },
  { key: "windows/desktop", label: "Windows desktop", creatable: true, recommended: true, leadStoreSizeId: "4k" },
  { key: "web/desktop", label: "Desktop", creatable: true, recommended: true, leadStoreSizeId: "desktop-1920" },
  { key: "web/laptop", label: "Laptop", creatable: false, recommended: false, leadStoreSizeId: "laptop-1440", replacementKey: "web/desktop" },
  { key: "web/tablet", label: "Tablet", creatable: true, recommended: false, leadStoreSizeId: "tablet-portrait" },
  { key: "web/mobile", label: "Mobile", creatable: true, recommended: false, leadStoreSizeId: "mobile-portrait" },
] as const satisfies readonly OutputDeviceFamily[];

export function destinationLabel(platform: string): string {
  const destination = OUTPUT_DESTINATIONS.find(({ id }) => id === platform);
  if (!destination) throw new Error(`No output destination configured for ${platform}`);
  return destination.label;
}

export function outputFamilyLabel(platform: string, device: string): string {
  const family = OUTPUT_DEVICE_FAMILIES.find(({ key }) => key === `${platform}/${device}`);
  if (!family) throw new Error(`No output device family configured for ${platform}/${device}`);
  return `${destinationLabel(platform)} · ${family.label}`;
}
