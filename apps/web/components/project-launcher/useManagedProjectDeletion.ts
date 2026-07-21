// SPDX-License-Identifier: Apache-2.0
"use client";

import { useRef, useState } from "react";
import { hasPendingProjectSave } from "@web/lib/debounced-save";
import { requestProjectArchive, downloadProjectArchive } from "@web/lib/project-archive-client";
import { advanceProjectHomeDeletion, type ProjectDeletionAttemptHolder } from "@web/lib/project-deletion-controller";
import type { ProjectHomeData } from "@web/lib/project-home-client";
import type { ProjectDeletionDialogState } from "@web/components/project-launcher/ProjectDeletionDialog";

export interface ManagedProjectDeletionFlow {
  dialog: ProjectDeletionDialogState | null;
  projectName: string | null;
  confirmation: string;
  acknowledged: boolean;
  open(data: ProjectHomeData): void;
  close(): void;
  exportArchive(): Promise<void>;
  continueWithoutArchive(): void;
  confirm(): Promise<void>;
  retry(): Promise<void>;
  setConfirmation(value: string): void;
  setAcknowledged(value: boolean): void;
}

export function useManagedProjectDeletion(options: {
  onDeleted(projectId: string): void;
}): ManagedProjectDeletionFlow {
  const [dialog, setDialog] = useState<ProjectDeletionDialogState | null>(null);
  const [current, setCurrent] = useState<ProjectHomeData | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const holder = useRef<ProjectDeletionAttemptHolder>({ attempt: null, inFlight: null });
  const reset = () => {
    holder.current.attempt = null;
    setCurrent(null);
    setConfirmation("");
    setAcknowledged(false);
    setDialog(null);
  };
  const close = () => {
    if (dialog?.status === "exporting" || dialog?.status === "deleting") return;
    reset();
  };
  const open = (data: ProjectHomeData) => {
    if (!data.selection.capabilities.deleteProjectPermanently) return;
    if (!Number.isSafeInteger(data.selection.lifecycleRevision)
      || (data.selection.lifecycleRevision ?? 0) <= 0) {
      return;
    }
    if (hasPendingProjectSave()) return;
    holder.current.attempt = null;
    setConfirmation("");
    setAcknowledged(false);
    setCurrent(data);
    setDialog({ status: "choosing-backup" });
  };
  const exportArchive = async () => {
    if (!current || dialog?.status === "deleting") return;
    setDialog({ status: "exporting" });
    try {
      const ticket = await requestProjectArchive(current.selection.projectId, current.resources.revision);
      downloadProjectArchive(ticket);
      setDialog({ status: "confirming", backup: { kind: "archive", projectRevision: ticket.projectRevision } });
    } catch (caught) {
      setDialog({ status: "archive-error", error: caught instanceof Error ? caught.message : String(caught) });
    }
  };
  const continueWithoutArchive = () => {
    holder.current.attempt = null;
    setDialog({ status: "confirming", backup: { kind: "none", acknowledged: true } });
  };
  const run = async (recovering: boolean) => {
    if (!current || !dialog || dialog.status === "exporting" || dialog.status === "deleting" || holder.current.inFlight) return;
    const backup = dialog.status === "confirming" ? dialog.backup : holder.current.attempt?.request.backup;
    if (!backup) {
      setDialog({ status: "deletion-error", error: "Reload Project Home before trying again." });
      return;
    }
    if (hasPendingProjectSave()) {
      setDialog({ status: "deletion-error", error: "Pending Workspace changes must save successfully before permanent deletion." });
      return;
    }
    if (!holder.current.attempt && (confirmation !== current.resources.project.meta.name || !acknowledged)) {
      setDialog({ status: "deletion-error", error: "Complete the exact permanent deletion confirmation before continuing." });
      return;
    }
    setDialog({ status: "deleting" });
    try {
      await advanceProjectHomeDeletion({ current, backup, recovering, holder: holder.current });
      const projectId = holder.current.attempt?.request.projectId ?? current.selection.projectId;
      reset();
      options.onDeleted(projectId);
    } catch (caught) {
      setDialog({ status: "deletion-error", error: caught instanceof Error ? caught.message : String(caught) });
    }
  };
  return { dialog, projectName: current?.resources.project.meta.name ?? null, confirmation, acknowledged, open, close, exportArchive, continueWithoutArchive, confirm: () => run(false), retry: () => run(true), setConfirmation, setAcknowledged };
}
