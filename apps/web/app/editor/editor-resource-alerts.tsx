// SPDX-License-Identifier: Apache-2.0
"use client";

import Link from "next/link";
import type { FontRegistrationFailure } from "@screenshot-studio/core/fonts";

export function WorkspaceLoadError({
  error,
  reloading,
  retry,
}: {
  error: string;
  reloading: boolean;
  retry: () => void;
}) {
  return (
    <div role="alert" className="max-w-lg rounded-xl border border-[var(--editor-color-danger-border)] bg-[var(--editor-color-surface)] p-5 text-sm text-[color:var(--editor-color-danger-text)] shadow-sm">
      <p className="whitespace-pre-wrap">{error}</p>
      <button
        type="button"
        className="mt-4 rounded-lg bg-[var(--editor-color-danger)] px-3 py-2 text-xs font-semibold text-[color:var(--editor-color-on-accent)] hover:bg-[var(--editor-color-danger-hover)]"
        disabled={reloading}
        onClick={retry}
      >
        {reloading ? "Retrying workspace resources…" : "Retry workspace resources"}
      </button>
      <Link
        href="/"
        className="ml-3 inline-flex rounded-lg px-3 py-2 text-xs font-semibold text-[color:var(--editor-color-danger-text)] underline hover:bg-[var(--editor-color-danger-surface)]"
      >
        Return to project launcher
      </Link>
    </div>
  );
}

export function FontWarningsAlert({
  fontWarnings,
  fontRetrying,
  retryFonts,
}: {
  fontWarnings: readonly FontRegistrationFailure[];
  fontRetrying: boolean;
  retryFonts: () => void;
}) {
  return (
    <div role="alert" className="absolute bottom-12 left-16 z-40 max-w-xl rounded-xl border border-[var(--editor-color-warning-border-strong)] bg-[var(--editor-color-warning-surface)] px-3 py-2 text-xs text-[color:var(--editor-color-warning-text-strong)] shadow-lg">
      <p className="font-semibold">Some project fonts could not be loaded.</p>
      <ul className="mt-1 list-disc pl-4">
        {fontWarnings.map(({ font, error: fontError }) => (
          <li key={`${font.family}-${font.weight}-${font.path}`}>
            {font.family} {font.weight} ({font.path}): {fontError.message}
          </li>
        ))}
      </ul>
      <p className="mt-1">
        Preview may use a fallback. Export remains blocked until every project font resolves.
      </p>
      <button
        type="button"
        className="mt-2 rounded-md border border-[var(--editor-color-warning-border-strong)] bg-[var(--editor-color-surface)] px-2 py-1 font-semibold hover:bg-[var(--editor-color-warning-muted)]"
        disabled={fontRetrying}
        onClick={retryFonts}
      >
        {fontRetrying ? "Retrying project fonts…" : "Retry project fonts"}
      </button>
    </div>
  );
}
