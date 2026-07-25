// SPDX-License-Identifier: Apache-2.0
"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cx } from "@web/components/editor-ui";

export function InspectorDisclosure({
  label,
  contentId,
  surface = false,
  children,
}: {
  label: string;
  contentId?: string;
  surface?: boolean;
  children: ReactNode;
}) {
  const generatedId = useId();
  const panelId = contentId ?? generatedId;
  const [open, setOpen] = useState(false);

  return (
    <div className={surface
      ? "rounded-[var(--editor-radius-control)] border border-[var(--editor-color-border)] bg-[var(--editor-color-accent-subtle)] p-3"
      : undefined}
    >
      <button
        type="button"
        aria-controls={panelId}
        aria-expanded={open}
        className={cx(
          "inline-flex min-h-6 items-center gap-1 text-left font-semibold text-[color:var(--editor-color-text-default)]",
          "rounded-sm transition-colors duration-[var(--editor-motion-fast)] ease-[var(--editor-motion-ease)]",
          "hover:text-[color:var(--editor-color-accent)] focus-visible:bg-[var(--editor-color-surface-muted)] focus-visible:outline-none",
        )}
        style={{ fontSize: 12 }}
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronDown
          size={14}
          strokeWidth={1.75}
          aria-hidden="true"
          className={cx(
            "-ml-0.5 shrink-0 transition-transform duration-200 ease-[var(--editor-motion-ease)] motion-reduce:transition-none",
            open ? "rotate-0" : "-rotate-90",
          )}
        />
        {label}
      </button>

      <div
        id={panelId}
        data-state={open ? "open" : "closed"}
        aria-hidden={!open}
        inert={!open}
        className={cx(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-[var(--editor-motion-ease)] motion-reduce:transition-none",
          open ? "grid-rows-[1fr] opacity-100" : "pointer-events-none grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className={cx(
            "flex flex-col gap-2.5 pt-2.5",
          )}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
