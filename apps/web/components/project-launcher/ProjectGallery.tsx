// SPDX-License-Identifier: Apache-2.0
"use client";

import React from "react";
import { Download, Ellipsis, LoaderCircle, Trash2 } from "lucide-react";
import type { ProjectLibraryEntry } from "../../lib/project-library-client";
import { cx, editorUi } from "../editor-ui/styles";
import { ProjectPreviewStrip } from "./ProjectPreviewStrip";

export interface ProjectLibraryAction {
  entryId: string;
  kind: "opening" | "details" | "archive" | "deleting" | "removing";
}

export type ProjectLibraryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: readonly ProjectLibraryEntry[] };

function platformLabel(value: string): string {
  const [, device = value] = value.split(":");
  const labels: Record<string, string> = {
    iphone: "iPhone",
    ipad: "iPad",
    mac: "Mac",
    "android-phone": "Android",
    "windows-desktop": "Windows",
    tv: "TV",
    watch: "Watch",
  };
  return labels[device] ?? device.replaceAll("-", " ");
}

function plural(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

export function ProjectGallery({
  entries,
  action,
  actionError,
  visibleOpeningEntryId,
  onOpen,
  onOpenDetails,
  onExportArchive,
  onDeleteProject,
  onRemoveRecent,
}: {
  entries: readonly ProjectLibraryEntry[];
  action: ProjectLibraryAction | null;
  actionError: string | null;
  visibleOpeningEntryId: string | null;
  onOpen(entryId: string): void;
  onOpenDetails(entryId: string): void;
  onExportArchive(entryId: string): void;
  onDeleteProject(entryId: string): void;
  onRemoveRecent(entryId: string): void;
}) {
  return (
    <section aria-labelledby="recent-projects-title">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className={editorUi.sectionLabel}>Your workspace</p>
          <h2 id="recent-projects-title" className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Recent projects</h2>
        </div>
        <p className="hidden text-sm text-slate-500 sm:block">Select a project to continue editing.</p>
      </div>
      <ul className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {entries.map((entry, index) => {
          const pending = action?.entryId === entry.entryId;
          const unavailable = entry.availability === "unavailable";
          return (
            <li key={entry.entryId} aria-busy={pending || undefined} className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-lg motion-reduce:transform-none">
              <button
                type="button"
                aria-label={`Open ${entry.name} in Workspace`}
                disabled={Boolean(action) || unavailable}
                className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--editor-color-focus)] disabled:cursor-not-allowed"
                onClick={() => onOpen(entry.entryId)}
              >
                <ProjectPreviewStrip entry={entry} />
                <span className="block p-5 pr-14">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-base font-semibold text-slate-950">{entry.name}</span>
                    {index === 0 ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Most recent</span> : null}
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                    {entry.platforms.map(platformLabel).join(" · ") || (unavailable ? "Local project" : "Project")}
                    <span aria-hidden="true">·</span>
                    <span>{plural(entry.screenCount, "screen")}</span>
                    <span aria-hidden="true">·</span>
                    <span>{plural(entry.layoutCount, "layout")}</span>
                  </span>
                  <time className="mt-3 block text-xs text-slate-500" dateTime={entry.lastOpenedAt}>Updated {entry.lastOpenedAt.slice(0, 10)}</time>
                  {unavailable ? <span className="mt-3 block rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950"><strong>Source unavailable.</strong> Reopen or import the source to continue.</span> : null}
                </span>
              </button>
              <details className="absolute bottom-4 right-4">
                <summary aria-label={`More actions for ${entry.name}`} className={cx(editorUi.iconButton, "list-none cursor-pointer bg-white [&::-webkit-details-marker]:hidden")}><Ellipsis aria-hidden="true" className="size-4" /></summary>
                <div className="absolute bottom-11 right-0 z-20 min-w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
                  {!unavailable ? <button type="button" disabled={Boolean(action)} className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50" onClick={() => onOpenDetails(entry.entryId)}>Project details</button> : null}
                  {entry.sourceKind === "managed-project" ? <>
                    <button type="button" disabled={Boolean(action)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50" onClick={() => onExportArchive(entry.entryId)}><Download aria-hidden="true" className="size-4" />Export archive</button>
                    <div role="separator" className="my-1 border-t border-slate-200" />
                    <button type="button" disabled={Boolean(action)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 disabled:opacity-50" onClick={() => onDeleteProject(entry.entryId)}><Trash2 aria-hidden="true" className="size-4" />Delete project…</button>
                  </> : null}
                  {entry.sourceKind === "local-file" ? <button type="button" disabled={Boolean(action)} className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 disabled:opacity-50" title="Removes history only; project files stay untouched." onClick={() => onRemoveRecent(entry.entryId)}>Remove from recents</button> : null}
                </div>
              </details>
              {visibleOpeningEntryId === entry.entryId ? <span className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-2xl bg-white/80 backdrop-blur-[1px]"><span role="status" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-blue-700 shadow-sm"><LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />Opening workspace…</span></span> : null}
            </li>
          );
        })}
      </ul>
      {actionError ? <p role="alert" className={`mt-5 ${editorUi.statusError}`}>{actionError}</p> : null}
    </section>
  );
}
