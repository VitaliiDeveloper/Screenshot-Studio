// SPDX-License-Identifier: Apache-2.0

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
  compactIconButton: `inline-flex size-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:pointer-events-none disabled:opacity-35 ${focusRing}`,
  compactAddButton: `inline-flex size-6 shrink-0 items-center justify-center rounded-md text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700 disabled:pointer-events-none disabled:opacity-35 ${focusRing}`,
  field: `h-8 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 shadow-sm transition-colors placeholder:text-slate-400 hover:border-slate-300 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/15`,
  textarea: `w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800 shadow-sm transition-colors placeholder:text-slate-400 hover:border-slate-300 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/15`,
};
