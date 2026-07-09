"use client";

import { useRef, useState } from "react";
import { useStore } from "zustand";
import { fontIdentityKey, getScreen, parseProject, type FontAsset, type Project } from "@screenshot-studio/core/model";
import { registerFont } from "@screenshot-studio/core/fonts";
import { editorStore } from "../lib/editor-store";
import { withFlushedProject } from "../lib/debounced-save";
import { mutateAndSave } from "../lib/mutate-and-save";

type PendingAction = "upload" | "google" | "remove" | null;

function fontUsage(project: Project, font: FontAsset): number {
  let count = 0;
  for (const screen of project.screens) {
    for (const element of screen.elements) {
      if (element.type === "text" && element.fontFamily === font.family && element.weight === font.weight) count += 1;
    }
  }
  return count;
}

async function responseProject(response: Response): Promise<Project> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `Font operation failed (${response.status})`);
  return parseProject(body);
}

export function FontManagerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useStore(editorStore, (state) => state.project);
  const activeScreenId = useStore(editorStore, (state) => state.activeScreenId);
  const selectedId = useStore(editorStore, (state) => state.selectedId);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadFamily, setUploadFamily] = useState("");
  const [uploadWeight, setUploadWeight] = useState(400);
  const [googleFamily, setGoogleFamily] = useState("");
  const [googleWeight, setGoogleWeight] = useState(400);
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);

  if (!open || !project || !activeScreenId) return null;

  const selected = selectedId
    ? getScreen(project, activeScreenId).elements.find((element) => element.id === selectedId)
    : undefined;
  const selectedText = selected?.type === "text" ? selected : undefined;
  const fieldClass = "rounded border border-neutral-300 px-2 py-1 text-xs";
  const secondaryButton = "rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50";
  const close = () => {
    setError(null);
    onClose();
  };

  const acceptProject = async (nextProject: Project, previousFonts: FontAsset[]) => {
    const previousKeys = new Set(previousFonts.map(fontIdentityKey));
    const added = nextProject.fonts.filter((font) => !previousKeys.has(fontIdentityKey(font)));
    try {
      await Promise.all(added.map((font) => registerFont(
        font,
        (path) => `/api/asset?path=${encodeURIComponent(path)}`,
      )));
      editorStore.getState().replaceFonts(nextProject.fonts);
    } catch (loadError) {
      // The server mutation is already durable. Sync it before releasing the persistence lock so
      // a queued editor save cannot erase the project entry, then report the partial failure.
      editorStore.getState().replaceFonts(nextProject.fonts);
      throw new Error(
        `Font was saved to the project, but its browser preview could not load: ${(loadError as Error).message}`,
        { cause: loadError },
      );
    }
  };

  const addUpload = async () => {
    if (!uploadFile) { setError("Choose a font file."); return; }
    setPending("upload");
    setError(null);
    try {
      await withFlushedProject(async () => {
        const previousFonts = editorStore.getState().project!.fonts;
        const form = new FormData();
        form.set("file", uploadFile);
        form.set("family", uploadFamily);
        form.set("weight", String(uploadWeight));
        const next = await responseProject(await fetch("/api/fonts", { method: "POST", body: form }));
        await acceptProject(next, previousFonts);
      });
      setUploadFile(null);
      setUploadFamily("");
      if (uploadInput.current) uploadInput.current.value = "";
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  };

  const addGoogle = async () => {
    setPending("google");
    setError(null);
    try {
      await withFlushedProject(async () => {
        const previousFonts = editorStore.getState().project!.fonts;
        const next = await responseProject(await fetch("/api/fonts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: "google", family: googleFamily, weight: googleWeight }),
        }));
        await acceptProject(next, previousFonts);
      });
      setGoogleFamily("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  };

  const remove = async (font: FontAsset) => {
    const usage = fontUsage(project, font);
    if (usage > 0 && !window.confirm(`Remove ${font.family} ${font.weight}? It is used by ${usage} text element(s).`)) return;
    setPending("remove");
    setError(null);
    try {
      await withFlushedProject(async () => {
        const next = await responseProject(await fetch("/api/fonts", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ family: font.family, weight: font.weight }),
        }));
        for (const face of document.fonts) {
          if (face.family === font.family && Number(face.weight) === font.weight) document.fonts.delete(face);
        }
        editorStore.getState().replaceFonts(next.fonts);
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  };

  const apply = (font: FontAsset) => {
    if (!selectedText) return;
    mutateAndSave(() => editorStore.getState().patchElement(selectedText.id, {
      fontFamily: font.family,
      weight: font.weight,
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Font manager"
        className="flex max-h-[85vh] w-[620px] flex-col gap-4 overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Fonts</h2>
            <p className="text-xs text-neutral-500">File-backed fonts used by editor and export.</p>
          </div>
          <button aria-label="Close font manager" className={secondaryButton} onClick={close}>Close</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <section className="flex flex-col gap-2 rounded border border-neutral-200 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Upload</h3>
            <input
              aria-label="Font file"
              ref={uploadInput}
              type="file"
              accept=".ttf,.otf,.woff,.woff2"
              onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
              className="text-xs"
            />
            <input aria-label="Upload font family" placeholder="Family" value={uploadFamily} onChange={(event) => setUploadFamily(event.target.value)} className={fieldClass} />
            <input aria-label="Upload font weight" type="number" min={100} max={900} step={100} value={uploadWeight} onChange={(event) => setUploadWeight(Number(event.target.value))} className={fieldClass} />
            <button className={secondaryButton} disabled={pending !== null || !uploadFile || !uploadFamily.trim()} onClick={addUpload}>
              {pending === "upload" ? "Adding…" : "Add uploaded font"}
            </button>
          </section>

          <section className="flex flex-col gap-2 rounded border border-neutral-200 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Google Fonts</h3>
            <p className="text-xs text-neutral-500">Downloaded once and stored in the project.</p>
            <input aria-label="Google font family" placeholder="Family, e.g. Inter" value={googleFamily} onChange={(event) => setGoogleFamily(event.target.value)} className={fieldClass} />
            <input aria-label="Google font weight" type="number" min={100} max={900} step={100} value={googleWeight} onChange={(event) => setGoogleWeight(Number(event.target.value))} className={fieldClass} />
            <button className={secondaryButton} disabled={pending !== null || !googleFamily.trim()} onClick={addGoogle}>
              {pending === "google" ? "Adding…" : "Add Google font"}
            </button>
          </section>
        </div>

        {error && <p role="alert" className="whitespace-pre-wrap text-xs text-red-600">{error}</p>}

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Registered</h3>
            <span className="text-xs text-neutral-400">{project.fonts.length} identities</span>
          </div>
          {project.fonts.length === 0 ? (
            <p className="rounded border border-dashed border-neutral-300 p-4 text-center text-xs text-neutral-500">No fonts registered.</p>
          ) : project.fonts.map((font) => {
            const usage = fontUsage(project, font);
            return (
              <div key={fontIdentityKey(font)} data-testid={`font-row-${font.family}-${font.weight}`} className="flex items-center gap-3 rounded border border-neutral-200 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs">
                    <strong>{font.family}</strong>
                    <span>{font.weight}</span>
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-500">{font.source}</span>
                    {usage > 0 && <span className="text-neutral-400">used {usage}×</span>}
                  </div>
                  <p data-testid={`font-preview-${font.family}-${font.weight}`} style={{ fontFamily: `"${font.family}"`, fontWeight: font.weight }} className="mt-1 truncate text-xl">
                    The quick brown fox 0123
                  </p>
                </div>
                <button className={secondaryButton} disabled={!selectedText || pending !== null} onClick={() => apply(font)}>Apply</button>
                <button className={`${secondaryButton} text-red-600`} disabled={pending !== null} onClick={() => remove(font)}>Remove</button>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
