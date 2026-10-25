// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { Palette } from "lucide-react";
import { getLayout, getScreen, parseProject, THEME_ROLES, type Project } from "@screenshot-studio/core/model";
import type { BuiltInTemplatePackMetadata } from "@screenshot-studio/core/templates";
import type { DesignPack, Theme } from "@screenshot-studio/core/themes";
import { editorStore } from "@web/lib/editor/editor-store";
import { withFlushedProject } from "@web/lib/editor/debounced-save";
import { projectJsonRequest } from "@web/lib/clients/project-api-client";
import { LAYOUT_MODE_LABELS } from "@web/lib/layout-mode-labels";
import { DialogShell, EmptyResourceState, editorUi, StatusMessage } from "./editor-ui";
import { gradientStyle } from "./inspector/BackgroundInspectorFields";

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

function DesignPackSample({ pack }: { pack: DesignPack }) {
  const background = pack.background.type === "solid"
    ? { backgroundColor: pack.background.color }
    : gradientStyle(pack.background);
  return (
    <div
      aria-hidden="true"
      data-testid={`design-pack-sample-${pack.id}`}
      className="flex aspect-[9/16] w-24 shrink-0 flex-col gap-1.5 overflow-hidden rounded-xl border border-[var(--editor-color-swatch-outline)] p-2.5 shadow-inner"
      style={background}
    >
      <span className="h-1 w-6 rounded-full" style={{ backgroundColor: pack.palette.accent }} />
      <span className="text-[13px] font-semibold leading-tight" style={{ color: pack.palette.heading }}>Headline</span>
      <span className="text-[8px] leading-snug" style={{ color: pack.palette.body }}>A short supporting line</span>
      <span className="mt-auto h-8 rounded-md" style={{ backgroundColor: pack.palette.surface }} />
    </div>
  );
}

const percent = (ratio: number) => `${Math.round(ratio * 1000) / 10}%`;

