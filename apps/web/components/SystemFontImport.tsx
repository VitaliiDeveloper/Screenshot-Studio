// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import { ArrowLeft, Search } from "lucide-react";
import type { FontAsset } from "@screenshot-studio/core/model";
import { projectJsonRequest } from "@web/lib/clients/project-api-client";
import { projectRequestHeaders } from "@web/lib/clients/save-project";
import { cx, editorUi, EmptyResourceState, StatusMessage } from "./editor-ui";
import {
  COVERAGE_LABELS,
  describeSystemImport,
  filterSystemFontFamilies,
  groupSystemFontFamilies,
  PREVIEW_SAMPLES,
  SYSTEM_FONT_LICENSE_WARNING,
  systemFaceDisabledReason,
  systemPreviewFamilyName,
  type PreviewStatus,
  type SystemFontCoverage,
  type SystemFontFace,
  type SystemFontFamily,
} from "./system-font-model";

const checkboxClass = "size-4 shrink-0 rounded border-[var(--editor-color-border)] accent-[var(--editor-color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)] focus-visible:ring-offset-1 disabled:cursor-not-allowed";
const badgeClass = "rounded-md bg-[var(--editor-color-surface-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[color:var(--editor-color-text-muted)]";
const coverageBadgeClass = "rounded-md bg-[var(--editor-color-accent-subtle)] px-1.5 py-0.5 text-[10px] font-medium text-[color:var(--editor-color-accent-strong)]";

function CoverageBadges({ coverage }: { coverage: SystemFontCoverage }) {
  const present = COVERAGE_LABELS.filter(([key]) => coverage[key]);
  return (
    <span className="flex flex-wrap gap-1" data-testid="system-font-coverage">
      {present.length === 0
        ? <span className={badgeClass}>No Latin, Cyrillic or Greek</span>
        : present.map(([key, label]) => <span key={key} className={coverageBadgeClass}>{label}</span>)}
    </span>
  );
}

function FacePreview({ face, status }: { face: SystemFontFace; status: PreviewStatus | undefined }) {
  if (face.unavailable) return null;
  if (status !== "ready") {
    return (
      <p role={status === "error" ? "alert" : "status"} className="mt-2 text-xs text-[color:var(--editor-color-text-secondary)]">
        {status === "error" ? "Preview could not load." : "Loading preview…"}
      </p>
    );
  }
  const style = { fontFamily: `"${systemPreviewFamilyName(face.id)}"` };
  return (
    <div className="mt-2 flex flex-col gap-1" data-testid={`system-font-preview-${face.weight}`}>
      {face.coverage.latin
        ? <p lang="en" style={style} className="truncate text-xl text-[color:var(--editor-color-text-strong)]">{PREVIEW_SAMPLES.latin}</p>
        : <p className="text-xs text-[color:var(--editor-color-text-secondary)]">No Latin glyphs to preview.</p>}
      {face.coverage.cyrillic
        ? <p lang="uk" style={style} className="truncate text-xl text-[color:var(--editor-color-text-strong)]">{PREVIEW_SAMPLES.cyrillic}</p>
        : <p className="text-xs text-[color:var(--editor-color-text-secondary)]">No Cyrillic glyphs to preview.</p>}
    </div>
  );
}

export interface SystemFontImportViewProps {
  status: "loading" | "ready" | "error";
  loadError: string | null;
  totalFamilies: number;
  families: SystemFontFamily[];
  query: string;
  onQuery(query: string): void;
  selectedFamily: SystemFontFamily | null;
  onSelectFamily(name: string): void;
  registered: readonly FontAsset[];
  selectedIds: ReadonlySet<string>;
  onToggle(id: string): void;
  previews: Readonly<Record<string, PreviewStatus>>;
  busy: boolean;
  outcome: { tone: "success" | "error"; text: string } | null;
  onImport(): void;
  onBack(): void;
  searchRef?: Ref<HTMLInputElement>;
}

