// SPDX-License-Identifier: Apache-2.0

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

const motion = "transition-colors duration-[var(--editor-motion-fast)] ease-[var(--editor-motion-ease)]";
const focusRing = "focus-visible:outline-none focus-visible:ring-[length:var(--editor-focus-width)] focus-visible:ring-[var(--editor-color-focus)] focus-visible:ring-offset-[length:var(--editor-focus-offset)]";
const containedFocusRing = "focus-visible:outline-none focus-visible:ring-[length:var(--editor-focus-width)] focus-visible:ring-[var(--editor-color-focus)]";
const disabled = "disabled:pointer-events-none disabled:opacity-45";
const buttonBase = `inline-flex min-h-8 items-center justify-center gap-1.5 rounded-[var(--editor-radius-control)] px-[var(--editor-space-control-x)] text-[length:var(--editor-font-control-size)] font-normal ${motion} ${disabled} ${focusRing}`;
const iconButtonBase = `inline-flex shrink-0 items-center justify-center ${motion} disabled:pointer-events-none disabled:opacity-35 ${focusRing}`;
const rowIconButtonBase = `inline-flex size-7 shrink-0 items-center justify-center rounded-[var(--editor-radius-compact)] ${motion} ${containedFocusRing}`;

export const editorUi = {
  buttonBase,
  buttonSecondary: `${buttonBase} border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] text-[color:var(--editor-color-text-default)] shadow-[var(--editor-shadow-control)] hover:border-[var(--editor-color-border-strong)] hover:bg-[var(--editor-color-surface-subtle)]`,
  buttonPrimary: `${buttonBase} bg-[var(--editor-color-accent)] font-medium text-[color:var(--editor-color-on-accent)] shadow-[var(--editor-shadow-control)] hover:bg-[var(--editor-color-accent-hover)]`,
  buttonGhost: `${buttonBase} px-[var(--editor-space-control-compact-x)] text-[color:var(--editor-color-text-muted)] hover:bg-[var(--editor-color-surface-muted)] hover:text-[color:var(--editor-color-text-strong)]`,
  buttonGhostAccent: `${buttonBase} px-[var(--editor-space-control-compact-x)] text-[color:var(--editor-color-accent)] hover:bg-[var(--editor-color-accent-subtle)] hover:text-[color:var(--editor-color-accent-hover)]`,
  buttonGhostActive: `${buttonBase} bg-[var(--editor-color-surface-muted)] px-[var(--editor-space-control-compact-x)] text-[color:var(--editor-color-text-strong)] hover:bg-[var(--editor-color-surface-muted)] hover:text-[color:var(--editor-color-text-strong)]`,
  buttonDanger: `${buttonBase} border border-[var(--editor-color-danger-border)] bg-[var(--editor-color-surface)] text-[color:var(--editor-color-danger)] shadow-[var(--editor-shadow-control)] hover:bg-[var(--editor-color-danger-surface)]`,
  buttonDangerFilled: `${buttonBase} bg-[var(--editor-color-danger)] font-medium text-[color:var(--editor-color-on-accent)] shadow-[var(--editor-shadow-control)] hover:bg-[var(--editor-color-danger-text)]`,
  iconButton: `${iconButtonBase} size-8 rounded-[var(--editor-radius-control)] text-[color:var(--editor-color-text-subtle)] hover:bg-[var(--editor-color-surface-muted)] hover:text-[color:var(--editor-color-text-default)]`,
  iconButtonActive: `${iconButtonBase} size-8 rounded-[var(--editor-radius-control)] bg-[var(--editor-color-accent-subtle)] text-[color:var(--editor-color-accent-hover)] hover:bg-[var(--editor-color-surface-muted)] hover:text-[color:var(--editor-color-text-default)]`,
  iconButtonDanger: `${iconButtonBase} size-8 rounded-[var(--editor-radius-control)] text-[color:var(--editor-color-text-subtle)] hover:bg-[var(--editor-color-danger-surface)] hover:text-[color:var(--editor-color-danger)]`,
  compactIconButton: `${iconButtonBase} size-6 rounded-[var(--editor-radius-compact)] text-[color:var(--editor-color-text-subtle)] hover:bg-[var(--editor-color-surface-muted)] hover:text-[color:var(--editor-color-text-default)]`,
  compactAddButton: `${iconButtonBase} size-6 rounded-[var(--editor-radius-compact)] text-[color:var(--editor-color-accent)] hover:bg-[var(--editor-color-accent-subtle)] hover:text-[color:var(--editor-color-accent-hover)]`,
  rowIconButton: `${rowIconButtonBase} text-[color:var(--editor-color-text-subtle)] hover:bg-[var(--editor-color-surface)] hover:text-[color:var(--editor-color-text-default)]`,
  rowIconButtonDanger: `${rowIconButtonBase} text-[color:var(--editor-color-danger)] hover:bg-[var(--editor-color-danger-surface)] hover:text-[color:var(--editor-color-danger)]`,
  field: `h-8 w-full rounded-[var(--editor-radius-control)] border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] px-[var(--editor-space-control-compact-x)] text-[length:var(--editor-font-control-size)] text-[color:var(--editor-color-text)] shadow-[var(--editor-shadow-control)] ${motion} placeholder:text-[color:var(--editor-color-text-subtle)] hover:border-[var(--editor-color-border-strong)] focus:border-[var(--editor-color-focus-border)] focus:outline-none focus:ring-[length:var(--editor-focus-width)] focus:ring-[var(--editor-color-focus-subtle)]`,
  textarea: `w-full rounded-[var(--editor-radius-control)] border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] px-[var(--editor-space-control-compact-x)] py-[var(--editor-space-control-y)] text-[length:var(--editor-font-control-size)] text-[color:var(--editor-color-text)] shadow-[var(--editor-shadow-control)] ${motion} placeholder:text-[color:var(--editor-color-text-subtle)] hover:border-[var(--editor-color-border-strong)] focus:border-[var(--editor-color-focus-border)] focus:outline-none focus:ring-[length:var(--editor-focus-width)] focus:ring-[var(--editor-color-focus-subtle)]`,
  rangeInput: `editor-range h-6 w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45`,
  colorField: `h-8 w-28 cursor-pointer rounded-[var(--editor-radius-control)] border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] p-1 shadow-[var(--editor-shadow-control)] ${containedFocusRing}`,
  fieldInvalid: "aria-invalid:border-[var(--editor-color-danger-focus)] aria-invalid:ring-[length:var(--editor-focus-width)] aria-invalid:ring-[var(--editor-color-danger-focus-subtle)]",
  statusError: "rounded-[var(--editor-radius-control)] bg-[var(--editor-color-danger-surface)] px-[var(--editor-space-control-x)] py-[var(--editor-space-control-y)] text-[length:var(--editor-font-control-size)] text-[color:var(--editor-color-danger-text)] ring-1 ring-[var(--editor-color-danger-border)]",
  statusWarning: "rounded-[var(--editor-radius-control)] bg-[var(--editor-color-warning-surface)] px-[var(--editor-space-control-x)] py-[var(--editor-space-control-y)] text-[length:var(--editor-font-control-size)] text-[color:var(--editor-color-warning-text)] ring-1 ring-[var(--editor-color-warning-border)]",
  statusProgress: "rounded-[var(--editor-radius-control)] bg-[var(--editor-color-accent-subtle)] px-[var(--editor-space-control-x)] py-[var(--editor-space-control-y)] text-sm text-[color:var(--editor-color-accent-strong)]",
  choiceCard: `cursor-pointer rounded-2xl border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] p-4 ${motion} has-[:checked]:border-[var(--editor-color-accent)] has-[:checked]:bg-[var(--editor-color-accent-subtle)]`,
  choiceCardDisabled: "cursor-not-allowed rounded-2xl border border-[var(--editor-color-border)] bg-[var(--editor-color-surface-subtle)] p-4 opacity-65",
  insetPanel: "flex flex-col gap-[var(--editor-space-section-gap)] rounded-[var(--editor-radius-control)] border border-[var(--editor-color-border)] bg-[var(--editor-color-surface-subtle)] p-[var(--editor-space-inset)]",
  resourceCard: "rounded-[var(--editor-radius-surface)] border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] p-[var(--editor-space-card)] shadow-[var(--editor-shadow-control)]",
  formPanel: "flex flex-col gap-3 rounded-[var(--editor-radius-surface)] border border-[var(--editor-color-border)] bg-[var(--editor-color-surface-subtle-translucent)] p-[var(--editor-space-card)]",
  sectionLabel: "text-[length:var(--editor-font-label-size)] font-normal uppercase tracking-[var(--editor-font-label-tracking)] text-[color:var(--editor-color-text-secondary)]",
  segmentedControl: "inline-flex shrink-0 gap-0.5 rounded-lg border border-[var(--editor-color-border)] bg-[var(--editor-color-surface-muted)] p-1",
  segmentedControlFill: "flex w-full",
  segmentedButton: `inline-flex h-6 items-center justify-center whitespace-nowrap rounded-md font-medium ${motion} disabled:pointer-events-none disabled:opacity-50 ${containedFocusRing}`,
  segmentedButtonDefault: "min-w-12 px-2.5",
  segmentedButtonCompact: "min-w-0 px-1.5",
  segmentedButtonFill: "flex-1",
  segmentedButtonLabel: "inline-flex items-center justify-center gap-1.5 text-xs leading-none",
  segmentedButtonActive: "bg-[var(--editor-color-surface)] text-[color:var(--editor-color-text)] shadow-[var(--editor-shadow-control)]",
  segmentedButtonInactive: "text-[color:var(--editor-color-text-muted)] hover:bg-[var(--editor-color-surface-translucent)] hover:text-[color:var(--editor-color-text)]",
  toolButton: `inline-flex w-[50px] flex-col items-center gap-[3px] rounded-[var(--editor-radius-control)] py-1.5 text-[9.5px] leading-none ${motion} ${containedFocusRing}`,
  toolButtonInactive: "text-[color:var(--editor-color-text-secondary)] hover:bg-[var(--editor-color-surface-muted)] hover:text-[color:var(--editor-color-text-strong)]",
  toolButtonActive: "bg-[var(--editor-color-accent-subtle)] font-semibold text-[color:var(--editor-color-accent-hover)] hover:bg-[var(--editor-color-accent-muted)] hover:text-[color:var(--editor-color-accent-strong)]",
};
