// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { CloudDownload, Monitor, Type, Upload } from "lucide-react";
import {
  DEFAULT_FONT_WEIGHT,
  countProjectFontUsage,
  findElementLocation,
  FONT_WEIGHT_MAX,
  FONT_WEIGHT_MIN,
  FONT_WEIGHT_STEP,
  fontIdentityKey,
  getScreen,
  type FontAsset,
  type Project,
} from "@screenshot-studio/core/model";
import { registerFont } from "@screenshot-studio/core/fonts";
import { editorStore } from "@web/lib/editor/editor-store";
import { primarySelection } from "@web/lib/editor/editor-selection";
import { withFlushedProject } from "@web/lib/editor/debounced-save";
import { mutateAndSave } from "@web/lib/editor/mutate-and-save";
import {
  projectRequestHeaders,
  resolveActiveProjectAssetUrl,
  setProjectRevision,
} from "@web/lib/clients/save-project";
import { DialogShell, EmptyResourceState, editorUi, StatusMessage } from "./editor-ui";
import { reconcileFontMutationResponse } from "./font-manager-model";
import { SystemFontImport } from "./SystemFontImport";

type PendingAction = "upload" | "google" | "remove" | "system" | null;

export function FontManagerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useStore(editorStore, (state) => state.project);
  const activeLayoutId = useStore(editorStore, (state) => state.activeLayoutId);
  const activeScreenId = useStore(editorStore, (state) => state.activeScreenId);
  const selectedItems = useStore(editorStore, (state) => state.selectedItems);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadFamily, setUploadFamily] = useState("");
  const [uploadWeight, setUploadWeight] = useState(DEFAULT_FONT_WEIGHT);
  const [googleFamily, setGoogleFamily] = useState("");
  const [googleWeight, setGoogleWeight] = useState(DEFAULT_FONT_WEIGHT);
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [view, setView] = useState<"manage" | "system">("manage");
  const uploadInput = useRef<HTMLInputElement>(null);
  const systemButton = useRef<HTMLButtonElement>(null);
  const returnedFromSystem = useRef(false);

  useEffect(() => {
    if (view === "manage" && returnedFromSystem.current) {
      returnedFromSystem.current = false;
      systemButton.current?.focus();
    }
  }, [view]);

  if (!open || !project || !activeLayoutId || !activeScreenId) return null;

  const primary = primarySelection(selectedItems);
  const selected = selectedItems.length === 1 && primary
    ? findElementLocation(getScreen(project, activeLayoutId, primary.screenId), primary.elementId)?.element
    : undefined;
  const selectedText = selected?.type === "text" ? selected : undefined;
  const close = () => {
    if (pending !== null) return;
    setError(null);
    setWarning(null);
    setView("manage");
    onClose();
  };

  const removeBrowserFaces = (font: FontAsset) => {
    for (const face of document.fonts) {
      if (face.family === font.family && Number(face.weight) === font.weight) {
        document.fonts.delete(face);
      }
    }
  };

  const reconcileAdd = async (response: Response, previousProject: Project) => {
    const result = await reconcileFontMutationResponse({
      response,
      previousProject,
      operation: "add",
    }, {
      replaceProject: editorStore.getState().replaceProject,
      setProjectRevision,
      registerAddedFont: (font) => registerFont(
        font,
        resolveActiveProjectAssetUrl,
      ),
    });
    setWarning(result.warning);
  };

  const addUpload = async () => {
    if (!uploadFile) { setError("Choose a font file."); return; }
    setPending("upload");
    setError(null);
    setWarning(null);
    try {
      await withFlushedProject(async () => {
        const previousProject = editorStore.getState().project!;
        const form = new FormData();
        form.set("file", uploadFile);
        form.set("family", uploadFamily);
        form.set("weight", String(uploadWeight));
        await reconcileAdd(
          await fetch("/api/fonts", {
            method: "POST",
            headers: projectRequestHeaders({ conditional: true }),
            body: form,
          }),
          previousProject,
        );
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
    setWarning(null);
    try {
      await withFlushedProject(async () => {
        const previousProject = editorStore.getState().project!;
        const response = await fetch("/api/fonts", {
          method: "POST",
          headers: projectRequestHeaders({
            conditional: true,
            headers: { "content-type": "application/json" },
          }),
          body: JSON.stringify({ source: "google", family: googleFamily, weight: googleWeight }),
        });
        await reconcileAdd(response, previousProject);
      });
      setGoogleFamily("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  };

  const importSystemFont = async (id: string) => {
    setWarning(null);
    await withFlushedProject(async () => {
      const previousProject = editorStore.getState().project!;
      const response = await fetch("/api/system-fonts/import", {
        method: "POST",
        headers: projectRequestHeaders({
          conditional: true,
          headers: { "content-type": "application/json" },
        }),
        body: JSON.stringify({ id }),
      });
      await reconcileAdd(response, previousProject);
    });
  };

  const remove = async (font: FontAsset) => {
    setPending("remove");
    setError(null);
    setWarning(null);
    try {
      await withFlushedProject(async () => {
        const previousProject = editorStore.getState().project!;
        const response = await fetch("/api/fonts", {
          method: "DELETE",
          headers: projectRequestHeaders({
            conditional: true,
            headers: { "content-type": "application/json" },
          }),
          body: JSON.stringify({ family: font.family, weight: font.weight }),
        });
        await reconcileFontMutationResponse({
          response,
          previousProject,
          operation: "remove",
          removedFont: font,
        }, {
          replaceProject: editorStore.getState().replaceProject,
          setProjectRevision,
          removeBrowserFaces,
        });
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  };

  const apply = (font: FontAsset) => {
    if (!selectedText) return;
    mutateAndSave(() => editorStore.getState().patchElement({
      id: selectedText.id,
      type: "text",
      patch: { fontFamily: font.family, weight: font.weight },
      screenId: primary?.screenId ?? activeScreenId,
    }));
  };

  return (
    <DialogShell
      title="Fonts"
      description="File-backed font identities used by the editor and deterministic export."
      ariaLabel="Font manager"
      closeLabel="Close font manager"
      onClose={close}
      closeDisabled={pending !== null}
      widthClass="max-w-3xl"
    >
      {view === "system" ? (
        <>
          <SystemFontImport
            registered={project.fonts}
            onImportFace={importSystemFont}
            onBusyChange={(busy) => setPending(busy ? "system" : null)}
            onBack={() => {
              returnedFromSystem.current = true;
              setView("manage");
            }}
          />
          {warning && <StatusMessage tone="warning" className="mt-4 whitespace-pre-wrap">{warning}</StatusMessage>}
        </>
      ) : (
      <>
        <section className={`${editorUi.formPanel} mb-4 sm:flex-row sm:items-center sm:justify-between`}>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Monitor size={15} className="text-slate-500" strokeWidth={1.8} />
              <h3 className={editorUi.sectionLabel}>Installed fonts</h3>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">Copy a font that is already installed on this computer into the project.</p>
          </div>
          <button ref={systemButton} type="button" className={`${editorUi.buttonSecondary} shrink-0`} disabled={pending !== null} onClick={() => setView("system")}>
            Import from system
          </button>
        </section>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <section className={editorUi.formPanel}>
            <div className="flex items-center gap-2">
              <Upload size={15} className="text-slate-500" strokeWidth={1.8} />
              <h3 className={editorUi.sectionLabel}>Upload file</h3>
            </div>
            <label className="block">
              <input
                aria-label="Font file"
                ref={uploadInput}
                type="file"
                accept=".ttf,.otf,.woff,.woff2"
                onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                className="sr-only"
              />
              <span className={`${editorUi.buttonSecondary} w-full justify-start overflow-hidden`}>
                <Upload size={14} strokeWidth={1.8} />
                <span className="truncate">{uploadFile?.name ?? "Choose .ttf, .otf, .woff or .woff2"}</span>
              </span>
            </label>
            <input aria-label="Upload font family" placeholder="Family" value={uploadFamily} onChange={(event) => setUploadFamily(event.target.value)} className={editorUi.field} />
            <input aria-label="Upload font weight" type="number" min={FONT_WEIGHT_MIN} max={FONT_WEIGHT_MAX} step={FONT_WEIGHT_STEP} value={uploadWeight} onChange={(event) => setUploadWeight(Number(event.target.value))} className={editorUi.field} />
            <button className={editorUi.buttonPrimary} disabled={pending !== null || !uploadFile || !uploadFamily.trim()} onClick={addUpload}>
              {pending === "upload" ? "Adding…" : "Add uploaded font"}
            </button>
          </section>

          <section className={editorUi.formPanel}>
            <div className="flex items-center gap-2">
              <CloudDownload size={15} className="text-slate-500" strokeWidth={1.8} />
              <h3 className={editorUi.sectionLabel}>Google Fonts</h3>
            </div>
            <p className="text-xs leading-5 text-slate-500">Downloaded once and stored in the project. Rendering stays offline.</p>
            <input aria-label="Google font family" placeholder="Family, e.g. Inter" value={googleFamily} onChange={(event) => setGoogleFamily(event.target.value)} className={editorUi.field} />
            <input aria-label="Google font weight" type="number" min={FONT_WEIGHT_MIN} max={FONT_WEIGHT_MAX} step={FONT_WEIGHT_STEP} value={googleWeight} onChange={(event) => setGoogleWeight(Number(event.target.value))} className={editorUi.field} />
            <button className={editorUi.buttonPrimary} disabled={pending !== null || !googleFamily.trim()} onClick={addGoogle}>
              {pending === "google" ? "Adding…" : "Add Google font"}
            </button>
          </section>
        </div>

        {error && <StatusMessage tone="error" className="mt-4 whitespace-pre-wrap">{error}</StatusMessage>}
        {warning && <StatusMessage tone="warning" className="mt-4 whitespace-pre-wrap">{warning}</StatusMessage>}

        <section className="mt-5 flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h3 className={editorUi.sectionLabel}>Registered</h3>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">{project.fonts.length} identities</span>
          </div>
          {project.fonts.length === 0 ? (
            <EmptyResourceState
              icon={Type}
              title="No fonts registered"
              description="Studio Sans is already available in the Inspector. Add a project font here only when you need another typeface."
              path="assets/fonts/"
            />
          ) : project.fonts.map((font) => {
            const usage = countProjectFontUsage(project, font);
            return (
              <div key={fontIdentityKey(font)} data-testid={`font-row-${font.family}-${font.weight}`} className={`${editorUi.resourceCard} flex flex-col items-stretch gap-3 sm:flex-row sm:items-center`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <strong className="text-slate-900">{font.family}</strong>
                    <span className="font-medium tabular-nums">{font.weight}</span>
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{font.source}</span>
                    {usage > 0 && <span className="text-slate-400">used {usage}×</span>}
                  </div>
                  <p data-testid={`font-preview-${font.family}-${font.weight}`} style={{ fontFamily: `"${font.family}"`, fontWeight: font.weight }} className="mt-2 truncate text-xl text-slate-900">
                    The quick brown fox 0123
                  </p>
                </div>
                <div className="flex gap-2 sm:contents">
                  <button className={`${editorUi.buttonSecondary} flex-1 sm:flex-none`} disabled={!selectedText || pending !== null} onClick={() => apply(font)}>Apply</button>
                  <button className={`${editorUi.buttonDanger} flex-1 sm:flex-none`} disabled={pending !== null} onClick={() => remove(font)}>Remove</button>
                </div>
              </div>
            );
          })}
        </section>
      </>
      )}
    </DialogShell>
  );
}