export function SystemFontImportView({
  status, loadError, totalFamilies, families, query, onQuery, selectedFamily, onSelectFamily,
  registered, selectedIds, onToggle, previews, busy, outcome, onImport, onBack, searchRef,
}: SystemFontImportViewProps) {
  const chosen = selectedFamily?.faces.filter((face) => selectedIds.has(face.id)).length ?? 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <button type="button" className={editorUi.buttonSecondary} disabled={busy} onClick={onBack}>
          <ArrowLeft size={14} strokeWidth={1.8} />
          Back to fonts
        </button>
        <p className="min-w-0 text-xs leading-5 text-[color:var(--editor-color-text-secondary)]">
          Copies the chosen files into the project as uploaded fonts. Rendering never depends on this computer.
        </p>
      </div>

      {status === "loading" && (
        <p role="status" className="py-8 text-center text-xs text-[color:var(--editor-color-text-secondary)]">Scanning installed fonts…</p>
      )}
      {status === "error" && <StatusMessage tone="error" className="whitespace-pre-wrap">{loadError}</StatusMessage>}
      {status === "ready" && totalFamilies === 0 && (
        <EmptyResourceState title="No installed fonts found" description="No font files were found in this computer's font folders." />
      )}

      {status === "ready" && totalFamilies > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[14rem_minmax(0,1fr)]">
          <section className="flex min-w-0 flex-col gap-2" aria-label="Installed font families">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--editor-color-text-subtle)]" size={15} strokeWidth={1.9} />
              <input
                ref={searchRef}
                type="search"
                aria-label="Search installed fonts"
                placeholder="Search installed fonts…"
                value={query}
                onChange={(event) => onQuery(event.target.value)}
                className={cx(editorUi.field, "pl-9")}
              />
            </div>
            <p role="status" className="text-[11px] text-[color:var(--editor-color-text-secondary)]">
              {families.length} of {totalFamilies} families
            </p>
            <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto" data-testid="system-font-families">
              {families.map((family) => (
                <li key={family.name}>
                  <button
                    type="button"
                    aria-current={selectedFamily?.name === family.name ? "true" : undefined}
                    disabled={busy}
                    onClick={() => onSelectFamily(family.name)}
                    className={cx(
                      editorUi.buttonBase,
                      "w-full flex-col items-start gap-1 py-1.5 text-left",
                      selectedFamily?.name === family.name ? editorUi.buttonGhostActive : editorUi.buttonGhost,
                    )}
                  >
                    <span className="max-w-full truncate font-medium">{family.name}</span>
                    <CoverageBadges coverage={family.coverage} />
                  </button>
                </li>
              ))}
              {families.length === 0 && (
                <li className="px-1 py-3 text-xs text-[color:var(--editor-color-text-secondary)]">No family matches “{query.trim()}”.</li>
              )}
            </ul>
          </section>

          <section className="flex min-w-0 flex-col gap-3" aria-label="Selected family">
            {!selectedFamily ? (
              <EmptyResourceState title="Choose a family" description="Pick an installed family to preview its weights and select the ones to import." />
            ) : (
              <>
                <h3 className={editorUi.sectionLabel}>{selectedFamily.name}</h3>
                {selectedFamily.hasSystemFaces && (
                  <StatusMessage tone="warning" role="status">{SYSTEM_FONT_LICENSE_WARNING}</StatusMessage>
                )}
                <ul className="flex flex-col gap-2">
                  {selectedFamily.faces.map((face) => {
                    const reason = systemFaceDisabledReason(face, registered);
                    const reasonId = `system-font-reason-${face.id}`;
                    return (
                      <li key={face.id} data-testid={`system-font-face-${face.weight ?? "unknown"}`} className={cx(editorUi.resourceCard, reason && "opacity-80")}>
                        <label className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            className={checkboxClass}
                            checked={selectedIds.has(face.id)}
                            disabled={reason !== undefined || busy}
                            aria-describedby={reason ? reasonId : undefined}
                            onChange={() => onToggle(face.id)}
                          />
                          <strong className="font-medium tabular-nums text-[color:var(--editor-color-text-strong)]">
                            {face.weight ?? "Unknown weight"}
                          </strong>
                          {face.style && <span className="text-[color:var(--editor-color-text-muted)]">{face.style}</span>}
                          <span className={badgeClass}>{face.source === "system" ? "System" : "User"}</span>
                          <span className={cx(badgeClass, "uppercase")}>{face.format}</span>
                        </label>
                        <div className="mt-1"><CoverageBadges coverage={face.coverage} /></div>
                        {reason && <p id={reasonId} className="mt-2 text-xs text-[color:var(--editor-color-text-secondary)]">{reason}</p>}
                        <FacePreview face={face} status={previews[face.id]} />
                      </li>
                    );
                  })}
                </ul>
                <div className="flex justify-end">
                  <button type="button" className={editorUi.buttonPrimary} disabled={busy || chosen === 0} onClick={onImport}>
                    {busy ? "Importing…" : chosen === 0 ? "Import" : `Import ${chosen} ${chosen === 1 ? "weight" : "weights"}`}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {outcome && (
        outcome.tone === "error"
          ? <StatusMessage tone="error" className="whitespace-pre-wrap">{outcome.text}</StatusMessage>
          : <p role="status" className="text-xs font-medium text-[color:var(--editor-color-accent-strong)]">{outcome.text}</p>
      )}
    </div>
  );
}

