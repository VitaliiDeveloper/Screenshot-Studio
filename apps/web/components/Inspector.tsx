"use client";

import { useStore } from "zustand";
import { getScreen } from "@screenshot-studio/core/model";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import { editorStore, type ElementPatch } from "../lib/editor-store";
import { mutateAndScheduleSave } from "../lib/mutate-and-save";
import { NumberField, ColorField, TextField, SelectField } from "./inspector-fields";
import { ArtboardTargets } from "./ArtboardTargets";

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
    <div className="flex flex-col gap-2 border-b border-neutral-200 p-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{title}</h3>
      {children}
    </div>
  );
}

export function Inspector({ specs }: { specs: StoreSpecs | null }) {
  const project = useStore(editorStore, (s) => s.project);
  const activeScreenId = useStore(editorStore, (s) => s.activeScreenId);
  const selectedId = useStore(editorStore, (s) => s.selectedId);

  if (!project || !activeScreenId) return <aside className="w-64 shrink-0 border-l border-neutral-200 bg-white" />;
  const screen = getScreen(project, activeScreenId);
  const element = selectedId ? screen.elements.find((e) => e.id === selectedId) : undefined;

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col overflow-y-auto border-l border-neutral-200 bg-white">
      {element ? (
        <>
          <Section title="Transform">
            <NumberField label="X" value={element.x} onChange={(x) => patch(element.id, { x })} />
            <NumberField label="Y" value={element.y} onChange={(y) => patch(element.id, { y })} />
            <NumberField label="Width" value={element.width} onChange={(width) => patch(element.id, { width })} />
            <NumberField label="Height" value={element.height} onChange={(height) => patch(element.id, { height })} />
            <NumberField label="Rotation" value={element.rotation} onChange={(rotation) => patch(element.id, { rotation })} />
            <NumberField label="Opacity" value={element.opacity} step={0.1} onChange={(opacity) => patch(element.id, { opacity })} />
          </Section>

          {element.type === "text" && (
            <Section title="Text">
              <TextField label="Content" value={element.content} multiline onChange={(content) => patch(element.id, { content })} />
              <TextField label="Font" value={element.fontFamily} onChange={(fontFamily) => patch(element.id, { fontFamily })} />
              <NumberField label="Size" value={element.size} onChange={(size) => patch(element.id, { size })} />
              <NumberField label="Weight" value={element.weight} step={100} onChange={(weight) => patch(element.id, { weight })} />
              <NumberField label="Line height" value={element.lineHeight} step={0.1} onChange={(lineHeight) => patch(element.id, { lineHeight })} />
              <NumberField label="Letter spacing" value={element.letterSpacing} onChange={(letterSpacing) => patch(element.id, { letterSpacing })} />
              <SelectField label="Align" value={element.align} options={["left", "center", "right"] as const} onChange={(align) => patch(element.id, { align })} />
              <ColorField label="Color" value={element.color} onChange={(color) => patch(element.id, { color })} />
            </Section>
          )}

          {element.type === "shape" && (
            <Section title="Shape">
              <ColorField label="Fill" value={element.fill} onChange={(fill) => patch(element.id, { fill })} />
              <NumberField label="Radius" value={element.radius} onChange={(radius) => patch(element.id, { radius })} />
            </Section>
          )}

          {element.type === "screenshot" && (
            <Section title="Screenshot">
              <TextField label="Asset URL" value={element.assetUrl} onChange={(assetUrl) => patch(element.id, { assetUrl })} />
              <SelectField label="Fit" value={element.fit} options={["cover", "contain"] as const} onChange={(fit) => patch(element.id, { fit })} />
              <NumberField label="Corner radius" value={element.cornerRadius} onChange={(cornerRadius) => patch(element.id, { cornerRadius })} />
            </Section>
          )}

          {element.type === "device-frame" && (
            <Section title="Device frame">
              <TextField label="Asset URL" value={element.assetUrl} onChange={(assetUrl) => patch(element.id, { assetUrl })} />
              <SelectField label="Fit" value={element.fit} options={["cover", "contain"] as const} onChange={(fit) => patch(element.id, { fit })} />
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-neutral-500">Device</span>
                <span className="text-neutral-400">{element.deviceType}</span>
              </div>
            </Section>
          )}
        </>
      ) : (
        <>
          <Section title="Artboard">
            <NumberField label="Width" value={screen.artboard.width} onChange={(width) => editArtboard({ width })} />
            <NumberField label="Height" value={screen.artboard.height} onChange={(height) => editArtboard({ height })} />
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
