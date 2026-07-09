"use client";

import {
  fontIdentityKey,
  THEME_ROLES,
  type FontAsset,
  type ThemeRole,
} from "@screenshot-studio/core/model";
import { editorUi } from "./editor-ui";

/** Small, dumb inspector inputs. One label + control per row; all controlled. */

export function NumberField({
  label, value, onChange, step = 1,
}: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs">
      <span className="shrink-0 whitespace-nowrap text-slate-500">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`${editorUi.field} w-28 text-right tabular-nums`}
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
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={`${editorUi.field} w-28`}
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
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
  return (
    <label className="flex flex-col gap-1.5 text-xs">
      <span className="text-slate-500">Font</span>
      <select
        aria-label="Font"
        value={current}
        onChange={(event) => {
          const [nextFamily, nextWeight] = JSON.parse(event.target.value) as [string, number];
          onChange({ family: nextFamily, weight: nextWeight });
        }}
        className={editorUi.field}
      >
        {!resolved && <option value={current}>Missing: {family} · {weight}</option>}
        {fonts.map((font) => (
          <option key={fontIdentityKey(font)} value={fontIdentityKey(font)}>
            {font.family} · {font.weight}
          </option>
        ))}
      </select>
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
      <select
        aria-label="Theme role"
        value={value ?? ""}
        onChange={(event) => onChange((event.target.value || null) as ThemeRole | null)}
        className={`${editorUi.field} w-28`}
      >
        <option value="">none</option>
        {THEME_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
      </select>
    </label>
  );
}