export function SystemFontImport({
  registered,
  onImportFace,
  onBusyChange,
  onBack,
}: {
  registered: readonly FontAsset[];
  onImportFace(id: string): Promise<void>;
  onBusyChange(busy: boolean): void;
  onBack(): void;
}) {
  const [faces, setFaces] = useState<SystemFontFace[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [previews, setPreviews] = useState<Record<string, PreviewStatus>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SystemFontImportViewProps["outcome"]>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const families = useMemo(() => groupSystemFontFamilies(faces ?? []), [faces]);
  const visible = useMemo(() => filterSystemFontFamilies(families, query), [families, query]);
  const selectedFamily = families.find((family) => family.name === selectedName) ?? null;

  useEffect(() => {
    let cancelled = false;
    void projectJsonRequest<{ fonts?: unknown }>("/api/system-fonts", { errorFallback: "Installed font scan failed" })
      .then(({ body }) => {
        if (!Array.isArray(body.fonts)) throw new Error("Installed font scan returned an invalid response");
        if (!cancelled) setFaces(body.fonts as SystemFontFace[]);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError((error as Error).message);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [faces]);

  useEffect(() => {
    if (!selectedFamily) return undefined;
    let cancelled = false;
    const loaded: FontFace[] = [];
    for (const face of selectedFamily.faces.filter((candidate) => !candidate.unavailable)) {
      void (async () => {
        const response = await fetch(`/api/system-fonts/preview?id=${encodeURIComponent(face.id)}`, {
          headers: projectRequestHeaders(),
        });
        if (!response.ok) throw new Error(`Preview request failed (${response.status})`);
        const preview = new FontFace(systemPreviewFamilyName(face.id), await response.arrayBuffer());
        await preview.load();
        if (cancelled) return;
        document.fonts.add(preview);
        loaded.push(preview);
        setPreviews((current) => ({ ...current, [face.id]: "ready" }));
      })().catch(() => {
        if (!cancelled) setPreviews((current) => ({ ...current, [face.id]: "error" }));
      });
    }
    return () => {
      cancelled = true;
      for (const preview of loaded) document.fonts.delete(preview);
      setPreviews({});
    };
  }, [selectedFamily]);

  const selectFamily = (name: string) => {
    setSelectedName(name);
    setSelectedIds(new Set());
    setOutcome(null);
  };

  const toggle = (id: string) => setSelectedIds((current) => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  const importSelected = async () => {
    if (!selectedFamily) return;
    const queue = selectedFamily.faces.filter((face) => selectedIds.has(face.id));
    const imported: SystemFontFace[] = [];
    setBusy(true);
    onBusyChange(true);
    setOutcome(null);
    try {
      for (const face of queue) {
        await onImportFace(face.id);
        imported.push(face);
      }
      setOutcome(describeSystemImport(imported, []));
    } catch (error) {
      setOutcome(describeSystemImport(imported, queue.slice(imported.length), (error as Error).message));
    } finally {
      setSelectedIds((current) => new Set([...current].filter((id) => !imported.some((face) => face.id === id))));
      setBusy(false);
      onBusyChange(false);
    }
  };

  return (
    <SystemFontImportView
      status={faces ? "ready" : loadError ? "error" : "loading"}
      loadError={loadError}
      totalFamilies={families.length}
      families={visible}
      query={query}
      onQuery={setQuery}
      selectedFamily={selectedFamily}
      onSelectFamily={selectFamily}
      registered={registered}
      selectedIds={selectedIds}
      onToggle={toggle}
      previews={previews}
      busy={busy}
      outcome={outcome}
      onImport={() => void importSelected()}
      onBack={onBack}
      searchRef={searchRef}
    />
  );
}
