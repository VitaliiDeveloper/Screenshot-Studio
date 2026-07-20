// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createDebouncedSaver,
  createProjectSaveCoordinator,
  discardActiveProjectPersistence,
  hasPendingProjectSave,
  scheduleSave,
} from "./debounced-save.js";
import { editorStore } from "./editor-store.js";
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

  it("cancels a queued stale snapshot", () => {
    const save = vi.fn();
    const debounced = createDebouncedSaver(save, 300);
    debounced(fakeProject);
    debounced.cancel();
    vi.advanceTimersByTime(300);
    expect(save).not.toHaveBeenCalled();
  });

  it("flushes the latest queued snapshot immediately", async () => {
    const save = vi.fn();
    const debounced = createDebouncedSaver(save, 300);
    debounced(fakeProject);
    await debounced.flush();
    expect(save).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(300);
    expect(save).toHaveBeenCalledOnce();
  });

  it("reports whether a debounced project snapshot is waiting", async () => {
    const debounced = createDebouncedSaver(vi.fn(), 300);
    expect(debounced.hasPending()).toBe(false);
    debounced(fakeProject);
    expect(debounced.hasPending()).toBe(true);
    await debounced.flush();
    expect(debounced.hasPending()).toBe(false);
  });
});

describe("createProjectSaveCoordinator", () => {
  it("waits for an in-flight save and then persists the latest snapshot", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = { meta: { name: "first" } } as unknown as Project;
    const latest = { meta: { name: "latest" } } as unknown as Project;
    let current = first;
    const saved: Project[] = [];
    const save = vi.fn(async (project: Project) => {
      saved.push(project);
      if (project === first) await firstGate;
    });
    const coordinator = createProjectSaveCoordinator(save, () => current);

    const inFlight = coordinator.saveLatest();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    current = latest;
    const queued = coordinator.saveLatest();
    releaseFirst();
    await Promise.all([inFlight, queued]);

    expect(saved).toEqual([first, latest]);
  });

  it("keeps later saves behind an exclusive mutation and reads state after synchronization", async () => {
    const before = { meta: { name: "before" } } as unknown as Project;
    const durable = { meta: { name: "durable" } } as unknown as Project;
    let current = before;
    const events: string[] = [];
    const coordinator = createProjectSaveCoordinator(async (project) => {
      events.push(`save:${project.meta.name}`);
    }, () => current);

    const mutation = coordinator.runExclusive(async () => {
      events.push("mutation:start");
      await Promise.resolve();
      current = durable;
      events.push("mutation:end");
    });
    const laterSave = coordinator.saveLatest();
    await Promise.all([mutation, laterSave]);

    expect(events).toEqual(["mutation:start", "mutation:end", "save:durable"]);
  });

  it("does not start an exclusive lifecycle operation until an active save is durable", async () => {
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    const events: string[] = [];
    const coordinator = createProjectSaveCoordinator(async () => {
      events.push("save:start");
      await saveGate;
      events.push("save:end");
    }, () => fakeProject);

    const saving = coordinator.saveLatest();
    await vi.waitFor(() => expect(events).toEqual(["save:start"]));
    const lifecycle = coordinator.runExclusive(async () => {
      events.push("lifecycle");
    });
    await Promise.resolve();
    expect(events).toEqual(["save:start"]);

    releaseSave();
    await Promise.all([saving, lifecycle]);
    expect(events).toEqual(["save:start", "save:end", "lifecycle"]);
  });

  it("drains the latest project before activation and resets before later saves can run", async () => {
    const first = { meta: { name: "first" } } as unknown as Project;
    const latest = { meta: { name: "latest" } } as unknown as Project;
    let current: Project | undefined = first;
    let releaseFirst!: () => void;
    let releaseActivation!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const activationGate = new Promise<void>((resolve) => { releaseActivation = resolve; });
    const events: string[] = [];
    const coordinator = createProjectSaveCoordinator(async (project) => {
      events.push(`save:${project.meta.name}:start`);
      if (project === first) await firstGate;
      events.push(`save:${project.meta.name}:end`);
    }, () => current);

    const inFlight = coordinator.saveLatest();
    await vi.waitFor(() => expect(events).toEqual(["save:first:start"]));
    current = latest;
    const switching = coordinator.switchProject(async () => {
      events.push("activate:start");
      await activationGate;
      events.push("activate:end");
      return "opened";
    }, () => {
      current = undefined;
      events.push("reset");
    });
    const laterSave = coordinator.saveLatest();

    releaseFirst();
    await vi.waitFor(() => expect(events).toEqual([
      "save:first:start",
      "save:first:end",
      "save:latest:start",
      "save:latest:end",
      "activate:start",
    ]));
    releaseActivation();

    await expect(switching).resolves.toBe("opened");
    await Promise.all([inFlight, laterSave]);
    expect(events).toEqual([
      "save:first:start",
      "save:first:end",
      "save:latest:start",
      "save:latest:end",
      "activate:start",
      "activate:end",
      "reset",
    ]);
  });

  it("does not activate or reset when the final drain fails", async () => {
    const current = { meta: { name: "unsaved" } } as unknown as Project;
    const coordinator = createProjectSaveCoordinator(
      async () => { throw new Error("disk unavailable"); },
      () => current,
    );
    const activate = vi.fn(async () => "opened");
    const reset = vi.fn();

    await expect(coordinator.switchProject(activate, reset)).rejects.toThrow("disk unavailable");

    expect(activate).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });
});

describe("discardActiveProjectPersistence", () => {
  afterEach(() => discardActiveProjectPersistence());

  it("drops stale editor state and pending saves before a verified receiver is loaded", () => {
    editorStore.setState({ project: fakeProject, saveStatus: "error", saveError: "stale receiver" });
    scheduleSave(fakeProject);

    discardActiveProjectPersistence();

    expect(hasPendingProjectSave()).toBe(false);
    expect(editorStore.getState()).toMatchObject({
      project: null,
      activeLayoutId: null,
      activeScreenId: null,
      selectedItems: [],
      saveStatus: "idle",
      saveError: null,
    });
  });
});
