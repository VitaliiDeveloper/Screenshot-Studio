// SPDX-License-Identifier: Apache-2.0
"use client";

import React from "react";
import { Images, Languages, LayoutTemplate, PanelsTopLeft } from "lucide-react";
import { launcherExampleWorkflows, type LauncherExampleWorkflow } from "./launcher-examples";

const ICONS = {
  "isolated-project": PanelsTopLeft,
  "connected-deck": LayoutTemplate,
  "rtl-multi-locale": Languages,
  "imported-screenshots": Images,
} as const;

export function LauncherExamples({
  onSelect,
}: {
  onSelect(example: LauncherExampleWorkflow): void;
}) {
  return (
    <section aria-labelledby="starter-examples-title" className="mt-6 rounded-3xl border border-slate-200 bg-white/70 p-5 shadow-sm sm:p-6">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-700">Starter examples</p>
        <h2 id="starter-examples-title" className="mt-2 text-xl font-semibold text-slate-950">Choose a workflow, then keep editing the ordinary project.</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">These routes use current project templates, strict project import, or capture import. They do not create a demo-only model or a second renderer.</p>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {launcherExampleWorkflows.map((example) => {
          const Icon = ICONS[example.id];
          return (
            <article key={example.id} className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4">
              <span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-700"><Icon aria-hidden="true" className="size-5" /></span>
              <h3 className="mt-4 font-semibold text-slate-950">{example.title}</h3>
              <p className="mt-2 flex-1 text-xs leading-5 text-slate-600">{example.description}</p>
              <button type="button" className="mt-4 text-left text-sm font-semibold text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)] focus-visible:ring-offset-2" onClick={() => onSelect(example)}>{example.actionLabel} <span aria-hidden="true">→</span></button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
