// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from "react";

export function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-b border-slate-200 px-4 py-4">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">{title}</h3>
      {children}
    </section>
  );
}
