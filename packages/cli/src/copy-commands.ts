// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import {
  applyElementPatch,
  elementLeaves,
  findElementLocation,
  getLayout,
  layoutLocales,
  parseProject,
  slotCounterpart,
  type DesignLayout,
  type Project,
  type Screen,
  type TextElement,
} from "@screenshot-studio/core/model";
import type { ProjectLockOptions } from "@screenshot-studio/core/storage";
import { formatCsv, parseCsv } from "./csv.js";
import { assertTextFontRegistered } from "./element-commands.js";
import { resolveMutationLayout } from "./layout-commands.js";
import { loadProjectFile, updateProjectFile } from "./project-io.js";
import { publishFileSafely } from "./safe-file-publisher.js";

/** One text layer of a base-locale screen, addressed like `element set <screen> <element>`. */
export interface CopyRow {
  screen: string;
  element: string;
  source: string;
  text: Record<string, string>;
}

export interface CopyTable {
  /** Only the JSON format records these; CSV carries just the header and rows. */
  layout?: string;
  base?: string;
  locales: string[];
  rows: CopyRow[];
}

export interface CopyImportReport {
  written: number;
  skipped: number;
  unchanged: number;
  warnings: string[];
}

const FIXED_COLUMNS = ["screen", "element", "source"] as const;
const USAGE = [
  "Usage: screenshots copy <command>",
  "  export [--layout <id>] [--locale <code>[,<code>...]] --out <file.csv|file.json>",
  "  import <file.csv|file.json> [--layout <id>] [--force]",
].join("\n");

function formatOf(file: string): "csv" | "json" {
  const extension = extname(file).toLowerCase();
  if (extension === ".csv") return "csv";
  if (extension === ".json") return "json";
  throw new Error(`Copy file must end in .csv or .json: ${file}`);
}

function sameSizeRow(left: Screen, right: Screen): boolean {
  return left.platform === right.platform
    && left.device === right.device
    && left.storeTargetId === right.storeTargetId;
}

/**
 * Locales keep no link between their screens or layers (clones get fresh ids), so the counterpart
 * of a base text layer is the layer at the same position on the screen at the same position of its
 * size row. A target locale whose layer structure diverged has no counterpart and is never guessed.
 */
function counterpartText(layout: DesignLayout, base: Screen, elementId: string, locale: string) {
  const index = layout.screens.filter((screen) => screen.locale === base.locale && sameSizeRow(screen, base)).indexOf(base);
  const target = layout.screens.filter((screen) => screen.locale === locale && sameSizeRow(screen, base))[index];
  const element = target && slotCounterpart(base, elementId, target);
  return target && element?.type === "text" ? { screen: target, element } : undefined;
}

function layoutLocalesSplit(layout: DesignLayout): { base: string; others: string[] } {
  const [base, ...others] = layoutLocales(layout);
  if (!base) throw new Error("Layout has no screens");
  return { base, others };
}

export function buildCopyTable(layout: DesignLayout, requested?: readonly string[]): CopyTable {
  const { base, others } = layoutLocalesSplit(layout);
  const locales = requested && requested.length > 0 ? [...new Set(requested)] : others;
  for (const locale of locales) {
    if (locale === base) throw new Error(`"${locale}" is the base locale; it is the source column`);
    if (!others.includes(locale)) throw new Error(`Unknown locale "${locale}"; layout locales: ${[base, ...others].join(", ")}`);
    if ((FIXED_COLUMNS as readonly string[]).includes(locale)) throw new Error(`Locale "${locale}" collides with a column name`);
  }
  const rows = layout.screens.filter((screen) => screen.locale === base).flatMap((screen) =>
    screen.elements.flatMap(elementLeaves).flatMap((leaf): CopyRow[] => leaf.type !== "text" ? [] : [{
      screen: screen.id,
      element: leaf.id,
      source: leaf.content,
      text: Object.fromEntries(locales.map((locale) => [
        locale,
        counterpartText(layout, screen, leaf.id, locale)?.element.content ?? "",
      ])),
    }]));
  return { layout: layout.id, base, locales, rows };
}

export function serializeCopyTable(table: CopyTable, format: "csv" | "json"): string {
  if (format === "json") return `${JSON.stringify(table, null, 2)}\n`;
  return formatCsv([
    [...FIXED_COLUMNS, ...table.locales],
    ...table.rows.map((row) => [row.screen, row.element, row.source, ...table.locales.map((locale) => row.text[locale] ?? "")]),
  ]);
}

function parseJsonTable(text: string): CopyTable {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Copy file is not valid JSON");
  }
  const { layout, base, locales, rows } = (parsed ?? {}) as Record<string, unknown>;
  const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
  if (!isStrings(locales) || !Array.isArray(rows)) throw new Error('Copy JSON needs "locales" (strings) and "rows" (array)');
  for (const [index, row] of rows.entries()) {
    const { screen, element, source, text: cells } = (row ?? {}) as Record<string, unknown>;
    const valid = typeof screen === "string" && typeof element === "string" && typeof source === "string"
      && typeof cells === "object" && cells !== null
      && Object.values(cells).every((cell) => typeof cell === "string");
    if (!valid) throw new Error(`Copy JSON row ${index + 1} needs string "screen", "element", "source" and a "text" object of strings`);
  }
  return {
    ...(typeof layout === "string" ? { layout } : {}),
    ...(typeof base === "string" ? { base } : {}),
    locales,
    rows: rows as CopyRow[],
  };
}

