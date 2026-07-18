// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { ProjectTemplateSummary } from "@screenshot-studio/core/scaffold";
import {
  initialProjectCreationState,
  isProjectTemplateSupported,
  reduceProjectCreationState,
} from "./project-creation-model.js";

const template: ProjectTemplateSummary = {
  id: "mobile-only",
  name: "Mobile only",
  description: "A mobile project",
  intendedUse: "Mobile launches",
  supportedPlatforms: ["apple", "android"],
  preview: { backgroundFrom: "#000000", backgroundTo: "#111111", accent: "#FFFFFF" },
};

describe("project creation model", () => {
  it("opens with stable defaults and edits one strict creation form", () => {
    const opened = reduceProjectCreationState(initialProjectCreationState, { type: "open" });
    expect(opened).toEqual({
      status: "editing",
      form: {
        name: "My App Screenshots",
        platform: "apple",
        layoutMode: "isolated",
        templateId: null,
      },
    });

    const edited = reduceProjectCreationState(opened, {
      type: "change",
      patch: { name: "Launch", platform: "android", templateId: "mobile-only" },
    });
    expect(edited).toMatchObject({
      status: "editing",
      form: { name: "Launch", platform: "android", templateId: "mobile-only" },
    });
  });

  it("keeps the form for creating, error, edit, and retry transitions", () => {
    const editing = reduceProjectCreationState(initialProjectCreationState, { type: "open" });
    if (editing.status !== "editing") throw new Error("Expected the creation form to open");
    const creating = reduceProjectCreationState(editing, { type: "submit" });
    expect(creating.status).toBe("creating");
    expect(reduceProjectCreationState(creating, { type: "close" })).toBe(creating);

    const failed = reduceProjectCreationState(creating, { type: "fail", message: "Try again" });
    expect(failed).toMatchObject({ status: "error", message: "Try again", form: editing.form });
    expect(reduceProjectCreationState(failed, {
      type: "change", patch: { name: "Retry" },
    })).toMatchObject({ status: "editing", form: { name: "Retry" } });
    expect(reduceProjectCreationState(failed, { type: "submit" })).toMatchObject({
      status: "creating", form: editing.form,
    });
  });

  it("closes only before publication and evaluates template compatibility from metadata", () => {
    const editing = reduceProjectCreationState(initialProjectCreationState, { type: "open" });
    expect(reduceProjectCreationState(editing, { type: "close" })).toEqual({ status: "closed" });
    expect(isProjectTemplateSupported(template, "apple")).toBe(true);
    expect(isProjectTemplateSupported(template, "windows")).toBe(false);
  });
});
