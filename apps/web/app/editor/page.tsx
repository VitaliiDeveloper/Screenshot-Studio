"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { parseProject } from "@screenshot-studio/core/model";
import { registerProjectFonts } from "@screenshot-studio/core/fonts";
import { loadProjectImages, type ImageCache } from "@screenshot-studio/core/assets";
import { editorStore } from "../../lib/editor-store";
import { LeftPanel } from "../../components/LeftPanel";

// react-konva needs the DOM; load the stage client-only (no SSR).
const EditorStage = dynamic(
  () => import("../../components/EditorStage").then((m) => m.EditorStage),
  { ssr: false },
);

export default function EditorPage() {
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<ImageCache | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/project");
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to load project");
        const project = parseProject(body);
        const resolveAsset = (assetUrl: string) => `/api/asset?path=${encodeURIComponent(assetUrl)}`;
        const [, cache] = await Promise.all([
          registerProjectFonts(project.fonts), // fonts + images before first paint (parity)
          loadProjectImages(project, resolveAsset),
        ]);
        editorStore.getState().load(project);
        setImages(cache);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  if (error) return <main className="p-6 text-red-600 whitespace-pre-wrap">{error}</main>;
  if (!images) return <main className="p-6 text-neutral-500">Loading…</main>;
  return (
    <main className="flex h-screen w-full">
      <LeftPanel />
      <div className="flex-1 overflow-auto bg-neutral-100 p-8">
        <EditorStage images={images} />
      </div>
    </main>
  );
}
