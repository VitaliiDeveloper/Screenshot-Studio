// SPDX-License-Identifier: Apache-2.0
"use client";

import { DialogShell } from "@web/components/editor-ui/DialogShell.js";
import { editorUi } from "@web/components/editor-ui/styles.js";

/** App-owned confirmation surface for potentially destructive editor actions. */
export function ConfirmationDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = true,
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const close = busy ? () => undefined : onClose;
  return (
    <DialogShell
      title={title}
      description={description}
      ariaLabel={title}
      closeLabel={cancelLabel}
      initialFocus="heading"
      density="compact"
      widthClass="max-w-xs"
      onClose={close}
    >
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className={`${editorUi.buttonSecondary} whitespace-nowrap`}
          disabled={busy}
          onClick={close}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`${destructive ? editorUi.buttonDanger : editorUi.buttonPrimary} whitespace-nowrap`}
          disabled={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </DialogShell>
  );
}
