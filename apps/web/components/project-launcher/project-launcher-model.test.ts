// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  launcherActions,
  reduceLauncherImportState,
  type LauncherImportState,
} from "./project-launcher-model.js";

describe("project launcher model", () => {
  it("keeps Import enabled while Create and Recents remain stable future extension points", () => {
    expect(launcherActions).toEqual({
      createEnabled: false,
      importEnabled: true,
      recentProjects: [],
    });
  });

  it("models choosing, cancellable upload, non-cancellable publication, and success", () => {
    let state: LauncherImportState = { status: "idle" };
    state = reduceLauncherImportState(state, { type: "choose" });
    expect(state).toEqual({ status: "choosing" });
    state = reduceLauncherImportState(state, { type: "upload", kind: "folder" });
    expect(state).toEqual({ status: "uploading", kind: "folder", cancellable: true });
    state = reduceLauncherImportState(state, { type: "publishing" });
    expect(state).toEqual({ status: "publishing", kind: "folder", cancellable: false });
    expect(reduceLauncherImportState(state, { type: "complete" })).toEqual({ status: "idle" });
  });

  it("supports cancellation, error details, and retry without inventing a recent", () => {
    const cancelled = reduceLauncherImportState(
      { status: "uploading", kind: "json", cancellable: true },
      { type: "cancel" },
    );
    expect(cancelled).toEqual({ status: "cancelled" });
    const error = reduceLauncherImportState(cancelled, {
      type: "fail",
      message: "Missing resources",
      missingResources: ["screenshots/hero.png"],
    });
    expect(error).toEqual({
      status: "error",
      message: "Missing resources",
      missingResources: ["screenshots/hero.png"],
    });
    expect(reduceLauncherImportState(error, { type: "retry" }))
      .toEqual({ status: "choosing" });
    expect(launcherActions.recentProjects).toEqual([]);
  });

  it("does not cancel once atomic publication has started", () => {
    const publishing: LauncherImportState = {
      status: "publishing",
      kind: "archive",
      cancellable: false,
    };
    expect(reduceLauncherImportState(publishing, { type: "cancel" })).toBe(publishing);
  });
});