export function ThemeManagerDialog({ onClose }: { onClose: () => void }) {
  const project = useStore(editorStore, (state) => state.project);
  const activeLayoutId = useStore(editorStore, (state) => state.activeLayoutId);
  const activeScreenId = useStore(editorStore, (state) => state.activeScreenId);
  const [builtIns, setBuiltIns] = useState<DesignPack[]>([]);
  const [templatePacks, setTemplatePacks] = useState<BuiltInTemplatePackMetadata[]>([]);
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
        setTemplatePacks((body.templatePacks ?? []) as BuiltInTemplatePackMetadata[]);
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

  const activeScreen = project && activeLayoutId && activeScreenId
    ? getScreen(project, activeLayoutId, activeScreenId)
    : null;
  const connected = project && activeLayoutId ? getLayout(project, activeLayoutId).mode === "connected" : false;
  const designPackNames = new Map(builtIns.map((pack) => [pack.id, pack.name]));
  const compatiblePacks = activeScreen
    ? templatePacks.filter((pack) => pack.platform === activeScreen.platform && pack.device === activeScreen.device)
    : [];
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
  const addScreens = async (id: string) => {
    if (!activeLayoutId || !activeScreen) return;
    setApplying(`template-pack:${id}`);
    setError(null);
    try {
      await withFlushedProject(async () => {
        const { body } = await projectJsonRequest<Record<string, unknown>>("/api/templates", {
          method: "POST",
          conditional: true,
          advanceRevision: true,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, source: "built-in-pack", locale: activeScreen.locale, layoutId: activeLayoutId }),
          errorFallback: "Template operation failed",
        });
        editorStore.getState().replaceProject(parseProject(body.project));
        editorStore.getState().selectScreen(String(body.screenId));
      });
      close();
    } catch (addError) {
      setError((addError as Error).message);
    } finally {
      setApplying(null);
    }
  };
  return (
    <DialogShell
      title="Design packs"
      description="Apply colors and fonts to every screen in this layout. Everything stays editable."
      ariaLabel="Design pack picker"
      closeLabel="Close design pack picker"
      onClose={close}
      closeDisabled={applying !== null}
      widthClass="max-w-2xl"
    >
      {error ? <StatusMessage tone="error" className="mb-4">{error}</StatusMessage> : null}
      {loading ? <p className="text-xs text-[color:var(--editor-color-text-secondary)]">Loading design packs…</p> : null}
      {!loading ? <h3 className={`mb-2 ${editorUi.sectionLabel}`}>Built-in packs</h3> : null}
      <div className="flex flex-col gap-3">
        {builtIns.map((pack) => {
          const operationId = `built-in:${pack.id}`;
          return (
            <section key={pack.id} data-testid={`design-pack-row-${pack.id}`} className={editorUi.resourceCard}>
              <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start sm:justify-between">
                <DesignPackSample pack={pack} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <h4 className="text-sm font-semibold text-[color:var(--editor-color-text-strong)]">{pack.name}</h4>
                    <span className="rounded-md bg-[var(--editor-color-surface-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[color:var(--editor-color-text-secondary)]">Built-in</span>
                  </div>
                  <p className="mt-1 text-xs text-[color:var(--editor-color-text-secondary)]">{pack.description}</p>
                  <p className="mt-3 text-xs text-[color:var(--editor-color-text-secondary)]">
                    Type: {pack.typography.heading.family} {pack.typography.heading.weight} · Heading {percent(pack.typography.heading.sizeRatio)} / body {percent(pack.typography.body.sizeRatio)} of the short side
                  </p>
                  <p className="mt-1 text-xs text-[color:var(--editor-color-text-secondary)]">Replaces every screen background in this layout.</p>
                </div>
                <button className={`${editorUi.buttonPrimary} w-full sm:w-auto`} disabled={applying !== null} onClick={() => apply(pack.id, "built-in")}>
                  {applying === operationId ? "Applying…" : "Apply pack"}
                </button>
              </div>
            </section>
          );
        })}
      </div>

      {!loading ? <h3 className={`mb-2 mt-6 ${editorUi.sectionLabel}`}>Screen packs</h3> : null}
      {!loading && compatiblePacks.length === 0 ? (
        <p className="text-xs text-[color:var(--editor-color-text-secondary)]">No built-in screen packs for the active screen&apos;s output family yet.</p>
      ) : null}
      <div className="flex flex-col gap-3">
        {compatiblePacks.map((pack) => (
          <section key={pack.id} data-testid={`template-pack-row-${pack.id}`} className={editorUi.resourceCard}>
            <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <h4 className="text-sm font-semibold text-[color:var(--editor-color-text-strong)]">{pack.name}</h4>
                  {designPackNames.has(pack.style) ? (
                    <span className="rounded-md bg-[var(--editor-color-surface-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[color:var(--editor-color-text-secondary)]">Style · {designPackNames.get(pack.style)}</span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-[color:var(--editor-color-text-secondary)]">{pack.description}</p>
                <p className="mt-1 text-xs text-[color:var(--editor-color-text-secondary)]">
                  {pack.panorama && !connected
                    ? `Switch this layout to ${LAYOUT_MODE_LABELS.connected} to add these connected screens.`
                    : `Adds ${pack.screenCount} editable screens in locale ${activeScreen?.locale}.`}
                </p>
              </div>
              <button className={`${editorUi.buttonSecondary} w-full sm:w-auto`} disabled={applying !== null || (pack.panorama && !connected)} onClick={() => addScreens(pack.id)}>
                {applying === `template-pack:${pack.id}` ? "Adding…" : "Add screens from pack"}
              </button>
            </div>
          </section>
        ))}
      </div>

      {!loading ? <h3 className={`mb-2 mt-6 ${editorUi.sectionLabel}`}>Project packs</h3> : null}
      {!loading && themes.length === 0 ? (
        <EmptyResourceState
          icon={Palette}
          title="No project packs yet"
          description="Built-in design packs above work in every project."
        />
      ) : null}

      <div className="flex flex-col gap-3">
        {themes.map((theme) => (
          <section key={theme.id} data-testid={`theme-row-${theme.id}`} className={editorUi.resourceCard}>
              <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-sm font-semibold text-[color:var(--editor-color-text-strong)]">{theme.name}</h3>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {THEME_ROLES.map((role) => (
                      <div key={role} className="text-[10px] font-medium text-[color:var(--editor-color-text-secondary)]">
                        <span className="mb-1 block h-6 rounded-lg border border-[var(--editor-color-swatch-outline)] shadow-inner" style={{ backgroundColor: theme.colors[role] }} />
                        {role}
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-[color:var(--editor-color-text-secondary)]">
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
