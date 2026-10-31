// SPDX-License-Identifier: Apache-2.0
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  bundlePreflightWarnings,
  bundleRelativePath,
  findStoreTarget,
  leadStoreSizeId,
  parseStoreSpecs,
  validateBundleArtboards,
  type BundleEntry,
  type StoreSpecs,
} from "@screenshot-studio/core/export";
import {
  findUnresolvedFonts,
  getLayout,
  ProjectValidationError,
  resolveLayoutReference,
  type Project,
  type Screen,
} from "@screenshot-studio/core/model";
import { readIdentifiedProjectSnapshot, resolveExistingProjectPath } from "@screenshot-studio/core/storage";
import { collectLayoutIssues, type IssueLevel, type ProjectIssue } from "@screenshot-studio/core/validation";
import { assertInside } from "./asset-service.js";
import { failWhenServerExits, runWithCleanup } from "./cli-runtime.js";
import { resolveProjectPath } from "./project-io.js";
import { collectRenderedLayoutIssues } from "./render-driver.js";
import { startWebServer } from "./server.js";

export type CheckIssueKind =
  | ProjectIssue["kind"]
  | "invalid-project"
  | "unresolved-font"
  | "missing-font-file"
  | "unknown-size"
  | "artboard-size"
  | "export-path"
  | "android-tablet-screen-count";

/** One `screenshots check` finding; `--json` emits these unchanged, with null for fields that do not apply. */
export interface CheckIssue {
  id: string;
  kind: CheckIssueKind;
  level: IssueLevel;
  message: string;
  layoutId: string | null;
  screenId: string | null;
  /** Store size id the screen exports to. */
  size: string | null;
  locale: string | null;
  elementId: string | null;
}

export interface CheckReport {
  layoutId: string | null;
  /** True only when `--render` measured text in the render host. */
  textMeasured: boolean;
  strict: boolean;
  ok: boolean;
  counts: { blockers: number; warnings: number };
  issues: CheckIssue[];
}

export interface CheckCommandDependencies {
  startWebServer?: typeof startWebServer;
  collectRenderedLayoutIssues?: typeof collectRenderedLayoutIssues;
}

export interface CheckCommandResult {
  output: string;
  exitCode: 0 | 1;
}

