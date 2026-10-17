// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import {
  activateEditorRouteEntry,
  canonicalEditorUrlForSelection,
  editorProjectUrl,
  projectInfoEntryBindingError,
  projectInfoUrl,
} from "./editor-route.js";
import type { ActiveProjectSelection } from "@web/lib/clients/project-session.js";

const managedEntryId = "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const recentEntryId = "recent_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const localProjectId = "c".repeat(64);

function selection(overrides: Partial<ActiveProjectSelection> = {}): ActiveProjectSelection {
  return {
    sessionId: "session",
    projectId: managedEntryId,
    name: "Launch",
    sourceKind: "managed-project",
    capabilities: {
      writeInPlace: true,
      revealLocation: false,
      watchExternalChanges: false,
      nativePicker: false,
      projectLocalResources: true,
      exportProjectArchive: true,
      deleteProjectPermanently: true,
    },
    ...overrides,
  };
}

describe("editor project routes", () => {
  it("builds canonical entry-addressed workspace URLs", () => {
    expect(editorProjectUrl(managedEntryId)).toBe(`/editor/${managedEntryId}`);
    expect(editorProjectUrl(recentEntryId, "export"))
      .toBe(`/editor/${recentEntryId}?intent=export`);
    expect(() => editorProjectUrl(localProjectId)).toThrow("Invalid project library entry id");
  });

  it("validates and activates exactly the entry named by the URL", async () => {
    const activateManaged = vi.fn(async () => ({ projectId: managedEntryId }));
    const activateRecent = vi.fn(async () => ({ projectId: localProjectId }));

    await expect(activateEditorRouteEntry(managedEntryId, activateManaged))
      .resolves.toEqual({ projectId: managedEntryId });
    await expect(activateEditorRouteEntry(recentEntryId, activateRecent))
      .resolves.toEqual({ projectId: localProjectId });
    expect(activateManaged).toHaveBeenCalledWith(managedEntryId);
    expect(activateRecent).toHaveBeenCalledWith(recentEntryId);
  });

  it("fails closed on invalid or mismatched activation identities", async () => {
    const activate = vi.fn(async () => ({ projectId: "project_dddddddddddddddddddddddddddddddd" }));
    await expect(activateEditorRouteEntry("not-an-entry", activate)).rejects.toThrow("valid project entry id");
    expect(activate).not.toHaveBeenCalled();
    await expect(activateEditorRouteEntry(managedEntryId, activate)).rejects.toThrow("different project");
    await expect(activateEditorRouteEntry(recentEntryId, activate)).rejects.toThrow("invalid local project identity");
  });

  it("canonicalizes only managed active selections without inventing a recent mapping", () => {
    expect(canonicalEditorUrlForSelection(selection())).toBe(`/editor/${managedEntryId}`);
    expect(canonicalEditorUrlForSelection(selection({
      sourceKind: "local-file",
      projectId: localProjectId,
    }))).toBeNull();
  });

  it("binds Project Info entry context only to the same managed project identity", () => {
    const otherManagedEntryId = "project_dddddddddddddddddddddddddddddddd";

    expect(projectInfoUrl(managedEntryId, managedEntryId))
      .toBe(`/home?project=${managedEntryId}&entry=${managedEntryId}`);
    expect(projectInfoUrl(managedEntryId, otherManagedEntryId))
      .toBe(`/home?project=${managedEntryId}`);
    expect(projectInfoUrl(localProjectId, recentEntryId))
      .toBe(`/home?project=${localProjectId}`);

    expect(projectInfoEntryBindingError(managedEntryId, managedEntryId)).toBeNull();
    expect(projectInfoEntryBindingError(managedEntryId, otherManagedEntryId))
      .toMatch(/does not match/);
    expect(projectInfoEntryBindingError(localProjectId, recentEntryId))
      .toMatch(/does not match/);
  });
});
