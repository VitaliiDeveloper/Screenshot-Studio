"use client";

import { useMemo, useState } from "react";
import { useStore } from "zustand";
import {
  Box,
  Frame,
  Image as ImageIcon,
  LayoutTemplate,
  Palette,
  RectangleHorizontal,
  Search,
  Smartphone,
  Type,
  X,
} from "lucide-react";
import type { Element } from "@screenshot-studio/core/model";
import type { ImageCache } from "@screenshot-studio/core/assets";
import { createShapeElement, createTextElement } from "@screenshot-studio/core/model";
import {
  ADD_CATEGORIES,
  filterAddCatalog,
  type AddCatalogItem,
  type ResourceDialog,
  type WorkspacePanel,
} from "../lib/editor-workspace";
import { editorStore } from "../lib/editor-store";
import { mutateAndSave } from "../lib/mutate-and-save";
import { LayersSection } from "./LayersSection";
import { ScreensSection } from "./ScreensSection";
import { cx, editorUi } from "./editor-ui";

const catalogIcons = {
  text: Type,
  shape: RectangleHorizontal,
  screenshot: ImageIcon,
  image: ImageIcon,
  "device-frame": Smartphone,
  components: Box,
} as const;

function PanelHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <header className="flex min-h-14 items-center justify-between border-b border-slate-200 px-4">
      <h2 className="text-sm font-semibold tracking-tight text-slate-950">{title}</h2>
      <button type="button" aria-label={`Close ${title.toLowerCase()} panel`} className={editorUi.iconButton} onClick={onClose}>
        <X size={16} strokeWidth={1.9} />
      </button>
    </header>
  );
}

function ResourceButton({
  icon: Icon,
  title,
  description,
  onClick,
}: {
  icon: typeof Frame;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={title}
      className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70"
      onClick={onClick}
    >
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
        <Icon size={17} strokeWidth={1.8} />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-slate-800">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{description}</span>
      </span>
    </button>
  );
}

function AddCatalogRow({ item, onAction }: { item: AddCatalogItem; onAction: (item: AddCatalogItem) => void }) {
  const Icon = catalogIcons[item.id];
  const unavailable = item.action === "unavailable";
  return (
    <button
      type="button"
      aria-label={item.action === "insert-text" ? "+ Text" : item.action === "insert-shape" ? "+ Shape" : item.label}
      disabled={unavailable}
      className={cx(
        "group flex min-h-11 w-full items-center gap-3 rounded-lg px-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70",
        unavailable ? "cursor-not-allowed text-slate-400" : "text-slate-700 hover:bg-slate-100 hover:text-slate-950",
      )}
      title={item.hint}
      onClick={() => onAction(item)}
    >
      <Icon size={18} strokeWidth={1.75} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{item.label}</span>
        {item.hint ? <span className="block truncate text-[10px] text-slate-400">{item.hint}</span> : null}
      </span>
      {item.shortcut ? <kbd className="text-[10px] font-medium text-slate-400">{item.shortcut}</kbd> : null}
    </button>
  );
}

function AddPanel({
  onOpenDialog,
}: {
  onOpenDialog: (dialog: ResourceDialog) => void;
}) {
  const [query, setQuery] = useState("");
  const defaultFont = useStore(editorStore, (state) => state.project?.fonts[0]);
  const items = useMemo(() => filterAddCatalog(query), [query]);

  const insert = (element: Element) => {
    mutateAndSave(() => editorStore.getState().addElement(element));
  };

  const onAction = (item: AddCatalogItem) => {
    switch (item.action) {
      case "insert-text":
        if (!defaultFont) {
          onOpenDialog("fonts");
          return;
        }
        insert(createTextElement({ font: defaultFont }));
        break;
      case "insert-shape":
        insert(createShapeElement());
        break;
      case "open-templates":
        onOpenDialog("templates");
        break;
      case "unavailable":
        break;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-slate-200 p-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} strokeWidth={1.9} />
          <input
            type="search"
            aria-label="Search add catalog"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search add…"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-xs text-slate-800 shadow-sm outline-none transition-colors placeholder:text-slate-400 hover:border-slate-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {ADD_CATEGORIES.map((category) => {
          const rows = items.filter((item) => item.category === category);
          if (rows.length === 0) return null;
          return (
            <section key={category} className="border-b border-slate-100 py-3 last:border-b-0">
              <h3 className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{category}</h3>
              {rows.map((item) => <AddCatalogRow key={item.id} item={item} onAction={onAction} />)}
            </section>
          );
        })}
        {items.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs leading-5 text-slate-500">No elements match “{query}”.</p>
        ) : null}
      </div>
    </div>
  );
}

/** The contextual shelf opened from the permanent tool rail. */
export function LeftPanel({
  panel,
  images,
  onClose,
  onOpenDialog,
}: {
  panel: WorkspacePanel;
  images: ImageCache;
  onClose: () => void;
  onOpenDialog: (dialog: ResourceDialog) => void;
}) {
  const title = panel === "structure" ? "Structure" : panel === "resources" ? "Resources" : "Add";

  return (
    <aside className="absolute inset-y-0 left-14 z-30 flex w-[min(18rem,calc(100vw-3.5rem))] shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white shadow-xl shadow-slate-950/10 xl:static xl:w-72 xl:shadow-[1px_0_0_rgba(15,23,42,0.02)]">
      <PanelHeader title={title} onClose={onClose} />
      {panel === "structure" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ScreensSection images={images} />
          <LayersSection />
        </div>
      ) : null}
      {panel === "resources" ? (
        <div className="flex flex-col gap-2.5 p-3">
          <ResourceButton icon={Frame} title="Fonts" description="Upload, register, preview, and apply project fonts." onClick={() => onOpenDialog("fonts")} />
          <ResourceButton icon={Palette} title="Themes" description="Apply baked project-local color and type roles." onClick={() => onOpenDialog("themes")} />
          <ResourceButton icon={LayoutTemplate} title="Templates" description="Create a fresh screen from a reusable layout." onClick={() => onOpenDialog("templates")} />
        </div>
      ) : null}
      {panel === "add" ? <AddPanel onOpenDialog={onOpenDialog} /> : null}
    </aside>
  );
}
