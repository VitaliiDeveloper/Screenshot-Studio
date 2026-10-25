// SPDX-License-Identifier: Apache-2.0
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { switchActiveProject } from "@web/lib/editor/debounced-save";
import {
  activateEditorRouteEntry,
  canonicalEditorUrlForSelection,
} from "@web/lib/editor/editor-route";
import { fetchActiveProject } from "@web/lib/clients/project-session";
import { EditorWorkspace } from "./editor-workspace";

export function EditorRouteBootstrap({ entryId }: { entryId?: string }) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [expectedProjectId, setExpectedProjectId] = useState<string | null>(null);

  useEffect(() => {
    let current = true;

    const prepare = async () => {
      if (entryId !== undefined) {
        const activated = await switchActiveProject(() => activateEditorRouteEntry(entryId));
        if (current) {
          setExpectedProjectId(activated.projectId);
          setStatus("ready");
        }
        return;
      }

      const selection = await fetchActiveProject();
      if (!selection) throw new Error("No active project is available for this workspace link.");
      const canonicalUrl = canonicalEditorUrlForSelection(selection);
      if (canonicalUrl) {
        router.replace(canonicalUrl);
        return;
      }
      if (current) {
        setExpectedProjectId(selection.projectId);
        setStatus("ready");
      }
    };

    void prepare().catch((caught: unknown) => {
      if (!current) return;
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("error");
    });
    return () => { current = false; };
  }, [attempt, entryId, router]);

  if (status === "ready" && expectedProjectId) {
    return <EditorWorkspace expectedProjectId={expectedProjectId} />;
  }
  if (status === "error") {
    return (
      <main className="grid h-dvh place-items-center bg-[var(--editor-color-surface-subtle)] p-6">
        <div role="alert" className="max-w-lg rounded-xl border border-[var(--editor-color-danger-border)] bg-[var(--editor-color-surface)] p-5 text-sm text-[color:var(--editor-color-danger-text)] shadow-sm">
          <p className="whitespace-pre-wrap">{error}</p>
          {entryId !== undefined ? (
            <button
              type="button"
              className="mt-4 rounded-lg bg-[var(--editor-color-danger)] px-3 py-2 text-xs font-semibold text-[color:var(--editor-color-on-accent)] hover:bg-[var(--editor-color-danger-hover)]"
              onClick={() => {
                setStatus("loading");
                setError(null);
                setExpectedProjectId(null);
                setAttempt((currentAttempt) => currentAttempt + 1);
              }}
            >
              Retry opening project
            </button>
          ) : null}
          <Link
            href="/"
            className="ml-3 inline-flex rounded-lg px-3 py-2 text-xs font-semibold text-[color:var(--editor-color-danger-text)] underline hover:bg-[var(--editor-color-danger-surface)]"
          >
            Return to Projects
          </Link>
        </div>
      </main>
    );
  }
  return (
    <main className="grid h-dvh place-items-center bg-[var(--editor-color-surface-subtle)] text-sm text-[color:var(--editor-color-text-secondary)]">
      Opening workspace…
    </main>
  );
}
