// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProjectActionNoticeState,
  projectActionNoticeExitMs,
  projectActionNoticeVisibleMs,
  type ProjectLibraryNotice,
} from "./project-action-notice.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("ProjectActionNoticeState", () => {
  it("publishes, animates out, and removes a card-scoped notice", () => {
    vi.useFakeTimers();
    const published: Array<ProjectLibraryNotice | null> = [];
    const state = new ProjectActionNoticeState((notice) => published.push(notice));

    state.show("project-1", "Archive download started.");
    expect(published.at(-1)).toEqual({
      entryId: "project-1",
      message: "Archive download started.",
      motion: "visible",
    });

    vi.advanceTimersByTime(projectActionNoticeVisibleMs);
    expect(published.at(-1)).toMatchObject({ entryId: "project-1", motion: "closing" });

    vi.advanceTimersByTime(projectActionNoticeExitMs);
    expect(published.at(-1)).toBeNull();
  });

  it("cancels a previous notice when a new action starts", () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const state = new ProjectActionNoticeState(publish);
    state.show("project-1", "Archive download started.");

    state.clear();
    vi.runAllTimers();

    expect(publish).toHaveBeenLastCalledWith(null);
    expect(publish).toHaveBeenCalledTimes(2);
  });
});
