// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { LayoutTemplate } from "lucide-react";
import { getScreen, parseProject } from "@screenshot-studio/core/model";
import type { ScreenTemplate } from "@screenshot-studio/core/templates";
import { editorStore } from "@web/lib/editor-store";
import { withFlushedProject } from "@web/lib/debounced-save";
import { projectJsonRequest } from "@web/lib/project-api-client";
import { DialogShell, EmptyResourceState, editorUi, StatusMessage } from "./editor-ui";

export function TemplateLibraryDialog({ onClose }: { onClose: () => void }) {
  const project = useStore(editorStore, (state) => state.project);
  const activeLayoutId = useStore(editorStore, (state) => state.activeLayoutId);
  const activeScreenId = useStore(editorStore, (state) => state.activeScreenId);
  const [templates, setTemplates] = useState<ScreenTemplate[]>([]);
  const [builtIns, setBuiltIns] = useState<ScreenTemplate[]>([]);
  const [tab, setTab] = useState<"built-in" | "project">("built-in");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void projectJsonRequest<Record<string, unknown>>("/api/templates", {
      signal: controller.signal,
      errorFallback: "Template operation failed",
    })
      .then(({ body }) => {
        setTemplates((body.templates ?? []) as ScreenTemplate[]);
        setBuiltIns((body.builtIns ?? []) as ScreenTemplate[]);
      })
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
  const create = async (id: string, source: "built-in" | "project") => {
    if (!activeScreen) return;
    setCreating(id);
    setError(null);
    try {
      await withFlushedProject(async () => {
        const { body } = await projectJsonRequest<Record<string, unknown>>("/api/templates", {
          method: "POST",
          conditional: true,
          advanceRevision: true,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, source, locale: activeScreen.locale, layoutId: activeLayoutId }),
          errorFallback: "Template operation failed",
        });
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
  return (
    <DialogShell
      title="Screen templates"
      description={`Create an ordinary editable screen in locale ${activeScreen?.locale ?? "—"} from a built-in template or from a project-local screen template.`}
      ariaLabel="Screen template library"
      closeLabel="Close screen template library"
      onClose={close}
      closeDisabled={creating !== null}
      widthClass="max-w-2xl"
    >
      {error ? <StatusMessage tone="error" className="mb-4">{error}</StatusMessage> : null}
      <div role="tablist" aria-label="Template sources" className="mb-4 flex gap-2 border-b border-slate-200 pb-2">
        <button type="button" role="tab" aria-selected={tab === "built-in"} className={tab === "built-in" ? editorUi.buttonPrimary : editorUi.buttonSecondary} onClick={() => setTab("built-in")}>Built-in templates</button>
        <button type="button" role="tab" aria-selected={tab === "project"} className={tab === "project" ? editorUi.buttonPrimary : editorUi.buttonSecondary} onClick={() => setTab("project")}>Project templates</button>
      </div>
      {loading ? <p className="text-xs text-slate-500">Loading screen templates…</p> : null}
      {!loading && tab === "project" && templates.length === 0 ? (
        <EmptyResourceState
          icon={LayoutTemplate}
          title="No screen templates yet"
          description="Add an exact screen layout to the project, then reopen this library to create a screen."
          path="templates/<id>.json"
        />
      ) : null}

      <div className="flex flex-col gap-3">
        {(tab === "built-in" ? builtIns : templates).map((template) => (
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
                <button className={`${editorUi.buttonPrimary} w-full sm:w-auto`} disabled={!activeScreen || creating !== null} onClick={() => create(template.id, tab)}>
                  {creating === template.id ? "Creating…" : "Create screen"}
                </button>
              </div>
          </section>
        ))}
      </div>
    </DialogShell>
  );
}
