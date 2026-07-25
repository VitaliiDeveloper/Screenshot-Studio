// SPDX-License-Identifier: Apache-2.0
"use client";

import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import {
  BUILT_IN_FONT_IDENTITIES,
  fontIdentityKey,
  THEME_ROLES,
  type FontAsset,
  type ThemeRole,
} from "@screenshot-studio/core/model";
import { cx, editorUi, MenuSelect, type MenuSelectOption } from "./editor-ui";

/** Small, dumb inspector inputs. One label + control per row; all controlled. */

export function normalizeNumberFieldValue(value: number, precision?: number): number {
  return precision === undefined ? value : Number(value.toFixed(precision));
}

export function formatNumberFieldValue(value: number, precision?: number): string {
  return String(normalizeNumberFieldValue(value, precision));
}

export function unitToPercent(value: number): number {
  return normalizeNumberFieldValue(Math.min(1, Math.max(0, value)) * 100, 2);
}

export function percentToUnit(value: number): number {
  return normalizeNumberFieldValue(Math.min(100, Math.max(0, value)) / 100, 4);
}

export function rangeProgressStyle(value: number, min: number, max: number): CSSProperties {
  const progress = max === min ? 0 : ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100;
  return { "--editor-range-progress": `${progress}%` } as CSSProperties;
}

export function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  integer = false,
  precision,
  layout = "row",
  suffix,
  controlClassName,
  labelHidden = false,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  precision?: number;
  layout?: "row" | "column";
  suffix?: string;
  controlClassName?: string;
  labelHidden?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(formatNumberFieldValue(value, precision));
  const parse = (raw: string): number | null => {
    if (raw.trim() === "") return null;
    const next = Number(raw);
    if (!Number.isFinite(next)) return null;
    if (integer && !Number.isInteger(next)) return null;
    if (min !== undefined && next < min) return null;
    if (max !== undefined && next > max) return null;
    return next;
  };
  const valid = parse(draft) !== null;

  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setDraft(formatNumberFieldValue(value, precision));
    }
  }, [precision, value]);

  return (
    <label className={layout === "column"
      ? "flex min-w-0 flex-col gap-1.5 text-xs"
      : "flex items-center justify-between gap-3 text-xs"}
    >
      <span className={labelHidden ? "sr-only" : "shrink-0 whitespace-nowrap text-slate-500"}>{label}</span>
      <span className={cx(
        "relative block min-w-0",
        layout === "column" ? "w-full" : "w-28",
        controlClassName,
      )}>
        <input
          ref={inputRef}
          type="number"
          aria-label={label}
          value={draft}
          step={step}
          min={min}
          max={max}
          aria-invalid={!valid}
          onChange={(event) => {
            const raw = event.target.value;
            setDraft(raw);
            const next = parse(raw);
            if (next !== null) onChange(normalizeNumberFieldValue(next, precision));
          }}
          onBlur={() => {
            const next = parse(draft);
            setDraft(formatNumberFieldValue(next ?? value, precision));
          }}
          className={cx(
            editorUi.field,
            editorUi.fieldInvalid,
            suffix ? "pr-7" : undefined,
            "text-right tabular-nums",
          )}
        />
        {suffix ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] text-[color:var(--editor-color-text-secondary)]"
          >
            {suffix}
          </span>
        ) : null}
      </span>
    </label>
  );
}

export function SliderNumberField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  helpText,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  helpText?: string;
  onChange: (value: number) => void;
}) {
  const helpId = useId();
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <span className="text-slate-500">{label}</span>
      {helpText ? <span id={helpId} className="sr-only">{helpText}</span> : null}
      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-2">
        <input
          type="range"
          aria-label={label}
          aria-describedby={helpText ? helpId : undefined}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
          className={editorUi.rangeInput}
          style={rangeProgressStyle(value, min, max)}
        />
        <NumberField
          label={`${label} value`}
          labelHidden
          value={value}
          min={min}
          max={max}
          step={step}
          suffix={suffix}
          controlClassName="!w-full"
          onChange={onChange}
        />
      </div>
    </div>
  );
}

export function ColorField({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs">
      <span className="shrink-0 whitespace-nowrap text-slate-500">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={editorUi.colorField}
      />
    </label>
  );
}

export function TextField({
  label, value, onChange, multiline = false,
}: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs">
      <span className="shrink-0 whitespace-nowrap text-slate-500">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={editorUi.textarea}
          rows={3}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={editorUi.field}
        />
      )}
    </label>
  );
}

export function SelectField<T extends string>({
  label, value, options, optionLabels, onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  optionLabels?: Partial<Record<T, string>>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="shrink-0 whitespace-nowrap text-slate-500">{label}</span>
      <MenuSelect
        ariaLabel={label}
        value={value}
        options={options.map((option) => ({ value: option, label: optionLabels?.[option] ?? option }))}
        onChange={onChange}
        className="w-28"
      />
    </div>
  );
}

export function FontIdentityField({
  fonts, family, weight, onChange,
}: {
  fonts: FontAsset[];
  family: string;
  weight: number;
  onChange: (identity: { family: string; weight: number }) => void;
}) {
  const current = fontIdentityKey({ family, weight });
  const options = fontIdentityOptions(fonts, { family, weight });
  return (
    <label className="flex flex-col gap-1.5 text-xs">
      <span className="text-slate-500">Font</span>
      <MenuSelect
        ariaLabel="Font"
        value={current}
        options={options}
        onChange={(nextValue) => {
          const [nextFamily, nextWeight] = JSON.parse(nextValue) as [string, number];
          onChange({ family: nextFamily, weight: nextWeight });
        }}
      />
    </label>
  );
}

export function fontIdentityOptions(
  fonts: readonly FontAsset[],
  current: { family: string; weight: number },
): MenuSelectOption<string>[] {
  const currentKey = fontIdentityKey(current);
  const allFonts = [
    ...BUILT_IN_FONT_IDENTITIES.map((font) => ({ ...font, builtIn: true as const })),
    ...fonts
      .filter((font) => !BUILT_IN_FONT_IDENTITIES.some((builtIn) => (
        builtIn.family === font.family && builtIn.weight === font.weight
      )))
      .map((font) => ({ ...font, builtIn: false as const })),
  ];
  const resolved = allFonts.some((font) => (
    font.family === current.family && font.weight === current.weight
  ));
  return [
    ...(!resolved ? [{ value: currentKey, label: `Missing: ${current.family} · ${current.weight}` }] : []),
    ...allFonts.map((font) => ({
      value: fontIdentityKey(font),
      label: font.builtIn ? `${font.label} · Built-in` : `${font.family} · ${font.weight}`,
    })),
  ];
}

export function ThemeRoleField({
  value,
  onChange,
}: {
  value: ThemeRole | undefined;
  onChange: (role: ThemeRole | null) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <label className="flex items-center justify-between gap-3">
        <span className="shrink-0 whitespace-nowrap text-slate-500">Theme role</span>
        <MenuSelect
          ariaLabel="Theme role"
          value={value ?? ""}
          options={[
            { value: "", label: "none" },
            ...THEME_ROLES.map((role) => ({ value: role, label: role })),
          ]}
          onChange={(nextValue) => onChange((nextValue || null) as ThemeRole | null)}
          className="w-28"
        />
      </label>
      <p className="text-[11px] leading-4 text-slate-600">
        Used the next time you apply a theme. The current style stays unchanged.
      </p>
    </div>
  );
}
