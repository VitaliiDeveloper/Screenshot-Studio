// SPDX-License-Identifier: Apache-2.0

import type { KeyboardEvent, ReactNode } from "react";
import { cx } from "../editor-ui/styles.js";

export function OutputFamilyRow({
  label,
  editing,
  activationLabel,
  onActivate,
  children,
}: {
  label: string;
  editing: boolean;
  activationLabel?: string;
  onActivate?: () => void;
  children: ReactNode;
}) {
  const activatable = !editing && onActivate !== undefined;
  const activate = () => {
    if (activatable) onActivate();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!activatable || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    activate();
  };

  return (
    <section
      aria-label={activatable ? (activationLabel ?? `Edit ${label} output row`) : `${label} output row`}
      role={activatable ? "button" : undefined}
      tabIndex={activatable ? 0 : undefined}
      data-testid="overview-output-row"
      data-editing={editing ? "true" : "false"}
      className={cx(
        "w-fit shrink-0 self-start rounded-xl",
        editing && "ring-2 ring-blue-500/30 ring-offset-8 ring-offset-slate-50",
        activatable && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
      )}
      onClick={activate}
      onKeyDown={onKeyDown}
    >
      <header className="mb-3 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        <span>{label}</span>
        {editing ? (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[9px] tracking-normal text-blue-700">
            Editing
          </span>
        ) : null}
        <span className="h-px min-w-12 flex-1 bg-slate-200" aria-hidden="true" />
      </header>
      {children}
    </section>
  );
}
