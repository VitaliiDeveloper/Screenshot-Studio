// SPDX-License-Identifier: Apache-2.0
"use client";

import { useState } from "react";
import { fitTextSize } from "@screenshot-studio/core/engine";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import type { Project } from "@screenshot-studio/core/model";
import type { ProjectIssue } from "@screenshot-studio/core/validation";
import { cx, editorUi, WrapAtSeparators } from "@web/components/editor-ui";
import { textSizeStatus, type TextSizeState } from "@web/lib/editor/editor-issues";
import { applyTextFit } from "@web/lib/editor/editor-text-fit";
import { InspectorSection as Section } from "./InspectorSection";

const STATE_COPY: Record<TextSizeState, string> = {
  checking: "checking…",
  fits: "fits",
  overflows: "text overflows",
  hidden: "hidden",
  unmatched: "no matching layer",
};

/** Status by size (Handoff 6a): whether the selected text layer fits on each exact size of its slot. */
export function TextSizeStatusSection({
  project,
  layoutId,
  screenId,
  elementId,
  issues,
  measured,
  specs,
}: {
  project: Project;
  layoutId: string;
  screenId: string;
  elementId: string;
  issues: readonly ProjectIssue[];
  measured: boolean;
  specs?: StoreSpecs;
}) {
  const [unfittable, setUnfittable] = useState<string | null>(null);
  const rows = textSizeStatus(project, layoutId, screenId, elementId, issues, measured, specs);

  return (
    <Section title="Status by size">
      <ul aria-label="Status by size" className="flex flex-col gap-1.5">
        {rows.map(({ screen, label, current, element, state }) => {
          const overflows = state === "overflows";
          const status = current ? (overflows ? "editing · text overflows" : "editing") : STATE_COPY[state];
          const fitKey = `${screen.id}:${element?.id}`;
          return (
            <li key={screen.id} className="flex flex-col gap-1">
              <div
                className={cx(
                  "flex min-h-7 items-center gap-2 text-xs",
                  overflows
                    ? "text-[color:var(--editor-color-warning-text)]"
                    : "text-[color:var(--editor-color-text-secondary)]",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    "size-[7px] shrink-0 rounded-full",
                    overflows
                      ? "bg-[var(--editor-color-warning-border)]"
                      : current
                        ? "bg-[var(--editor-color-accent)]"
                        : state === "fits"
                          ? "bg-emerald-500"
                          : "bg-[var(--editor-color-border-strong)]",
                  )}
                />
                <span className="min-w-0 flex-1"><WrapAtSeparators text={label} /> — {status}</span>
                {overflows && element ? (
                  <button
                    type="button"
                    aria-label={`Fit text on ${label}`}
                    className={cx(editorUi.buttonSecondary, "!min-h-6 !px-2 !text-[11px]")}
                    onClick={() => {
                      const size = fitTextSize(element, screen.direction);
                      if (size) applyTextFit(screen.id, element.id, size);
                      else setUnfittable(fitKey);
                    }}
                  >
                    Fit
                  </button>
                ) : null}
              </div>
              {overflows && unfittable === fitKey ? (
                <p className="text-[11px] leading-4 text-[color:var(--editor-color-warning-text)]">
                  The text overflows even at 1 px. Resize the layer instead.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] leading-4 text-[color:var(--editor-color-text-subtle)]">
        Fit sets the largest size that fits, on that size only.
      </p>
    </Section>
  );
}
