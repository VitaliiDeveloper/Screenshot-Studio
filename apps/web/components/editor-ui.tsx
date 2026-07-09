"use client";

import type { ReactNode } from "react";
import { FolderOpen, X, type LucideIcon } from "lucide-react";

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 focus-visible:ring-offset-2";

export const editorUi = {
  buttonBase: `inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-45 ${focusRing}`,
  buttonSecondary: `inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-45 ${focusRing}`,
  buttonPrimary: `inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:pointer-events-none disabled:opacity-45 ${focusRing}`,
  buttonGhost: `inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-45 ${focusRing}`,
  buttonDanger: `inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-xs font-medium text-red-600 shadow-sm transition-colors hover:bg-red-50 disabled:pointer-events-none disabled:opacity-45 ${focusRing}`,
  iconButton: `inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:pointer-events-none disabled:opacity-35 ${focusRing}`,
  field: `h-8 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 shadow-sm transition-colors placeholder:text-slate-400 hover:border-slate-300 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/15`,
  textarea: `w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800 shadow-sm transition-colors placeholder:text-slate-400 hover:border-slate-300 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/15`,
};

export function DialogShell({
  title,
  description,
  onClose,
  children,
  widthClass = "max-w-xl",
  bodyClassName,
  ariaLabel,
  closeLabel,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  widthClass?: string;
  bodyClassName?: string;
  ariaLabel?: string;
  closeLabel?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
        className={cx(
          "flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl border border-white/70 bg-white shadow-2xl shadow-slate-950/25",
          widthClass,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-slate-950">{title}</h2>
            {description ? <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p> : null}
          </div>
          <button aria-label={closeLabel ?? `Close ${title.toLowerCase()}`} className={editorUi.iconButton} onClick={onClose}>
            <X size={16} strokeWidth={1.8} />
          </button>
        </header>
        <div className={cx("overflow-y-auto p-5", bodyClassName)}>{children}</div>
      </div>
    </div>
  );
}

export function EmptyResourceState({
  title,
  description,
  path,
  icon: Icon = FolderOpen,
}: {
  title: string;
  description: string;
  path: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-6 py-8 text-center">
      <span className="mb-3 inline-flex size-10 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm ring-1 ring-slate-200">
        <Icon size={18} strokeWidth={1.7} />
      </span>
      <p className="text-sm font-medium text-slate-800">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">{description}</p>
      <code className="mt-3 rounded-md bg-slate-200/70 px-2 py-1 text-[11px] text-slate-600">{path}</code>
    </div>
  );
}
