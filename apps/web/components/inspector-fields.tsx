// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useRef, useState } from "react";
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

export function NumberField({
  label, value, onChange, step = 1, min, max, integer = false, precision, layout = "row",
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
      <span className="shrink-0 whitespace-nowrap text-slate-500">{label}</span>
      <input
        ref={inputRef}
        type="number"
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
          layout === "column" ? "min-w-0" : "w-28",
          "text-right tabular-nums",
        )}
      />
    </label>
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
    <label className="flex items-center justify-between gap-3 text-xs">
      <span className="shrink-0 whitespace-nowrap text-slate-500">{label}</span>
      <MenuSelect
        ariaLabel={label}
        value={value}
        options={options.map((option) => ({ value: option, label: optionLabels?.[option] ?? option }))}
        onChange={onChange}
        className="w-28"
      />
    </label>
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
