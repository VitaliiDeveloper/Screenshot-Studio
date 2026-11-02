// SPDX-License-Identifier: Apache-2.0
import { deepFreeze } from "./deep-freeze.js";
import { DEVICE_FRAME_PRESETS } from "./device-frame-presets.js";
import type {
  DeviceFrameFinish,
  DeviceFramePreset,
  DeviceFramePresetGroup,
  DeviceFrameRecommendation,
  DeviceFrameSpec,
  DeviceFrameTag,
} from "./device-frame-types.js";
import type { DeviceFrameId } from "./schema.js";

export { DEVICE_FRAME_PRESETS };
export type { DeviceFrameSpec };

const presetsById = new Map<string, DeviceFramePreset>(
  DEVICE_FRAME_PRESETS.map((preset) => [preset.id, preset]),
);

const deviceFrameSpecs = Object.fromEntries(
  DEVICE_FRAME_PRESETS.map((preset) => [preset.id, preset.recipe.spec]),
) as Record<DeviceFrameId, DeviceFrameSpec>;

export const DEVICE_FRAME_SPECS: Readonly<Record<DeviceFrameId, DeviceFrameSpec>> = deepFreeze(
  deviceFrameSpecs,
);

export interface DeviceFramePresetFilters {
  group?: DeviceFramePresetGroup;
  tags?: readonly DeviceFrameTag[];
  finish?: DeviceFrameFinish;
  recommendedFor?: readonly DeviceFrameRecommendation[];
  legacy?: boolean;
}

/** Returns presets in stable catalog order. Every supplied filter and every requested tag must match. */
export function listDeviceFramePresets(
  filters: DeviceFramePresetFilters = {},
): readonly DeviceFramePreset[] {
  return deepFreeze(DEVICE_FRAME_PRESETS.filter((preset) =>
    (filters.group === undefined || preset.group === filters.group)
    && (filters.finish === undefined || preset.finish === filters.finish)
    && (filters.legacy === undefined || preset.legacy === filters.legacy)
    && (filters.tags === undefined || filters.tags.every((tag) => preset.tags.includes(tag)))
    && (filters.recommendedFor === undefined
      || filters.recommendedFor.every((use) => preset.recommendedFor.includes(use))),
  ));
}

/** Resolves one bundled preset or throws a stable runtime error for untrusted input. */
export function deviceFramePreset(id: DeviceFrameId): DeviceFramePreset {
  const preset = presetsById.get(id);
  if (!preset) {
    throw new RangeError(`Unknown device frame preset: "${id}"`);
  }
  return preset;
}
