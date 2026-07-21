// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { DelayedOpeningState, OPENING_OVERLAY_DELAY_MS } from "./delayed-opening-state.js";

describe("DelayedOpeningState", () => {
  it("shows an opening overlay only after 200 ms and clears on completion", () => {
    vi.useFakeTimers();
    const visible: Array<string | null> = [];
    const state = new DelayedOpeningState((entryId) => visible.push(entryId));
    state.start("project_1");
    vi.advanceTimersByTime(199);
    expect(visible).toEqual([]);
    vi.advanceTimersByTime(OPENING_OVERLAY_DELAY_MS - 199);
    expect(visible).toEqual(["project_1"]);
    state.clear();
    expect(visible).toEqual(["project_1", null]);
    vi.useRealTimers();
  });
});
