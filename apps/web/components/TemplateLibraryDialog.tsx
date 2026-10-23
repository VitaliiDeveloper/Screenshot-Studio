// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { LayoutTemplate, Search } from "lucide-react";
import { getScreen, parseProject } from "@screenshot-studio/core/model";
import {
  DEFAULT_STORE_SPECS,
  outputFamilyLabel,
  type StoreSpecs,
} from "@screenshot-studio/core/export";
import type { ScreenTemplate, TemplatePack } from "@screenshot-studio/core/templates";
import { listBuiltInDesignPacks } from "@screenshot-studio/core/themes";
import { editorStore } from "@web/lib/editor/editor-store";
import { withFlushedProject } from "@web/lib/editor/debounced-save";
import { projectJsonRequest } from "@web/lib/clients/project-api-client";
import {
  cx,
  DialogShell,
  EmptyResourceState,
  editorUi,
  MenuSelect,
  SegmentedControl,
  StatusMessage,
} from "./editor-ui";

type OutputFamily = { platform: string; device: string };
type TemplateSource = "built-in" | "project";
type Orientation = "portrait" | "landscape";

export type TemplateEntry = { template: ScreenTemplate; style?: string; preview: string | null };
export type TemplateFilters = { query: string; family: string; style: string; orientation: string };

const ALL = "all";

const TEMPLATE_SOURCE_OPTIONS = [
  { value: "built-in", label: "Built-in" },
  { value: "project", label: "Project" },
] as const;

const ORIENTATION_OPTIONS = [
  { value: ALL, label: "Any orientation" },
  { value: "portrait", label: "Portrait" },
  { value: "landscape", label: "Landscape" },
] as const;

// Pack previews are baked by e2e/template-pack-parity.test.ts through the shared renderer.
const PLACEHOLDER_TILE = "repeating-linear-gradient(135deg, var(--editor-color-surface-muted) 0 5px, var(--editor-color-surface-subtle) 5px 10px)";

/** Shipped static preview for a pack screen, or null when the pack ships none (screen ids outside `<pack>-<key>`). */
export function templatePreviewPath(packId: string, screenId: string): string | null {
  const prefix = `${packId}-`;
  return screenId.startsWith(prefix) ? `/template-previews/${packId}/${screenId.slice(prefix.length)}.png` : null;
}

export function builtInTemplateEntries(
  builtIns: readonly ScreenTemplate[],
  packs: readonly TemplatePack[],
): TemplateEntry[] {
  return [
    ...builtIns.map((template) => ({ template, preview: null })),
    ...packs.flatMap((pack) => pack.screens.map((template) => ({
      template,
      style: pack.style,
      preview: templatePreviewPath(pack.id, template.id),
    }))),
  ];
}

export function templateOrientation(template: Pick<ScreenTemplate, "artboard">): Orientation {
  return template.artboard.height > template.artboard.width ? "portrait" : "landscape";
}

export function templateFamilyKey(template: OutputFamily): string {
  return `${template.platform}/${template.device}`;
}

export function templateOutputFamilyLabel(
  template: OutputFamily,
  specs: StoreSpecs = DEFAULT_STORE_SPECS,
): string {
  return outputFamilyLabel(template.platform, template.device, specs);
}

const DESIGN_PACK_NAMES = new Map(listBuiltInDesignPacks().map((pack) => [pack.id, pack.name]));

export function templateStyleLabel(style: string): string {
  return DESIGN_PACK_NAMES.get(style) ?? style;
}

