// SPDX-License-Identifier: Apache-2.0

import type { KeyboardEvent, ReactNode } from "react";
import {
  OutputIdentityHeader,
  type OutputIdentityRole,
} from "@web/components/editor-ui/OutputIdentityHeader.js";
import { cx } from "@web/components/editor-ui/styles.js";

export function OutputFamilySection({
  label,
  editing,
  headerEditing = editing,
  sizeLabel,
  role,
  testId = "overview-output-row",
  ariaLabel,
  artworkWidth,
  activationLabel,
  onActivate,
  children,
}: {
  label: string;
  editing: boolean;
  /** The selected exact-size row controls the status badge; the family can stay selected separately. */
  headerEditing?: boolean;
  sizeLabel?: string;
  role?: OutputIdentityRole;
  testId?: string;
  ariaLabel?: string;
  artworkWidth?: number;
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
      aria-label={ariaLabel ?? (activatable ? (activationLabel ?? `Edit ${label} output row`) : `${label} output row`)}
      role={activatable ? "button" : undefined}
      tabIndex={activatable ? 0 : undefined}
      data-testid={testId}
      data-editing={editing ? "true" : "false"}
      style={artworkWidth === undefined ? undefined : { width: artworkWidth }}
      className={cx(
        "w-fit shrink-0 self-start rounded-xl transition-shadow duration-200 ease-[var(--editor-motion-ease)] motion-reduce:transition-none",
        editing && "ring-2 ring-blue-500/30 ring-offset-8 ring-offset-slate-50",
        activatable && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
      )}
      onClick={activate}
      onKeyDown={onKeyDown}
    >
      <OutputIdentityHeader
        label={label}
        editing={headerEditing}
        sizeLabel={sizeLabel}
        role={role}
        constrained={artworkWidth !== undefined}
      />
      {children}
    </section>
  );
}
