"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { parseProject } from "@screenshot-studio/core/model";
import { registerProjectFonts } from "@screenshot-studio/core/fonts";
import { editorStore } from "../../lib/editor-store";

// react-konva needs the DOM; load the stage client-only (no SSR).
const EditorStage = dynamic(
  () => import("../../components/EditorStage").then((m) => m.EditorStage),
  { ssr: false },
);

export default function EditorPage() {
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/project");
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to load project");
        const project = parseProject(body);
        await registerProjectFonts(project.fonts); // fonts before first paint (parity)
        editorStore.getState().load(project);
        setReady(true);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  if (error) return <main className="p-6 text-red-600 whitespace-pre-wrap">{error}</main>;
  if (!ready) return <main className="p-6 text-neutral-500">Loading…</main>;
  return (
    <main className="min-h-screen w-full overflow-auto bg-neutral-100 p-8">
      <EditorStage />
    </main>
  );
}