function screenSizeId(screen: Screen, specs: StoreSpecs): string {
  return screen.storeTargetId ?? leadStoreSizeId(specs, screen.platform, screen.device);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Mirrors `/api/asset`: a path that escapes the project folder or is not a regular file never loads. */
async function projectFileMissing(root: string, path: string): Promise<boolean> {
  if (isAbsolute(path)) return true;
  try {
    const target = await realpath(resolve(root, path));
    assertInside(root, target, "Project file");
    return !(await stat(target)).isFile();
  } catch {
    return true;
  }
}

async function nodeImageMissing(project: Project, layoutId: string, root: string): Promise<(assetUrl: string) => boolean> {
  // Treating every image as missing makes the engine list exactly the visible references it checks.
  const referenced = new Set(collectLayoutIssues(project, layoutId, { imageMissing: () => true })
    .flatMap((issue) => issue.kind === "missing-image" ? [issue.assetUrl] : []));
  const missing = new Set<string>();
  await Promise.all([...referenced].map(async (assetUrl) => {
    if (await projectFileMissing(root, assetUrl)) missing.add(assetUrl);
  }));
  return (assetUrl) => missing.has(assetUrl);
}

function fromEngine(issue: ProjectIssue, project: Project, specs: StoreSpecs): CheckIssue {
  const screens = getLayout(project, issue.layoutId).screens;
  const findScreen = (id: string) => {
    const found = screens.find((screen) => screen.id === id);
    if (!found) throw new Error(`Issue ${issue.id} names screen "${id}", which is not in layout "${issue.layoutId}"`);
    return found;
  };
  if (issue.kind === "missing-locale-screen") {
    const source = findScreen(issue.sourceScreenId);
    return {
      id: issue.id,
      kind: issue.kind,
      level: issue.level,
      message: `Screen "${source.name}" missing in locale ${issue.locale}${issue.allSizes ? " (all sizes)" : ""}`,
      layoutId: issue.layoutId,
      screenId: issue.sourceScreenId,
      size: issue.allSizes ? null : screenSizeId(source, specs),
      locale: issue.locale,
      elementId: null,
    };
  }
  const screen = findScreen(issue.screenId);
  return {
    id: issue.id,
    kind: issue.kind,
    level: issue.level,
    message: issue.kind === "missing-image"
      ? `Image missing from the project folder: ${issue.assetUrl}`
      : "Text overflows its layer box",
    layoutId: issue.layoutId,
    screenId: screen.id,
    size: screenSizeId(screen, specs),
    locale: screen.locale,
    elementId: issue.elementId,
  };
}

/**
 * Export preflight from core. `buildBundleEntries` throws on the first bad screen, so the same core
 * steps run per screen here to report every one; the group index only numbers file names.
 */
function exportPreflightIssues(project: Project, layoutId: string, specs: StoreSpecs): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const entries: BundleEntry[] = [];
  for (const screen of getLayout(project, layoutId).screens) {
    const base = { layoutId, screenId: screen.id, locale: screen.locale, elementId: null };
    const size = screenSizeId(screen, specs);
    let target: BundleEntry["target"];
    try {
      target = findStoreTarget(specs, screen.platform, screen.device, size);
    } catch (error) {
      issues.push({ ...base, id: `unknown-size:${screen.id}`, kind: "unknown-size", level: "blocker", message: message(error), size });
      continue;
    }
    let entry: BundleEntry;
    try {
      entry = { screen, target, relativePath: bundleRelativePath(screen, target, 0) };
    } catch (error) {
      issues.push({ ...base, id: `export-path:${screen.id}`, kind: "export-path", level: "blocker", message: message(error), size });
      continue;
    }
    entries.push(entry);
    try {
      validateBundleArtboards([entry], specs);
    } catch (error) {
      issues.push({ ...base, id: `artboard-size:${screen.id}`, kind: "artboard-size", level: "blocker", message: message(error), size });
    }
  }
  for (const warning of bundlePreflightWarnings(entries, specs)) {
    issues.push({
      id: `${warning.code}:${warning.device}:${warning.locale}`,
      kind: warning.code,
      level: "warning",
      message: warning.message,
      layoutId,
      screenId: null,
      size: null,
      locale: warning.locale,
      elementId: null,
    });
  }
  return issues;
}

async function fontIssues(project: Project, layoutId: string, root: string): Promise<CheckIssue[]> {
  const none = { layoutId, screenId: null, size: null, locale: null, elementId: null };
  const unresolved = findUnresolvedFonts(project, layoutId).map((font): CheckIssue => ({
    ...none,
    id: `unresolved-font:${font.family}:${font.weight}`,
    kind: "unresolved-font",
    level: "blocker",
    message: `Font "${font.family}" ${font.weight} is not registered; add it in the Fonts dialog or with screenshots font add`,
  }));
  const missingFiles = await Promise.all(project.fonts.map(async (font): Promise<CheckIssue[]> =>
    await projectFileMissing(root, font.path)
      ? [{
        ...none,
        id: `missing-font-file:${font.path}`,
        kind: "missing-font-file",
        level: "blocker",
        message: `Font file missing from the project folder: ${font.path} ("${font.family}" ${font.weight})`,
      }]
      : []));
  return [...unresolved, ...missingFiles.flat()];
}

function report(layoutId: string | null, issues: CheckIssue[], textMeasured: boolean, strict: boolean): CheckReport {
  const sorted = [...issues].sort((a, b) => Number(a.level === "warning") - Number(b.level === "warning"));
  const blockers = sorted.filter((issue) => issue.level === "blocker").length;
  const warnings = sorted.length - blockers;
  return {
    layoutId,
    textMeasured,
    strict,
    ok: blockers === 0 && (!strict || warnings === 0),
    counts: { blockers, warnings },
    issues: sorted,
  };
}

