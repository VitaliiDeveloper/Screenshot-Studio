// SPDX-License-Identifier: Apache-2.0
import {
  buildBundleEntries,
  leadStoreSizeId,
  type BundleEntry,
  type StoreSpecs,
} from "@screenshot-studio/core/export";
import type { Project } from "@screenshot-studio/core/model";

export const PLAY_INTERVAL_MS = 3000;

/**
 * The files a store-bundle export writes for the active screen's destination, size, and locale,
 * in file order. Empty when that bundle cannot be built, the same case Export shows no count for.
 */
export function playEntries(
  project: Project | null,
  layoutId: string | null,
  activeScreenId: string | null,
  specs: StoreSpecs,
): BundleEntry[] {
  const layout = project?.layouts.find((candidate) => candidate.id === layoutId);
  const active = layout?.screens.find((screen) => screen.id === activeScreenId) ?? layout?.screens[0];
  if (!project || !layout || !active) return [];
  try {
    const sizeId = active.storeTargetId ?? leadStoreSizeId(specs, active.platform, active.device);
    return buildBundleEntries(project, layout.id, specs, {
      platform: active.platform,
      device: active.device,
      locale: active.locale,
    }).filter((entry) => entry.target.id === sizeId);
  } catch {
    return [];
  }
}

export interface PlaybackState {
  index: number;
  playing: boolean;
}

export type PlaybackAction =
  | { type: "tick" }
  | { type: "go"; index: number }
  | { type: "scrolled"; index: number }
  | { type: "pause" }
  | { type: "toggle" };

export function initialPlayback(count: number): PlaybackState {
  return { index: 0, playing: count > 1 };
}

/** Autoplay advances and stops on the last screen; any manual navigation pauses it. */
export function playbackReducer(count: number) {
  const last = Math.max(0, count - 1);
  const clamp = (index: number) => Math.min(last, Math.max(0, index));
  return (state: PlaybackState, action: PlaybackAction): PlaybackState => {
    let next: PlaybackState;
    switch (action.type) {
      case "tick": {
        if (!state.playing) return state;
        const index = clamp(state.index + 1);
        next = { index, playing: index < last };
        break;
      }
      case "go":
        next = { index: clamp(action.index), playing: false };
        break;
      case "scrolled":
        next = { ...state, index: clamp(action.index) };
        break;
      case "pause":
        next = { ...state, playing: false };
        break;
      case "toggle":
        next = state.playing
          ? { ...state, playing: false }
          : { index: state.index >= last ? 0 : state.index, playing: count > 1 };
        break;
    }
    return next.index === state.index && next.playing === state.playing ? state : next;
  };
}

/** A wheel gesture that scrolls the strip sideways; a plain vertical wheel moves nothing here. */
export function wheelScrollsSideways(event: { deltaX: number; deltaY: number; shiftKey: boolean }): boolean {
  return event.shiftKey ? event.deltaY !== 0 || event.deltaX !== 0 : Math.abs(event.deltaX) > Math.abs(event.deltaY);
}

/** Index of the slide whose center is closest to the scroller's center. */
export function nearestSlideIndex(slideCenters: readonly number[], viewportCenter: number): number {
  let best = 0;
  slideCenters.forEach((center, index) => {
    if (Math.abs(center - viewportCenter) < Math.abs(slideCenters[best]! - viewportCenter)) best = index;
  });
  return best;
}
