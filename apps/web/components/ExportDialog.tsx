"use client";

import { useState } from "react";
import { useStore } from "zustand";
import { editorStore } from "../lib/editor-store";
import { saveProject } from "../lib/save-project";

/**
 * UI export dialog (spec Slice 3). Small on purpose: platform/device/locale filters (all default
 * to "all"), one pending state, inline errors. It saves the current project first so /render and
 * the export route read exactly what the user sees, then downloads the zip the route returns.
 */
type Platform = "all" | "apple" | "android";
type Device = "all" | "iphone" | "ipad" | "phone";

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useStore(editorStore, (s) => s.project);
  const [platform, setPlatform] = useState<Platform>("all");
  const [device, setDevice] = useState<Device>("all");
  const [locale, setLocale] = useState<string>("all");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneDir, setDoneDir] = useState<string | null>(null);

  if (!open || !project) return null;

  const runExport = async () => {
    setPending(true);
    setError(null);
    setDoneDir(null);
    try {
      await saveProject(project); // await, not the debounced saver, so disk == what the user sees
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
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  const sel = "rounded border border-neutral-300 px-1 py-0.5 text-xs";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="flex w-80 flex-col gap-3 rounded-lg bg-white p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-semibold">Export bundle</h2>

        <label className="flex items-center justify-between text-xs">
          <span className="text-neutral-500">Platform</span>
          <select className={sel} value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
            <option value="all">all</option><option value="apple">apple</option><option value="android">android</option>
          </select>
        </label>

        <label className="flex items-center justify-between text-xs">
          <span className="text-neutral-500">Device</span>
          <select className={sel} value={device} onChange={(e) => setDevice(e.target.value as Device)}>
            <option value="all">all</option><option value="iphone">iphone</option><option value="ipad">ipad</option><option value="phone">phone</option>
          </select>
        </label>

        <label className="flex items-center justify-between text-xs">
          <span className="text-neutral-500">Locale</span>
          <select className={sel} value={locale} onChange={(e) => setLocale(e.target.value)}>
            <option value="all">all</option>
            {project.locales.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>

        {error && <p className="whitespace-pre-wrap text-xs text-red-600">{error}</p>}
        {doneDir && <p className="text-xs text-emerald-600">Wrote bundle to {doneDir}</p>}

        <div className="flex justify-end gap-2">
          <button className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100" onClick={onClose} disabled={pending}>
            Close
          </button>
          <button
            className="rounded bg-neutral-900 px-3 py-1 text-xs text-white hover:bg-neutral-700 disabled:opacity-50"
            onClick={runExport}
            disabled={pending}
          >
            {pending ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}
