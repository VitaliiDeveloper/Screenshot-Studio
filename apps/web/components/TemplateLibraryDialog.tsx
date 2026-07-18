// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { LayoutTemplate } from "lucide-react";
import { getScreen, parseProject } from "@screenshot-studio/core/model";
import type { ScreenTemplate } from "@screenshot-studio/core/templates";
import { editorStore } from "../lib/editor-store";
import { withFlushedProject } from "../lib/debounced-save";
import {
  advanceProjectRevisionFromResponse,
  projectRequestHeaders,
} from "../lib/save-project";
import { DialogShell, EmptyResourceState, editorUi, StatusMessage } from "./editor-ui";

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.error ?? `Template operation failed (${response.status})`));
  return body as Record<string, unknown>;
}

export function TemplateLibraryDialog({ onClose }: { onClose: () => void }) {
  const project = useStore(editorStore, (state) => state.project);
  const activeLayoutId = useStore(editorStore, (state) => state.activeLayoutId);
  const activeScreenId = useStore(editorStore, (state) => state.activeScreenId);
  const [templates, setTemplates] = useState<ScreenTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/templates", {
      headers: projectRequestHeaders(),
      signal: controller.signal,
    })
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

  const activeScreen = project && activeLayoutId && activeScreenId
    ? getScreen(project, activeLayoutId, activeScreenId)
    : null;
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
        const response = await fetch("/api/templates", {
          method: "POST",
          headers: projectRequestHeaders({
            conditional: true,
            headers: { "content-type": "application/json" },
          }),
          body: JSON.stringify({ id, locale: activeScreen.locale, layoutId: activeLayoutId }),
        });
        const body = await responseBody(response);
        const nextProject = parseProject(body.project);
        const screenId = String(body.screenId);
        advanceProjectRevisionFromResponse(response);
        editorStore.getState().replaceProject(nextProject);
        editorStore.getState().selectScreen(screenId);
      });
    } catch (createError) {
      setError((createError as Error).message);
    } finally {
      setCreating(null);
    }
  };
  return (
    <DialogShell
      title="Templates"
      description={`Create a screen in locale ${activeScreen?.locale ?? "—"} from a project template.`}
      ariaLabel="Template library"
      closeLabel="Close template library"
      onClose={close}
      closeDisabled={creating !== null}
      widthClass="max-w-2xl"
    >
      {error ? <StatusMessage tone="error" className="mb-4">{error}</StatusMessage> : null}
      {loading ? <p className="text-xs text-slate-500">Loading templates…</p> : null}
      {!loading && templates.length === 0 ? (
        <EmptyResourceState
          icon={LayoutTemplate}
          title="No templates yet"
          description="Add an exact screen layout to the project, then reopen this library to create a screen."
          path="templates/<id>.json"
        />
      ) : null}

      <div className="flex flex-col gap-3">
        {templates.map((template) => (
          <section key={template.id} data-testid={`template-row-${template.id}`} className={editorUi.resourceCard}>
              <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">{template.name}</h3>
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{template.id}</span>
                  </div>
                  {template.description ? <p className="mt-1 text-xs leading-5 text-slate-500">{template.description}</p> : null}
                  <p className="mt-2 text-xs font-medium text-slate-500">
                    {template.platform} / {template.device} · {template.artboard.width}×{template.artboard.height} · {template.elements.length} elements
                  </p>
                </div>
                <button className={`${editorUi.buttonPrimary} w-full sm:w-auto`} disabled={!activeScreen || creating !== null} onClick={() => create(template.id)}>
                  {creating === template.id ? "Creating…" : "Create screen"}
                </button>
              </div>
          </section>
        ))}
      </div>
    </DialogShell>
  );
}
