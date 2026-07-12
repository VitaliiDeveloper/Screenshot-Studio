// SPDX-License-Identifier: Apache-2.0
"use client";

import { useState } from "react";
import { useStore } from "zustand";
import { Download } from "lucide-react";
import { editorStore } from "../lib/editor-store";
import { withFlushedProject } from "../lib/debounced-save";
import { DialogShell, editorUi, MenuSelect } from "./editor-ui";

/**
 * UI export dialog (spec Slice 3). Small on purpose: platform/device/locale filters (all default
 * to "all"), one pending state, inline errors. It saves the current project first so /render and
 * the export route read exactly what the user sees, then downloads the zip the route returns.
 */
export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useStore(editorStore, (s) => s.project);
  const [platform, setPlatform] = useState("all");
  const [device, setDevice] = useState("all");
  const [locale, setLocale] = useState<string>("all");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneDir, setDoneDir] = useState<string | null>(null);

  if (!open || !project) return null;

  const platforms = Array.from(new Set(project.screens.map((screen) => screen.platform)));
  const devices = Array.from(new Set(project.screens
    .filter((screen) => platform === "all" || screen.platform === platform)
    .map((screen) => screen.device)));

  const runExport = async () => {
    setPending(true);
    setError(null);
    setDoneDir(null);
    try {
      await withFlushedProject(async () => {
        const res = await fetch("/api/export", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            platform: platform === "all" ? undefined : platform,
            device: device === "all" ? undefined : device,
            locale: locale === "all" ? undefined : locale,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Export failed (${res.status})`);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "app-store-screenshots-bundle.zip";
        // Append before click and defer the revoke so the browser doesn't abort a large download.
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        setDoneDir(res.headers.get("x-export-dir"));
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <DialogShell
      title="Export bundle"
      description="Render store-ready PNGs and one zip through the shared export path."
      onClose={onClose}
      widthClass="max-w-md"
    >
      <div className="flex flex-col gap-3">
        <label className="flex items-center justify-between gap-4 text-xs">
          <span className="font-medium text-slate-600">Platform</span>
          <MenuSelect
            ariaLabel="Platform"
            value={platform}
            options={[{ value: "all", label: "all" }, ...platforms.map((value) => ({ value, label: value }))]}
            onChange={(value) => {
              setPlatform(value);
              setDevice("all");
            }}
            className="w-40"
          />
        </label>

        <label className="flex items-center justify-between gap-4 text-xs">
          <span className="font-medium text-slate-600">Device</span>
          <MenuSelect
            ariaLabel="Device"
            value={device}
            options={[{ value: "all", label: "all" }, ...devices.map((value) => ({ value, label: value }))]}
            onChange={setDevice}
            className="w-40"
          />
        </label>

        <label className="flex items-center justify-between gap-4 text-xs">
          <span className="font-medium text-slate-600">Locale</span>
          <MenuSelect
            ariaLabel="Locale"
            value={locale}
            options={[{ value: "all", label: "all" }, ...project.locales.map((entry) => ({ value: entry, label: entry }))]}
            onChange={setLocale}
            className="w-40"
          />
        </label>

        {error && <p className="whitespace-pre-wrap rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200">{error}</p>}
        {doneDir && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 ring-1 ring-emerald-200">Wrote bundle to {doneDir}</p>}

        <div className="mt-2 flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button className={editorUi.buttonSecondary} onClick={onClose} disabled={pending}>
            Close
          </button>
          <button
            className={editorUi.buttonPrimary}
            onClick={runExport}
            disabled={pending}
          >
            <Download size={14} strokeWidth={2} />
            {pending ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}
