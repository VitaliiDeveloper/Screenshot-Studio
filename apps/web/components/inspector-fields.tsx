"use client";

import { useEffect, useRef, useState } from "react";
import {
  fontIdentityKey,
  THEME_ROLES,
  type FontAsset,
  type ThemeRole,
} from "@screenshot-studio/core/model";
import { editorUi, MenuSelect, type MenuSelectOption } from "./editor-ui";

/** Small, dumb inspector inputs. One label + control per row; all controlled. */

export function NumberField({
  label, value, onChange, step = 1, min, max, integer = false,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  integer?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(String(value));
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
    if (document.activeElement !== inputRef.current) setDraft(String(value));
  }, [value]);

  return (
    <label className="flex items-center justify-between gap-3 text-xs">
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
          if (next !== null) onChange(next);
        }}
        onBlur={() => {
          const next = parse(draft);
          if (next === null) setDraft(String(value));
        }}
        className={`${editorUi.field} w-28 text-right tabular-nums aria-invalid:border-red-400 aria-invalid:ring-2 aria-invalid:ring-red-500/15`}
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
        className="h-8 w-28 cursor-pointer rounded-lg border border-slate-200 bg-white p-1 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70"
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
  label, value, options, onChange,
}: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs">
      <span className="shrink-0 whitespace-nowrap text-slate-500">{label}</span>
      <MenuSelect
        ariaLabel={label}
        value={value}
        options={options.map((option) => ({ value: option, label: option }))}
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
  const resolved = fonts.some((font) => font.family === family && font.weight === weight);
  const options: MenuSelectOption<string>[] = [
    ...(!resolved ? [{ value: current, label: `Missing: ${family} · ${weight}` }] : []),
    ...fonts.map((font) => ({ value: fontIdentityKey(font), label: `${font.family} · ${font.weight}` })),
  ];
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

export function ThemeRoleField({
  value,
  onChange,
}: {
  value: ThemeRole | undefined;
  onChange: (role: ThemeRole | null) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs">
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
  );
}