export async function collectCheckReport(
  flags: Record<string, string>,
  defaultStoreSpecsPath: string,
  dependencies: CheckCommandDependencies = {},
): Promise<{ report: CheckReport; notes: string[] }> {
  const strict = flags.strict === "true";
  const storeSpecsPath = flags["store-specs"] ? resolve(flags["store-specs"]) : defaultStoreSpecsPath;
  const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
  const projectPath = await resolveExistingProjectPath(resolveProjectPath(flags));
  const root = dirname(projectPath);
  let snapshot: Awaited<ReturnType<typeof readIdentifiedProjectSnapshot>>;
  try {
    snapshot = await readIdentifiedProjectSnapshot(projectPath);
  } catch (error) {
    if (!(error instanceof ProjectValidationError)) throw error;
    const invalid: CheckIssue = {
      id: "invalid-project",
      kind: "invalid-project",
      level: "blocker",
      message: error.message,
      layoutId: null,
      screenId: null,
      size: null,
      locale: null,
      elementId: null,
    };
    return { report: report(null, [invalid], false, strict), notes: [] };
  }
  const { project, revision } = snapshot;
  const layoutId = resolveLayoutReference(project, flags.layout).id;
  const fonts = await fontIssues(project, layoutId, root);
  const preflight = exportPreflightIssues(project, layoutId, specs);
  const notes: string[] = [];

  let engine: ProjectIssue[];
  let textMeasured = false;
  if (flags.render === "true" && fonts.length === 0) {
    const startServer = dependencies.startWebServer ?? startWebServer;
    const collectRendered = dependencies.collectRenderedLayoutIssues ?? collectRenderedLayoutIssues;
    const server = await startServer(undefined, { storeSpecsPath });
    engine = await runWithCleanup(() => failWhenServerExits(server, collectRendered({
      baseUrl: server.url,
      projectPath,
      projectRevision: revision,
      layoutId,
    })), () => server.stop());
    textMeasured = true;
  } else {
    if (flags.render === "true") notes.push("Text overflow was not measured: fix the font blockers first.");
    engine = collectLayoutIssues(project, layoutId, { imageMissing: await nodeImageMissing(project, layoutId, root) });
  }

  const issues = [...fonts, ...engine.map((issue) => fromEngine(issue, project, specs)), ...preflight];
  return { report: report(layoutId, issues, textMeasured, strict), notes };
}

function issueLine(issue: CheckIssue): string {
  const where = [
    issue.screenId && `screen=${issue.screenId}`,
    issue.size && `size=${issue.size}`,
    issue.locale && `locale=${issue.locale}`,
    issue.elementId && `element=${issue.elementId}`,
  ].filter(Boolean).join(" ");
  return `${issue.level.padEnd(7)}  ${issue.kind}  ${issue.message}${where ? `  [${where}]` : ""}`;
}

function summary({ counts, textMeasured }: CheckReport, renderRequested: boolean): string {
  const parts = [
    ...(counts.blockers > 0 ? [`${counts.blockers} blocker${counts.blockers === 1 ? "" : "s"}`] : []),
    ...(counts.warnings > 0 ? [`${counts.warnings} warning${counts.warnings === 1 ? "" : "s"}`] : []),
  ];
  const result = parts.length > 0 ? parts.join(", ") : "No issues";
  return textMeasured || renderRequested ? result : `${result} (text overflow not measured; run with --render)`;
}

/** `screenshots check`: the editor's Issues plus export preflight, without exporting. */
export async function runCheckCommand(
  flags: Record<string, string>,
  defaultStoreSpecsPath: string,
  dependencies: CheckCommandDependencies = {},
): Promise<CheckCommandResult> {
  const { report: result, notes } = await collectCheckReport(flags, defaultStoreSpecsPath, dependencies);
  const output = flags.json === "true"
    ? JSON.stringify(result, null, 2)
    : [...result.issues.map(issueLine), ...notes, summary(result, flags.render === "true")].join("\n");
  return { output, exitCode: result.ok ? 0 : 1 };
}
