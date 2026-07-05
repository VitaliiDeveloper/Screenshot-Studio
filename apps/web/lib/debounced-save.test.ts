import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDebouncedSaver } from "./debounced-save.js";
import type { Project } from "@screenshot-studio/core/model";

const fakeProject = { meta: { name: "X" } } as unknown as Project;

describe("createDebouncedSaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces rapid calls into a single save with the latest project", () => {
    const save = vi.fn();
    const debounced = createDebouncedSaver(save, 300);
    debounced(fakeProject);
    debounced(fakeProject);
    debounced(fakeProject);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("saves again after the delay elapses between calls", () => {
    const save = vi.fn();
    const debounced = createDebouncedSaver(save, 300);
    debounced(fakeProject);
    vi.advanceTimersByTime(300);
    debounced(fakeProject);
    vi.advanceTimersByTime(300);
    expect(save).toHaveBeenCalledTimes(2);
  });
});
