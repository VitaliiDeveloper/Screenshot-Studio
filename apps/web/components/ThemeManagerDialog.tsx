"use client";

import { useEffect, useState } from "react";
import { parseProject, THEME_ROLES, type Project } from "@screenshot-studio/core/model";
import type { Theme } from "@screenshot-studio/core/themes";
import { editorStore } from "../lib/editor-store";
import { withFlushedProject } from "../lib/debounced-save";

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.error ?? `Theme operation failed (${response.status})`));
  return body as Record<string, unknown>;
}

async function applyTheme(id: string): Promise<Project> {
  const body = await responseBody(await fetch("/api/themes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  }));
  return parseProject(body);
}

export function ThemeManagerDialog({ onClose }: { onClose: () => void }) {
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
    setApplying(id);
    setError(null);
    try {
      await withFlushedProject(async () => {
        editorStore.getState().replaceProject(await applyTheme(id));
      });
    } catch (applyError) {
      setError((applyError as Error).message);
    } finally {
      setApplying(null);
    }
  };
  const buttonClass = "rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Theme picker"
        className="flex max-h-[85vh] w-[560px] flex-col gap-4 overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Themes</h2>
            <p className="text-xs text-neutral-500">Bake role colors and fonts into every screen.</p>
          </div>
          <button aria-label="Close theme picker" className={buttonClass} onClick={close}>Close</button>
        </div>

        {error ? <p role="alert" className="whitespace-pre-wrap text-xs text-red-600">{error}</p> : null}
        {loading ? <p className="text-xs text-neutral-500">Loading themes…</p> : null}
        {!loading && themes.length === 0 ? (
          <p className="rounded border border-dashed border-neutral-300 p-4 text-center text-xs text-neutral-500">
            No themes found in the project themes directory.
          </p>
        ) : null}

        <div className="flex flex-col gap-3">
          {themes.map((theme) => (
            <section key={theme.id} data-testid={`theme-row-${theme.id}`} className="rounded border border-neutral-200 p-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-sm font-semibold">{theme.name}</h3>
                    <span className="text-xs text-neutral-400">{theme.id}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    {THEME_ROLES.map((role) => (
                      <div key={role} className="text-[10px] text-neutral-500">
                        <span className="mb-1 block h-5 rounded border border-black/10" style={{ backgroundColor: theme.colors[role] }} />
                        {role}
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-neutral-500">
                    {THEME_ROLES.flatMap((role) => {
                      const font = theme.fonts[role];
                      return font ? [`${role}: ${font.family} ${font.weight}`] : [];
                    }).join(" · ") || "Keeps current fonts"}
                  </p>
                </div>
                <button className={buttonClass} disabled={applying !== null} onClick={() => apply(theme.id)}>
                  {applying === theme.id ? "Applying…" : "Apply"}
                </button>
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
