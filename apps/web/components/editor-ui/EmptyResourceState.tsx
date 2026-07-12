// SPDX-License-Identifier: Apache-2.0
import { FolderOpen, type LucideIcon } from "lucide-react";

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
