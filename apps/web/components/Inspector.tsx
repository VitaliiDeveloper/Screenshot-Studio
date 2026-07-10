"use client";

import { useStore } from "zustand";
import { PanelRightClose } from "lucide-react";
import { getScreen } from "@screenshot-studio/core/model";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import { editorStore, type ElementPatch } from "../lib/editor-store";
import { mutateAndScheduleSave } from "../lib/mutate-and-save";
import { flushScheduledSave } from "../lib/debounced-save";
import {
  NumberField,
  ColorField,
  TextField,
  SelectField,
  FontIdentityField,
  ThemeRoleField,
} from "./inspector-fields";
import { ArtboardTargets } from "./ArtboardTargets";
import { cx, editorUi } from "./editor-ui";

/**
 * The right-hand inspector. When an element is selected it shows a Transform section plus a
 * per-type section; with no selection it edits the active screen's artboard + background.
 * Every edit patches the store (live canvas) then schedules a debounced save (spec §3, §4).
 */
function patch(id: string, p: ElementPatch) {
  mutateAndScheduleSave(() => editorStore.getState().patchElement(id, p));
}

function editArtboard(patch: { width?: number; height?: number }) {
  mutateAndScheduleSave(() => editorStore.getState().patchArtboard(patch));
}

function editBackground(color: string) {
  mutateAndScheduleSave(() => editorStore.getState().patchBackground({ color }));
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-b border-slate-200 px-4 py-4">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{title}</h3>
      {children}
    </section>
  );
}

export function Inspector({
  specs,
  onClose,
  className,
}: {
  specs: StoreSpecs | null;
  onClose?: () => void;
  className?: string;
}) {
  const project = useStore(editorStore, (s) => s.project);
  const activeScreenId = useStore(editorStore, (s) => s.activeScreenId);
  const selectedId = useStore(editorStore, (s) => s.selectedId);

  if (!project || !activeScreenId) return <aside className={cx("w-72 shrink-0 border-l border-slate-200 bg-white", className)} />;
  const screen = getScreen(project, activeScreenId);
  const element = selectedId ? screen.elements.find((e) => e.id === selectedId) : undefined;

  return (
    <aside className={cx(
      "flex h-full w-[min(18rem,calc(100vw-3.5rem))] shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white shadow-xl shadow-slate-950/10 xl:w-72 xl:shadow-[-1px_0_0_rgba(15,23,42,0.02)]",
      className,
    )} onBlurCapture={() => void flushScheduledSave().catch(() => undefined)}>
      <header className="sticky top-0 z-10 flex min-h-14 items-center justify-between border-b border-slate-200 bg-white px-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-slate-950">Inspect</h2>
          <p className="text-[10px] text-slate-400">{element ? element.type : screen.name}</p>
        </div>
        {onClose ? (
          <button type="button" aria-label="Close inspector" className={editorUi.iconButton} onClick={onClose}>
            <PanelRightClose size={16} strokeWidth={1.9} />
          </button>
        ) : null}
      </header>
      {element ? (
        <>
          <Section title="Transform">
            <NumberField label="X" value={element.x} onChange={(x) => patch(element.id, { x })} />
            <NumberField label="Y" value={element.y} onChange={(y) => patch(element.id, { y })} />
            <NumberField label="Width" value={element.width} min={1} onChange={(width) => patch(element.id, { width })} />
            <NumberField label="Height" value={element.height} min={1} onChange={(height) => patch(element.id, { height })} />
            <NumberField label="Rotation" value={element.rotation} onChange={(rotation) => patch(element.id, { rotation })} />
            <NumberField label="Opacity" value={element.opacity} min={0} max={1} step={0.1} onChange={(opacity) => patch(element.id, { opacity })} />
          </Section>

          {element.type === "text" && (
            <Section title="Text">
              <ThemeRoleField value={element.role} onChange={(role) => patch(element.id, { role })} />
              <TextField label="Content" value={element.content} multiline onChange={(content) => patch(element.id, { content })} />
              <FontIdentityField
                fonts={project.fonts}
                family={element.fontFamily}
                weight={element.weight}
                onChange={({ family, weight }) => patch(element.id, { fontFamily: family, weight })}
              />
              <NumberField label="Size" value={element.size} min={1} onChange={(size) => patch(element.id, { size })} />
              <NumberField label="Line height" value={element.lineHeight} min={0.1} step={0.1} onChange={(lineHeight) => patch(element.id, { lineHeight })} />
              <NumberField label="Letter spacing" value={element.letterSpacing} onChange={(letterSpacing) => patch(element.id, { letterSpacing })} />
              <SelectField label="Align" value={element.align} options={["left", "center", "right"] as const} onChange={(align) => patch(element.id, { align })} />
              <ColorField label="Color" value={element.color} onChange={(color) => patch(element.id, { color })} />
            </Section>
          )}

          {element.type === "shape" && (
            <Section title="Shape">
              <ThemeRoleField value={element.role} onChange={(role) => patch(element.id, { role })} />
              <ColorField label="Fill" value={element.fill} onChange={(fill) => patch(element.id, { fill })} />
              <NumberField label="Radius" value={element.radius} min={0} onChange={(radius) => patch(element.id, { radius })} />
            </Section>
          )}

          {element.type === "screenshot" && (
            <Section title="Screenshot">
              <TextField label="Asset URL" value={element.assetUrl} onChange={(assetUrl) => patch(element.id, { assetUrl })} />
              <SelectField label="Fit" value={element.fit} options={["cover", "contain"] as const} onChange={(fit) => patch(element.id, { fit })} />
              <NumberField label="Corner radius" value={element.cornerRadius} min={0} onChange={(cornerRadius) => patch(element.id, { cornerRadius })} />
            </Section>
          )}

          {element.type === "device-frame" && (
            <Section title="Device frame">
              <TextField label="Asset URL" value={element.assetUrl} onChange={(assetUrl) => patch(element.id, { assetUrl })} />
              <SelectField label="Fit" value={element.fit} options={["cover", "contain"] as const} onChange={(fit) => patch(element.id, { fit })} />
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-500">Device</span>
                <span className="rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-600">{element.deviceType}</span>
              </div>
            </Section>
          )}
        </>
      ) : (
        <>
          <Section title="Artboard">
            <NumberField label="Width" value={screen.artboard.width} min={1} integer onChange={(width) => editArtboard({ width })} />
            <NumberField label="Height" value={screen.artboard.height} min={1} integer onChange={(height) => editArtboard({ height })} />
          </Section>
          {specs && (
            <Section title="Store targets">
              <ArtboardTargets
                screen={screen}
                specs={specs}
                onSetExact={(width, height) => editArtboard({ width, height })}
              />
            </Section>
          )}
          {screen.background.type === "solid" && (
            <Section title="Background">
              <ColorField label="Color" value={screen.background.color} onChange={editBackground} />
            </Section>
          )}
        </>
      )}
    </aside>
  );
}
