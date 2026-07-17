// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { Palette } from "lucide-react";
import { parseProject, THEME_ROLES, type Project } from "@screenshot-studio/core/model";
import type { Theme } from "@screenshot-studio/core/themes";
import { editorStore } from "../lib/editor-store";
import { withFlushedProject } from "../lib/debounced-save";
import { advanceProjectRevisionFromResponse } from "../lib/save-project";
import { DialogShell, EmptyResourceState, editorUi, StatusMessage } from "./editor-ui";

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.error ?? `Theme operation failed (${response.status})`));
  return body as Record<string, unknown>;
}

async function applyTheme(id: string, layoutId: string): Promise<Project> {
  const response = await fetch("/api/themes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, layoutId }),
  });
  const project = parseProject(await responseBody(response));
  advanceProjectRevisionFromResponse(response);
  return project;
}

export function ThemeManagerDialog({ onClose }: { onClose: () => void }) {
  const activeLayoutId = useStore(editorStore, (state) => state.activeLayoutId);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/themes", { signal: controller.signal })
      .then(responseBody)
      .then((body) => setThemes((body.themes ?? []) as Theme[]))
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
  const apply = async (id: string) => {
    if (!activeLayoutId) return;
    setApplying(id);
    setError(null);
    try {
      await withFlushedProject(async () => {
        editorStore.getState().replaceProject(await applyTheme(id, activeLayoutId));
      });
    } catch (applyError) {
      setError((applyError as Error).message);
    } finally {
      setApplying(null);
    }
  };
  return (
    <DialogShell
      title="Themes"
      description="Bake role colours and registered fonts into every screen."
      ariaLabel="Theme picker"
      closeLabel="Close theme picker"
      onClose={close}
      closeDisabled={applying !== null}
      widthClass="max-w-2xl"
    >
      {error ? <StatusMessage tone="error" className="mb-4">{error}</StatusMessage> : null}
      {loading ? <p className="text-xs text-slate-500">Loading themes…</p> : null}
      {!loading && themes.length === 0 ? (
        <EmptyResourceState
          icon={Palette}
          title="No themes yet"
          description="Add a strict theme definition to the project, then reopen this picker to apply it."
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
                <button className={`${editorUi.buttonPrimary} w-full sm:w-auto`} disabled={applying !== null} onClick={() => apply(theme.id)}>
                  {applying === theme.id ? "Applying…" : "Apply"}
                </button>
              </div>
          </section>
        ))}
      </div>
    </DialogShell>
  );
}
