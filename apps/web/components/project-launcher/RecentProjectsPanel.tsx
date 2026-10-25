// SPDX-License-Identifier: Apache-2.0
"use client";

import React, { type Ref } from "react";
import { Clock3, LoaderCircle, RotateCcw, X } from "lucide-react";
import type { RecentProjectSummary } from "@web/lib/clients/recent-projects-client";
import { editorUi } from "@web/components/editor-ui/styles";

export type RecentProjectsPanelState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: readonly RecentProjectSummary[] };

export interface RecentProjectAction {
  recentId: string;
  kind: "opening" | "removing";
}

export function RecentProjectsPanel({
  state,
  action,
  actionError,
  headingRef,
  onRetry,
  onOpen,
  onRemove,
}: {
  state: RecentProjectsPanelState;
  action: RecentProjectAction | null;
  actionError: string | null;
  headingRef?: Ref<HTMLHeadingElement>;
  onRetry(): void;
  onOpen(recentId: string): void;
  onRemove(recentId: string): void;
}) {
  return (
    <section aria-labelledby="recent-projects-title" className="rounded-3xl border border-[var(--editor-color-border)] bg-[var(--editor-color-surface-translucent)] p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--editor-color-surface-muted)] text-[color:var(--editor-color-text-muted)]"><Clock3 aria-hidden="true" className="size-5" /></span>
        <div>
          <h2 ref={headingRef} tabIndex={-1} id="recent-projects-title" className="font-semibold text-[color:var(--editor-color-text-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)]">Recent projects</h2>
          <p className="mt-1 text-sm leading-6 text-[color:var(--editor-color-text-secondary)]">Application history only. Project files and managed storage keep their own lifecycle.</p>
        </div>
      </div>

      {state.status === "loading" ? (
        <p role="status" className="mt-5 flex items-center gap-2 text-sm text-[color:var(--editor-color-text-secondary)]"><LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> Loading recent projects…</p>
      ) : null}

      {state.status === "error" ? (
        <div role="alert" className={`mt-5 ${editorUi.statusError}`}>
          <p>{state.message}</p>
          <button type="button" className={`mt-3 ${editorUi.buttonSecondary}`} onClick={onRetry}><RotateCcw aria-hidden="true" className="size-4" /> Retry recent projects</button>
        </div>
      ) : null}

      {state.status === "ready" && state.entries.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-[var(--editor-color-border-strong)] bg-[var(--editor-color-surface-subtle-translucent)] px-4 py-5">
          <p className="text-sm font-semibold text-[color:var(--editor-color-text-strong)]">No recent projects yet.</p>
          <p className="mt-1 text-sm leading-6 text-[color:var(--editor-color-text-muted)]">Create a project, import a managed copy, or open a configured local source. Successful opens appear here after restart.</p>
        </div>
      ) : null}

      {state.status === "ready" && state.entries.length > 0 ? (
        <ul className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {state.entries.map((entry) => {
            const pending = action?.recentId === entry.recentId;
            const unavailable = entry.availability === "unavailable";
            return (
              <li key={entry.recentId} aria-busy={pending || undefined} className="flex min-w-0 flex-col rounded-2xl border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] p-4">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-[color:var(--editor-color-text-strong)]">{entry.name}</p>
                  <p className="mt-1 text-xs text-[color:var(--editor-color-text-secondary)]">{entry.sourceKind === "managed-project" ? "Managed project" : "Local project"} · <time dateTime={entry.lastOpenedAt}>{entry.lastOpenedAt.slice(0, 10)}</time></p>
                </div>
                {unavailable ? <div className="mt-3 rounded-xl bg-[var(--editor-color-warning-surface)] px-3 py-2 text-xs leading-5 text-[color:var(--editor-color-warning-text-strong)]"><strong>Source unavailable.</strong> Reopen the source outside the browser or import it again to refresh this entry.</div> : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" className={editorUi.buttonPrimary} disabled={Boolean(action) || unavailable} onClick={() => onOpen(entry.recentId)}>
                    {pending && action.kind === "opening" ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}
                    {pending && action.kind === "opening" ? "Opening…" : "Open project"}
                  </button>
                  <button type="button" className={editorUi.buttonSecondary} disabled={Boolean(action)} title="This removes history only; it does not close or delete the project." onClick={() => onRemove(entry.recentId)}>
                    {pending && action.kind === "removing" ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : <X aria-hidden="true" className="size-4" />}
                    {pending && action.kind === "removing" ? "Removing…" : "Remove from recents"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {actionError ? <p role="alert" className={`mt-4 ${editorUi.statusError}`}>{actionError}</p> : null}
    </section>
  );
}
