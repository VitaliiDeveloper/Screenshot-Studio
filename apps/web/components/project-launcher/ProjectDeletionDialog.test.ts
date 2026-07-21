// SPDX-License-Identifier: Apache-2.0
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ProjectDeletionDialog,
  type ProjectDeletionDialogState,
} from "./ProjectDeletionDialog.js";

function render(
  state: ProjectDeletionDialogState,
  confirmation = "",
  acknowledged = false,
): string {
  return renderToStaticMarkup(createElement(ProjectDeletionDialog, {
    projectName: "Launch Story",
    state,
    confirmation,
    acknowledged,
    onConfirmationChange: vi.fn(),
    onAcknowledgedChange: vi.fn(),
    onExportArchive: vi.fn(),
    onContinueWithoutArchive: vi.fn(),
    onConfirmDelete: vi.fn(),
    onRetryDeletion: vi.fn(),
    onClose: vi.fn(),
  }));
}

describe("ProjectDeletionDialog", () => {
  it("starts with a concise irreversible choice and keeps both backup paths explicit", () => {
    const markup = render({ status: "choosing-backup" });
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("Permanently delete project");
    expect(markup).toContain("Export archive, then continue");
    expect(markup).toContain("Continue without an archive");
    expect(markup).toContain("cannot be recovered");
    expect(markup).not.toContain("This is not Close project");
    expect(markup).not.toContain("Close keeps project data");
    expect(markup).not.toContain("Restore");
    expect(markup).not.toContain("Move to Trash");
  });

  it("never advances a failed archive implicitly and offers retry, no-backup, or cancel", () => {
    const markup = render({ status: "archive-error", error: "Archive failed" });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Archive failed");
    expect(markup).toContain("Retry archive export");
    expect(markup).toContain("Continue without an archive");
    expect(markup).toContain("Cancel");
    expect(markup).not.toContain("Confirm permanent deletion");
  });

  it("requires the exact project name and a separate irreversible acknowledgement", () => {
    const disabled = render({ status: "confirming", backup: { kind: "none", acknowledged: true } });
    expect(disabled).toContain("Type Launch Story to confirm");
    expect(disabled).toContain("I understand this project cannot be recovered");
    expect(disabled).toMatch(/Permanently delete project<\/button>/u);
    expect(disabled).toMatch(/disabled=""[^>]*>Permanently delete project/u);

    const enabled = render(
      { status: "confirming", backup: { kind: "archive", projectRevision: "1".repeat(64) } },
      "Launch Story",
      true,
    );
    expect(enabled).not.toMatch(/disabled=""[^>]*>Permanently delete project/u);
    expect(enabled).toContain("Archive export requested");
  });

  it("locks the dialog during export/deletion and keeps deletion failure retryable", () => {
    expect(render({ status: "exporting" })).toContain('aria-busy="true"');
    expect(render({ status: "deleting" })).toContain('aria-busy="true"');
    const failed = render({ status: "deletion-error", error: "Status unavailable" });
    expect(failed).toContain("Retry permanent deletion");
    expect(failed).toContain("Status unavailable");
  });
});
