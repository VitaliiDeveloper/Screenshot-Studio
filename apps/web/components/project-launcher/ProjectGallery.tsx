// SPDX-License-Identifier: Apache-2.0
"use client";

import React, { useEffect, useLayoutEffect, useRef } from "react";
import { CircleCheck, Download, Ellipsis, Info, LoaderCircle, Trash2 } from "lucide-react";
import {
  DEFAULT_STORE_SPECS,
  destinationLabel,
  listOutputFamilies,
  type StoreSpecs,
} from "@screenshot-studio/core/export";
import type { ProjectLibraryEntry } from "@web/lib/clients/project-library-client";
import { cx, editorUi } from "@web/components/editor-ui/styles";
import { ProjectPreviewStrip } from "./ProjectPreviewStrip";
import {
  neighbourEntryId,
  projectCardExitMs,
  projectCardSlideEasing,
  projectCardSlideMs,
  type ProjectLibraryNotice,
} from "./project-action-notice";

export interface ProjectLibraryAction {
  entryId: string;
  kind: "opening" | "details" | "archive" | "deleting" | "removing";
}

export type ProjectLibraryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: readonly ProjectLibraryEntry[] };

export function closeProjectActionsMenu(
  trigger: Pick<HTMLButtonElement, "closest">,
): void {
  const menu = trigger.closest("details") as HTMLDetailsElement | null;
  if (!menu) return;
  menu.open = false;
  menu.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
}

function projectOutputLabel(value: string, specs: StoreSpecs): string {
  const [platform, device] = value.split(":");
  if (!platform) return "Project";
  if (!device) return destinationLabel(platform, specs);
  return listOutputFamilies(specs).find(({ key }) => key === `${platform}/${device}`)?.label
    ?? destinationLabel(platform, specs);
}

