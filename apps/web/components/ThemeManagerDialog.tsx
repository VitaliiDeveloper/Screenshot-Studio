// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { Palette } from "lucide-react";
import { parseProject, THEME_ROLES, type Project } from "@screenshot-studio/core/model";
import type { DesignPack, Theme } from "@screenshot-studio/core/themes";
import { editorStore } from "../lib/editor-store";
import { withFlushedProject } from "../lib/debounced-save";
import { projectJsonRequest } from "../lib/project-api-client";
import { DialogShell, EmptyResourceState, editorUi, StatusMessage } from "./editor-ui";

async function applyResource(id: string, layoutId: string, source: "built-in" | "project"): Promise<Project> {
  const { body } = await projectJsonRequest<Record<string, unknown>>("/api/themes", {
    method: "POST",
    conditional: true,
    advanceRevision: true,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, layoutId, source }),
    errorFallback: "Theme operation failed",
  });
  return parseProject(body);
}

export function ThemeManagerDialog({ onClose }: { onClose: () => void }) {
  const activeLayoutId = useStore(editorStore, (state) => state.activeLayoutId);
  const [builtIns, setBuiltIns] = useState<DesignPack[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void projectJsonRequest<Record<string, unknown>>("/api/themes", {
      signal: controller.signal,
      errorFallback: "Theme operation failed",
    })
      .then(({ body }) => {
        setBuiltIns((body.builtIns ?? []) as DesignPack[]);
        setThemes((body.themes ?? []) as Theme[]);
      })
      .catch((fetchError) => {
        if (!controller.signal.aborted) setError((fetchError as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const close = () => {
    setError(null);
    onClose();
  };
  const apply = async (id: string, source: "built-in" | "project") => {
    if (!activeLayoutId) return;
    const operationId = `${source}:${id}`;
    setApplying(operationId);
    setError(null);
    try {
      await withFlushedProject(async () => {
        editorStore.getState().replaceProject(await applyResource(id, activeLayoutId, source));
      });
    } catch (applyError) {
      setError((applyError as Error).message);
    } finally {
      setApplying(null);
    }
  };
  return (
    <DialogShell
      title="Design packs"
      description="Apply global read-only packs or project themes as ordinary editable literals."
      ariaLabel="Design pack picker"
      closeLabel="Close design pack picker"
      onClose={close}
      closeDisabled={applying !== null}
      widthClass="max-w-2xl"
    >
      {error ? <StatusMessage tone="error" className="mb-4">{error}</StatusMessage> : null}
      {loading ? <p className="text-xs text-slate-500">Loading design packs…</p> : null}
      {!loading ? <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Built-in packs</h3> : null}
      <div className="flex flex-col gap-3">
        {builtIns.map((pack) => {
          const operationId = `built-in:${pack.id}`;
          return (
            <section key={pack.id} data-testid={`design-pack-row-${pack.id}`} className={editorUi.resourceCard}>
              <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <h4 className="text-sm font-semibold text-slate-900">{pack.name}</h4>
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">Built in · read only</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{pack.description}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {THEME_ROLES.map((role) => (
                      <div key={role} className="text-[10px] font-medium text-slate-500">
                        <span className="mb-1 block h-6 rounded-lg border border-black/10 shadow-inner" style={{ backgroundColor: pack.palette[role] }} />
                        {role}
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    Type: {pack.typography.heading.family} {pack.typography.heading.weight} · Spacing: {pack.spacing.compact} / {pack.spacing.regular} / {pack.spacing.spacious}px
                  </p>
                </div>
                <button className={`${editorUi.buttonPrimary} w-full sm:w-auto`} disabled={applying !== null} onClick={() => apply(pack.id, "built-in")}>
                  {applying === operationId ? "Applying…" : "Apply pack"}
                </button>
              </div>
            </section>
          );
        })}
      </div>

      {!loading ? <h3 className="mb-2 mt-6 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Project themes</h3> : null}
      {!loading && themes.length === 0 ? (
        <EmptyResourceState
          icon={Palette}
          title="No project themes yet"
          description="Built-in packs above are always available. Add a strict theme definition for project-specific choices."
          path="themes/<id>.json"
        />
      ) : null}

      <div className="flex flex-col gap-3">
        {themes.map((theme) => (
          <section key={theme.id} data-testid={`theme-row-${theme.id}`} className={editorUi.resourceCard}>
              <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">{theme.name}</h3>
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{theme.id}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {THEME_ROLES.map((role) => (
                      <div key={role} className="text-[10px] font-medium text-slate-500">
                        <span className="mb-1 block h-6 rounded-lg border border-black/10 shadow-inner" style={{ backgroundColor: theme.colors[role] }} />
                        {role}
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    {THEME_ROLES.flatMap((role) => {
                      const font = theme.fonts[role];
                      return font ? [`${role}: ${font.family} ${font.weight}`] : [];
                    }).join(" · ") || "Keeps current fonts"}
                  </p>
                </div>
                <button className={`${editorUi.buttonPrimary} w-full sm:w-auto`} disabled={applying !== null} onClick={() => apply(theme.id, "project")}>
                  {applying === `project:${theme.id}` ? "Applying…" : "Apply"}
                </button>
              </div>
          </section>
        ))}
      </div>
    </DialogShell>
  );
}