export function filterTemplateEntries(
  entries: readonly TemplateEntry[],
  filters: TemplateFilters,
  specs: StoreSpecs = DEFAULT_STORE_SPECS,
): TemplateEntry[] {
  const terms = filters.query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter(({ template, style }) => {
    if (filters.family !== ALL && templateFamilyKey(template) !== filters.family) return false;
    if (filters.style !== ALL && style !== filters.style) return false;
    if (filters.orientation !== ALL && templateOrientation(template) !== filters.orientation) return false;
    const haystack = [
      template.name,
      template.description,
      templateOutputFamilyLabel(template, specs),
      style ? templateStyleLabel(style) : undefined,
    ].join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

function TemplatePreview({ entry }: { entry: TemplateEntry }) {
  const { artboard } = entry.template;
  const portrait = templateOrientation(entry.template) === "portrait";
  return (
    <span className="flex h-36 w-full items-center justify-center overflow-hidden rounded-[var(--editor-radius-control)] border border-[var(--editor-color-border)] bg-[var(--editor-color-surface-subtle)] p-2">
      {entry.preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={entry.preview} alt="" loading="lazy" className="h-full w-auto rounded-sm object-contain shadow-[var(--editor-shadow-control)]" />
      ) : (
        <span
          aria-hidden="true"
          data-template-placeholder=""
          className="block max-h-full max-w-full rounded-sm border border-[var(--editor-color-border)]"
          style={{
            aspectRatio: `${artboard.width} / ${artboard.height}`,
            height: portrait ? "100%" : "auto",
            width: portrait ? "auto" : "100%",
            background: PLACEHOLDER_TILE,
          }}
        />
      )}
    </span>
  );
}

export function TemplateLibraryDialog({
  onClose,
  specs = DEFAULT_STORE_SPECS,
}: {
  onClose: () => void;
  specs?: StoreSpecs;
}) {
  const project = useStore(editorStore, (state) => state.project);
  const activeLayoutId = useStore(editorStore, (state) => state.activeLayoutId);
  const activeScreenId = useStore(editorStore, (state) => state.activeScreenId);
  const activeScreen = project && activeLayoutId && activeScreenId
    ? getScreen(project, activeLayoutId, activeScreenId)
    : null;
  const [templates, setTemplates] = useState<ScreenTemplate[]>([]);
  const [builtIns, setBuiltIns] = useState<TemplateEntry[]>([]);
  const [tab, setTab] = useState<TemplateSource>("built-in");
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState(() => activeScreen ? templateFamilyKey(activeScreen) : ALL);
  const [style, setStyle] = useState(ALL);
  const [orientation, setOrientation] = useState(ALL);
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
        setBuiltIns(builtInTemplateEntries(
          (body.builtIns ?? []) as ScreenTemplate[],
          (body.packs ?? []) as TemplatePack[],
        ));
      })
      .catch((fetchError) => {
        if (!controller.signal.aborted) setError((fetchError as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const sourceEntries: TemplateEntry[] = tab === "built-in"
    ? builtIns
    : templates.map((template) => ({ template, preview: null }));
  const familyKeys = [...new Set([
    ...(activeScreen ? [templateFamilyKey(activeScreen)] : []),
    ...sourceEntries.map(({ template }) => templateFamilyKey(template)),
  ])];
  const familyOptions = [
    { value: ALL, label: "All outputs" },
    ...familyKeys.map((key) => {
      const [platform, device] = key.split("/") as [string, string];
      return { value: key, label: outputFamilyLabel(platform, device, specs) };
    }),
  ];
  const styleKeys = [...new Set(sourceEntries.flatMap((entry) => entry.style ? [entry.style] : []))];
  const styleOptions = [
    { value: ALL, label: "Any style" },
    ...styleKeys.map((key) => ({ value: key, label: templateStyleLabel(key) })),
  ];
  const visibleEntries = filterTemplateEntries(
    sourceEntries,
    { query, family, style: tab === "built-in" ? style : ALL, orientation },
    specs,
  );
  const close = () => {
    setError(null);
    onClose();
  };
  const create = async (id: string, source: TemplateSource) => {
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
      close();
    } catch (createError) {
      setError((createError as Error).message);
    } finally {
      setCreating(null);
    }
  };
  return (
    <DialogShell
      title="Screen templates"
      description={`Add a new screen in ${activeScreen?.locale ?? "—"} from a template. Everything stays editable.`}
      ariaLabel="Screen template library"
      closeLabel="Close screen template library"
      onClose={close}
      closeDisabled={creating !== null}
      widthClass="max-w-3xl"
    >
      {error ? <StatusMessage tone="error" className="mb-4">{error}</StatusMessage> : null}
      <div className="mb-4 flex flex-col gap-3">
        <SegmentedControl
          label="Template source"
          value={tab}
          options={TEMPLATE_SOURCE_OPTIONS}
          onChange={setTab}
          fill
        />
        <label className="relative block">
          <span className="sr-only">Search templates</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[color:var(--editor-color-text-subtle)]" />
          <input
            type="search"
            className={cx(editorUi.field, "pl-8")}
            placeholder="Search templates"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className={cx("grid gap-2", tab === "built-in" ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
          <MenuSelect ariaLabel="Output filter" value={family} options={familyOptions} onChange={setFamily} />
          {tab === "built-in" ? (
            <MenuSelect ariaLabel="Style filter" value={style} options={styleOptions} onChange={setStyle} />
          ) : null}
          <MenuSelect ariaLabel="Orientation filter" value={orientation} options={ORIENTATION_OPTIONS} onChange={setOrientation} />
        </div>
      </div>
      {loading ? <p className="text-xs text-[color:var(--editor-color-text-secondary)]">Loading screen templates…</p> : null}
      {!loading && tab === "project" && templates.length === 0 ? (
        <EmptyResourceState
          icon={LayoutTemplate}
          title="No screen templates yet"
          description="Add an exact screen layout to the project, then reopen this library to create a screen."
          path="templates/<id>.json"
        />
      ) : null}
      {!loading && sourceEntries.length > 0 && visibleEntries.length === 0 ? (
        <EmptyResourceState
          icon={LayoutTemplate}
          title="No matching templates"
          description="Clear the search or widen the output, style, or orientation filter."
        />
      ) : null}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4" aria-label="Templates">
        {visibleEntries.map((entry) => {
          const { template } = entry;
          const busy = creating === template.id;
          const meta = [entry.style ? templateStyleLabel(entry.style) : null, templateOutputFamilyLabel(template, specs)]
            .filter(Boolean).join(" · ");
          return (
            <li key={template.id}>
              <button
                type="button"
                data-testid={`template-card-${template.id}`}
                title={template.description}
                aria-busy={busy || undefined}
                disabled={!activeScreen || creating !== null}
                onClick={() => create(template.id, tab)}
                className={cx(
                  "flex w-full flex-col gap-1.5 rounded-[var(--editor-radius-control)] p-1.5 text-left transition-colors duration-[var(--editor-motion-fast)]",
                  "hover:bg-[var(--editor-color-surface-muted)] disabled:pointer-events-none",
                  "focus-visible:outline-none focus-visible:ring-[length:var(--editor-focus-width)] focus-visible:ring-[var(--editor-color-focus)]",
                  creating !== null && !busy && "opacity-45",
                )}
              >
                <TemplatePreview entry={entry} />
                <span className="truncate text-xs font-medium text-[color:var(--editor-color-text-strong)]">{template.name}</span>
                <span className="truncate text-[11px] text-[color:var(--editor-color-text-secondary)]">
                  {busy ? "Creating…" : `${meta} · ${template.artboard.width}×${template.artboard.height}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-[11px] leading-snug text-[color:var(--editor-color-text-secondary)]">
        Choosing a template creates an ordinary screen in the current layout.
      </p>
    </DialogShell>
  );
}