function plural(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

export function ProjectGallery({
  entries,
  specs = DEFAULT_STORE_SPECS,
  action,
  actionError,
  actionNotice,
  leavingEntryId = null,
  visibleOpeningEntryId,
  onOpen,
  onOpenDetails,
  onExportArchive,
  onDeleteProject,
  onRemoveRecent,
}: {
  entries: readonly ProjectLibraryEntry[];
  specs?: StoreSpecs;
  action: ProjectLibraryAction | null;
  actionError: string | null;
  actionNotice: ProjectLibraryNotice | null;
  leavingEntryId?: string | null;
  visibleOpeningEntryId: string | null;
  onOpen(entryId: string): void;
  onOpenDetails(entryId: string): void;
  onExportArchive(entryId: string): void;
  onDeleteProject(entryId: string): void;
  onRemoveRecent(entryId: string): void;
}) {
  const galleryRef = useRef<HTMLElement>(null);
  const cardPositionsRef = useRef(new Map<string, { left: number; top: number }>());

  // FLIP: a card that moved within its row slides home from its old position; a card that changed
  // rows fades in at its new slot instead of flying diagonally across the grid. The global
  // reduced-motion rule shortens both transitions to an instant change.
  useLayoutEffect(() => {
    const positions = new Map<string, { left: number; top: number }>();
    for (const card of galleryRef.current?.querySelectorAll<HTMLElement>("li[data-entry-id]") ?? []) {
      const entryId = card.dataset.entryId!;
      const position = { left: card.offsetLeft, top: card.offsetTop };
      positions.set(entryId, position);
      const previous = cardPositionsRef.current.get(entryId);
      if (!previous || (previous.left === position.left && previous.top === position.top)) continue;
      const property = previous.top === position.top ? "transform" : "opacity";
      card.style.transition = "none";
      if (property === "transform") card.style.transform = `translateX(${previous.left - position.left}px)`;
      else card.style.opacity = "0";
      void card.offsetWidth;
      card.style.transition = `${property} ${projectCardSlideMs}ms ${projectCardSlideEasing}`;
      card.style.transform = "";
      card.style.opacity = "";
      card.addEventListener("transitionend", () => { card.style.transition = ""; }, { once: true });
    }
    cardPositionsRef.current = positions;
  }, [entries, leavingEntryId]);

  // Passive, so it runs after a closing dialog has restored focus into the leaving card.
  useEffect(() => {
    if (!leavingEntryId) return;
    const gallery = galleryRef.current;
    const active = document.activeElement;
    const leavingCard = gallery?.querySelector(`li[data-entry-id="${CSS.escape(leavingEntryId)}"]`);
    if (active && active !== document.body && !leavingCard?.contains(active)) return;
    const targetId = neighbourEntryId(entries, leavingEntryId);
    if (!targetId) return;
    gallery?.querySelector(`li[data-entry-id="${CSS.escape(targetId)}"]`)
      ?.querySelector<HTMLElement>("button:not(:disabled), summary")
      ?.focus({ preventScroll: true });
    // Only the start of a leave moves focus; later entry refreshes must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leavingEntryId]);

  useEffect(() => {
    const dismissOutside = (event: PointerEvent) => {
      const gallery = galleryRef.current;
      if (!gallery || !(event.target instanceof Node)) return;
      for (const menu of gallery.querySelectorAll<HTMLDetailsElement>("details[data-project-actions][open]")) {
        if (!menu.contains(event.target)) menu.open = false;
      }
    };
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const menus = galleryRef.current?.querySelectorAll<HTMLDetailsElement>(
        "details[data-project-actions][open]",
      );
      if (!menus?.length) return;
      const menu = menus.item(menus.length - 1);
      if (!menu) return;
      menu.open = false;
      menu.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissWithEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissWithEscape);
    };
  }, []);

  return (
    <section ref={galleryRef} aria-labelledby="recent-projects-title">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className={editorUi.sectionLabel}>Your workspace</p>
          <h2 id="recent-projects-title" className="mt-2 text-2xl font-semibold tracking-tight text-[color:var(--editor-color-text-strong)]">Recent projects</h2>
        </div>
        <p className="hidden text-sm text-[color:var(--editor-color-text-secondary)] sm:block">Select a project to continue editing.</p>
      </div>
      {actionError ? <p role="alert" className={`mb-5 ${editorUi.statusError}`}>{actionError}</p> : null}
      <ul className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {entries.map((entry, index) => {
          const pending = action?.entryId === entry.entryId;
          const archivePending = pending && action?.kind === "archive";
          const cardNotice = actionNotice?.entryId === entry.entryId ? actionNotice : null;
          const cardStatus = visibleOpeningEntryId === entry.entryId
            ? { key: "opening", message: "Opening workspace…", success: false, motion: "visible" as const }
            : archivePending
              ? { key: "archive", message: "Preparing archive…", success: false, motion: "visible" as const }
              : cardNotice
                ? { key: "archive-ready", ...cardNotice, success: true }
                : null;
          const unavailable = entry.availability === "unavailable";
          const cardContent = <>
            <ProjectPreviewStrip entry={entry} />
            {unavailable ? (
              // Pinned over the preview's top edge so the card body matches available cards.
              <span className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 border-b border-[var(--editor-color-warning-border)] bg-[var(--editor-color-warning-surface)] px-3 py-2 text-xs text-[color:var(--editor-color-warning-text-strong)]">
                <span className="line-clamp-2 min-w-0 text-left leading-5"><strong>Source unavailable.</strong> Reopen or import the source to continue.</span>
                <button
                  type="button"
                  disabled={Boolean(action)}
                  className={editorUi.rowIconButtonDanger}
                  aria-label={`Remove ${entry.name} from recents`}
                  title="Removes this recent item only; project files stay untouched."
                  onClick={() => onRemoveRecent(entry.entryId)}
                >
                  {pending && action?.kind === "removing"
                    ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
                    : <Trash2 aria-hidden="true" className="size-4" />}
                </button>
              </span>
            ) : null}
            <span className={cx("block p-5", !unavailable && "pr-14")}>
              <span className="flex items-center gap-2">
                <span className="truncate text-base font-semibold text-[color:var(--editor-color-text-strong)]">{entry.name}</span>
                {index === 0 ? <span className="rounded-full bg-[var(--editor-color-accent-subtle)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--editor-color-accent-text-strong)]">Most recent</span> : null}
              </span>
              <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[color:var(--editor-color-text-secondary)]">
                {[...new Set(entry.platforms.map((value) => projectOutputLabel(value, specs)))].join(" · ") || (unavailable ? "Local project" : "Project")}
                <span aria-hidden="true">·</span>
                <span>{plural(entry.screenCount, "screen")}</span>
                <span aria-hidden="true">·</span>
                <span>{plural(entry.layoutCount, "layout")}</span>
              </span>
              <time className="mt-3 block text-xs text-[color:var(--editor-color-text-secondary)]" dateTime={entry.lastOpenedAt}>Updated {entry.lastOpenedAt.slice(0, 10)}</time>
            </span>
          </>;
          const leaving = leavingEntryId === entry.entryId;
          return (
            <li key={entry.entryId} data-entry-id={entry.entryId} data-motion={leaving ? "leaving" : undefined} inert={leaving || undefined} style={leaving ? { animationDuration: `${projectCardExitMs}ms` } : undefined} aria-busy={pending || undefined} className={cx(
              "project-card group relative overflow-hidden rounded-2xl border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] shadow-sm transition-[border-color,box-shadow,transform] duration-150",
              !unavailable && "hover:-translate-y-0.5 hover:border-[var(--editor-color-accent-border-strong)] hover:shadow-lg motion-reduce:transform-none",
            )}>
              {unavailable ? (
                <div className="block w-full text-left">{cardContent}</div>
              ) : (
                <button
                  type="button"
                  aria-label={`Open ${entry.name} in Workspace`}
                  disabled={Boolean(action)}
                  className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--editor-color-focus)] disabled:cursor-not-allowed"
                  onClick={() => onOpen(entry.entryId)}
                >
                  {cardContent}
                </button>
              )}
              {!unavailable ? <details data-project-actions className="absolute bottom-4 right-4">
                <summary aria-label={`More actions for ${entry.name}`} className={cx(editorUi.iconButton, "list-none cursor-pointer bg-[var(--editor-color-surface)] [&::-webkit-details-marker]:hidden")}><Ellipsis aria-hidden="true" className="size-4" /></summary>
                <div className="absolute bottom-11 right-0 z-20 min-w-48 rounded-xl border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] p-1.5 shadow-xl">
                  <button type="button" disabled={Boolean(action)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[color:var(--editor-color-text-default)] hover:bg-[var(--editor-color-surface-muted)] disabled:opacity-50" onClick={(event) => { closeProjectActionsMenu(event.currentTarget); onOpenDetails(entry.entryId); }}><Info aria-hidden="true" className="size-4" />Project details</button>
                  {entry.sourceKind === "managed-project" ? <>
                    <button type="button" disabled={Boolean(action)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[color:var(--editor-color-text-default)] hover:bg-[var(--editor-color-surface-muted)] disabled:opacity-50" onClick={(event) => { closeProjectActionsMenu(event.currentTarget); onExportArchive(entry.entryId); }}><Download aria-hidden="true" className="size-4" />Export archive</button>
                    <div role="separator" className="my-1 border-t border-[var(--editor-color-border)]" />
                    <button type="button" disabled={Boolean(action)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[color:var(--editor-color-danger-text)] hover:bg-[var(--editor-color-danger-surface)] disabled:opacity-50" onClick={(event) => { closeProjectActionsMenu(event.currentTarget); onDeleteProject(entry.entryId); }}><Trash2 aria-hidden="true" className="size-4" />Delete project…</button>
                  </> : null}
                  {entry.sourceKind === "local-file" ? <button type="button" disabled={Boolean(action)} className="w-full rounded-lg px-3 py-2 text-left text-sm text-[color:var(--editor-color-danger-text)] hover:bg-[var(--editor-color-danger-surface)] disabled:opacity-50" title="Removes history only; project files stay untouched." onClick={(event) => { closeProjectActionsMenu(event.currentTarget); onRemoveRecent(entry.entryId); }}>Remove from recents</button> : null}
                </div>
              </details> : null}
              {cardStatus ? <span key={cardStatus.key} data-motion={cardStatus.motion} className="project-card-action-status pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-2xl bg-[var(--editor-color-surface-translucent)] backdrop-blur-[1px]"><span role="status" className={cx("inline-flex items-center gap-2 rounded-full border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] px-3 py-2 text-xs font-medium shadow-sm", cardStatus.success ? "text-[color:var(--editor-color-success-text)]" : "text-[color:var(--editor-color-accent-text-strong)]")}>{cardStatus.success ? <CircleCheck aria-hidden="true" className="size-4" /> : <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />}{cardStatus.message}</span></span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