function parseCsvTable(text: string): CopyTable {
  const [header, ...records] = parseCsv(text);
  if (!header || FIXED_COLUMNS.some((column, index) => header[index] !== column)) {
    throw new Error(`Copy CSV header must start with ${FIXED_COLUMNS.join(",")}`);
  }
  const locales = header.slice(FIXED_COLUMNS.length);
  if (new Set(locales).size !== locales.length) throw new Error("Copy CSV repeats a locale column");
  return {
    locales,
    rows: records.map((record, index) => {
      if (record.length !== header.length) {
        throw new Error(`Copy CSV row ${index + 2} has ${record.length} columns; expected ${header.length}`);
      }
      const [screen, element, source, ...cells] = record as [string, string, string, ...string[]];
      return { screen, element, source, text: Object.fromEntries(locales.map((locale, column) => [locale, cells[column]!])) };
    }),
  };
}

export function parseCopyTable(text: string, format: "csv" | "json"): CopyTable {
  return format === "json" ? parseJsonTable(text) : parseCsvTable(text);
}

/**
 * Writes translated cells through the same `applyElementPatch` and `parseProject` path as
 * `element set`, with `content` as the only patched field so geometry and direction stay put.
 * Structural problems throw before anything is applied; the caller's lock then writes nothing.
 */
export function applyCopyTable(
  project: Project,
  layout: DesignLayout,
  table: CopyTable,
  force: boolean,
): { project: Project; report: CopyImportReport } {
  const { base, others } = layoutLocalesSplit(layout);
  if (table.base !== undefined && table.base !== base) {
    throw new Error(`Copy file base locale "${table.base}" differs from the layout's "${base}"`);
  }
  for (const locale of table.locales) {
    if (locale === base) throw new Error(`"${locale}" is the base locale and cannot be imported`);
    if (!others.includes(locale)) throw new Error(`Unknown locale column "${locale}"; layout locales: ${others.join(", ")}`);
  }

  const unknown: string[] = [];
  const seen = new Set<string>();
  const resolved = table.rows.map((row) => {
    const key = `${row.screen}/${row.element}`;
    const screen = layout.screens.find((candidate) => candidate.id === row.screen && candidate.locale === base);
    const leaf = screen && findElementLocation(screen, row.element)?.element;
    if (!screen || leaf?.type !== "text") {
      unknown.push(key);
      return undefined;
    }
    if (seen.has(key)) throw new Error(`Copy file repeats row ${key}`);
    seen.add(key);
    return { row, screen, leaf };
  });
  if (unknown.length > 0) {
    throw new Error(`Unknown base-locale text layers (nothing written): ${unknown.join(", ")}`);
  }

  const next = structuredClone(project);
  const nextLayout = getLayout(next, layout.id);
  const report: CopyImportReport = { written: 0, skipped: 0, unchanged: 0, warnings: [] };
  for (const { row, screen, leaf } of resolved as NonNullable<typeof resolved[number]>[]) {
    const stale = leaf.content !== row.source;
    for (const locale of table.locales) {
      const cell = row.text[locale] ?? "";
      if (cell === "") continue;
      const label = `${row.screen}/${row.element} [${locale}]`;
      const target = counterpartText(layout, screen, row.element, locale);
      if (target?.element.content === cell) {
        report.unchanged += 1;
        continue;
      }
      if (stale && !force) {
        report.skipped += 1;
        report.warnings.push(`Skipped ${label}: base text changed since export (use --force to write anyway)`);
        continue;
      }
      if (!target) {
        report.skipped += 1;
        report.warnings.push(`Skipped ${label}: no matching text layer in ${locale} (layer structure differs)`);
        continue;
      }
      const nextScreen = nextLayout.screens.find((candidate) => candidate.id === target.screen.id)!;
      const element = findElementLocation(nextScreen, target.element.id)!.element as TextElement;
      applyElementPatch(element, { content: cell });
      assertTextFontRegistered(next, element);
      report.written += 1;
    }
  }
  return { project: report.written === 0 ? project : parseProject(next), report };
}

function formatReport(report: CopyImportReport): string {
  return [...report.warnings, `Written ${report.written}, skipped ${report.skipped}, unchanged ${report.unchanged}`].join("\n");
}

export async function runCopyCommand(
  projectPath: string,
  args: string[],
  flags: Record<string, string>,
  lockOptions: ProjectLockOptions = {},
): Promise<string> {
  const [subcommand, file, extra] = args;
  const json = flags.json === "true";
  if (subcommand === "export" && file === undefined) {
    if (!flags.out) throw new Error("copy export requires --out <file.csv|file.json>");
    if (flags.force !== undefined) throw new Error("--force applies only to copy import");
    const out = resolve(flags.out);
    const format = formatOf(out);
    const layout = resolveMutationLayout(await loadProjectFile(projectPath), flags.layout);
    const requested = flags.locale?.split(",").map((locale) => locale.trim()).filter(Boolean);
    const table = buildCopyTable(layout, requested);
    const publication = await publishFileSafely({
      root: dirname(out),
      relativePath: basename(out),
      bytes: new TextEncoder().encode(serializeCopyTable(table, format)),
      replace: true,
    });
    if (json) return JSON.stringify({ file: publication.path, layout: layout.id, base: table.base, locales: table.locales, rows: table.rows.length });
    return `Exported ${table.rows.length} text layers x ${table.locales.length} locales to ${publication.path}`;
  }
  if (subcommand === "import" && file && extra === undefined) {
    if (flags.out !== undefined || flags.locale !== undefined) throw new Error("--out and --locale apply only to copy export");
    const path = resolve(file);
    const table = parseCopyTable(await readFile(path, "utf8"), formatOf(path));
    const { value } = await updateProjectFile(projectPath, (project) => {
      const layout = resolveMutationLayout(project, flags.layout ?? table.layout);
      const result = applyCopyTable(project, layout, table, flags.force === "true");
      return { project: result.project, value: result.report };
    }, lockOptions);
    return json ? JSON.stringify(value) : formatReport(value);
  }
  throw new Error(USAGE);
}
