"use client";

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { getScreen, parseProject } from "@screenshot-studio/core/model";
import type { ScreenTemplate } from "@screenshot-studio/core/templates";
import { editorStore } from "../lib/editor-store";
import { withFlushedProject } from "../lib/debounced-save";

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.error ?? `Template operation failed (${response.status})`));
  return body as Record<string, unknown>;
}

export function TemplateLibraryDialog({ onClose }: { onClose: () => void }) {
  const project = useStore(editorStore, (state) => state.project);
  const activeScreenId = useStore(editorStore, (state) => state.activeScreenId);
  const [templates, setTemplates] = useState<ScreenTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/templates", { signal: controller.signal })
      .then(responseBody)
      .then((body) => setTemplates((body.templates ?? []) as ScreenTemplate[]))
      .catch((fetchError) => {
        if (!controller.signal.aborted) setError((fetchError as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const activeScreen = project && activeScreenId ? getScreen(project, activeScreenId) : null;
  const close = () => {
    setError(null);
    onClose();
  };
  const create = async (id: string) => {
    if (!activeScreen) return;
    setCreating(id);
    setError(null);
    try {
      await withFlushedProject(async () => {
        const body = await responseBody(await fetch("/api/templates", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, locale: activeScreen.locale }),
        }));
        const nextProject = parseProject(body.project);
        const screenId = String(body.screenId);
        editorStore.getState().replaceProject(nextProject);
        editorStore.getState().selectScreen(screenId);
      });
    } catch (createError) {
      setError((createError as Error).message);
    } finally {
      setCreating(null);
    }
  };
  const buttonClass = "rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Template library"
        className="flex max-h-[85vh] w-[560px] flex-col gap-4 overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Templates</h2>
            <p className="text-xs text-neutral-500">
              Create a screen in locale {activeScreen?.locale ?? "—"} from a project template.
            </p>
          </div>
          <button aria-label="Close template library" className={buttonClass} onClick={close}>Close</button>
        </div>

        {error ? <p role="alert" className="whitespace-pre-wrap text-xs text-red-600">{error}</p> : null}
        {loading ? <p className="text-xs text-neutral-500">Loading templates…</p> : null}
        {!loading && templates.length === 0 ? (
          <p className="rounded border border-dashed border-neutral-300 p-4 text-center text-xs text-neutral-500">
            No templates found in the project templates directory.
          </p>
        ) : null}

        <div className="flex flex-col gap-3">
          {templates.map((template) => (
            <section key={template.id} data-testid={`template-row-${template.id}`} className="rounded border border-neutral-200 p-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-sm font-semibold">{template.name}</h3>
                    <span className="text-xs text-neutral-400">{template.id}</span>
                  </div>
                  {template.description ? <p className="mt-1 text-xs text-neutral-500">{template.description}</p> : null}
                  <p className="mt-2 text-xs text-neutral-500">
                    {template.platform} / {template.device} · {template.artboard.width}×{template.artboard.height} · {template.elements.length} elements
                  </p>
                </div>
                <button className={buttonClass} disabled={!activeScreen || creating !== null} onClick={() => create(template.id)}>
                  {creating === template.id ? "Creating…" : "Create screen"}
                </button>
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
