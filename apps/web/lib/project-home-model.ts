// SPDX-License-Identifier: Apache-2.0
import { leadStoreSizeId, type StoreSpecs } from "@screenshot-studio/core/export";
import type { Project, Screen } from "@screenshot-studio/core/model";
import type { ActiveProjectSelection } from "./project-session.js";
import { storeOutputLabel } from "./editor-workspace.js";

const PLATFORM_LABELS: Record<string, string> = {
  apple: "App Store",
  android: "Google Play",
  windows: "Microsoft Store",
};

const SOURCE_LABELS: Record<string, string> = {
  "local-file": "Local project file",
  "managed-project": "Managed browser project",
};

export type ProjectHomeActionId =
  | "continue-editing"
  | "manage-layouts"
  | "add-screen"
  | "manage-locales"
  | "capture-import"
  | "import-project"
  | "store-image-export"
  | "project-archive-export"
  | "permanently-delete-project";

export interface ProjectHomeAction {
  id: ProjectHomeActionId;
  label: string;
  description: string;
  enabled: boolean;
  href?: string;
}

export interface ProjectHomeReadinessItem {
  kind: "empty-screens" | "missing-assets" | "font-warning" | "save-error";
  label: string;
  detail: string;
}

export interface ProjectHomeSummary {
  name: string;
  source: { kind: string; label: string; location?: string };
  platforms: string[];
  locales: string[];
  screenCount: number;
  emptyScreenCount: number;
  preferredLayout: { id: string; name: string };
  layouts: Array<{
    id: string;
    name: string;
    mode: "isolated" | "connected";
    screenCount: number;
    emptyScreenCount: number;
    preferred: boolean;
  }>;
  outputFamilies: Array<{
    key: string;
    label: string;
    screenCount: number;
    storeTargets: string[];
  }>;
  representativeScreens: Array<{
    layoutId: string;
    screenId: string;
    name: string;
    layoutName: string;
  }>;
  readiness: ProjectHomeReadinessItem[];
  actions: ProjectHomeAction[];
}

function targetLabel(specs: StoreSpecs, screen: Screen): string {
  const targetId = screen.storeTargetId ?? leadStoreSizeId(screen.platform, screen.device);
  return specs[screen.platform]?.[screen.device]?.find((target) => target.id === targetId)?.label
    ?? targetId;
}

function buildActions(selection: ActiveProjectSelection): ProjectHomeAction[] {
  const canEdit = selection.capabilities.writeInPlace;
  return [
    { id: "continue-editing", label: "Continue in Workspace", description: "Return to the full editor with this project selected.", enabled: canEdit, href: canEdit ? "/editor" : undefined },
    { id: "manage-layouts", label: "Manage layouts and screens", description: "Open the existing Workspace structure tools.", enabled: canEdit, href: canEdit ? "/editor?intent=layouts" : undefined },
    { id: "add-screen", label: "Add a screen", description: "Open the existing screen actions in Workspace.", enabled: canEdit, href: canEdit ? "/editor?intent=add-screen" : undefined },
    { id: "manage-locales", label: "Manage locales", description: "Open the existing locale manager in Workspace.", enabled: canEdit, href: canEdit ? "/editor?intent=locales" : undefined },
    { id: "capture-import", label: "Capture import", description: "Preview a PNG capture folder, then add it to this project or a new managed project.", enabled: true },
    { id: "import-project", label: "Import another project", description: "Validate a Folder, project ZIP, or JSON into a separate managed copy.", enabled: true, href: "/?switch=1" },
    { id: "store-image-export", label: "Export store images", description: "Render exact store-ready PNG bundles from the shared Workspace renderer.", enabled: true, href: "/editor?intent=export" },
    { id: "project-archive-export", label: "Export project archive", description: "Download a portable project backup for later project import.", enabled: selection.capabilities.exportProjectArchive },
    { id: "permanently-delete-project", label: "Permanently delete project", description: "Irreversibly delete this managed project and its project-local resources.", enabled: selection.capabilities.deleteProjectPermanently },
  ];
}

export function buildProjectHomeSummary({
  project,
  selection,
  specs,
  missingAssets = [],
  fontWarnings = [],
  saveError,
}: {
  project: Project;
  selection: ActiveProjectSelection;
  specs: StoreSpecs;
  missingAssets?: string[];
  fontWarnings?: string[];
  saveError?: string | null;
}): ProjectHomeSummary {
  const allScreens = project.layouts.flatMap((layout) => layout.screens);
  const platforms = [...new Set(allScreens.map((screen) => PLATFORM_LABELS[screen.platform] ?? screen.platform))];
  const locales = [...new Set(allScreens.map((screen) => screen.locale))];
  const emptyScreenCount = allScreens.filter((screen) => screen.elements.length === 0).length;
  const preferred = project.layouts.find((layout) => layout.id === project.preferredExportLayoutId)!;
  const outputFamilies = new Map<string, { label: string; screens: Screen[]; targets: Set<string> }>();
  for (const screen of allScreens) {
    const key = `${screen.platform}/${screen.device}`;
    const family = outputFamilies.get(key) ?? {
      label: storeOutputLabel(screen.platform, screen.device),
      screens: [],
      targets: new Set<string>(),
    };
    family.screens.push(screen);
    family.targets.add(targetLabel(specs, screen));
    outputFamilies.set(key, family);
  }

  const readiness: ProjectHomeReadinessItem[] = [];
  if (emptyScreenCount > 0) readiness.push({
    kind: "empty-screens",
    label: `${emptyScreenCount} empty screen${emptyScreenCount === 1 ? "" : "s"}`,
    detail: "Add copy, screenshots, or project assets in Workspace.",
  });
  if (missingAssets.length > 0) readiness.push({
    kind: "missing-assets",
    label: `${missingAssets.length} missing project asset${missingAssets.length === 1 ? "" : "s"}`,
    detail: missingAssets.join(", "),
  });
  if (fontWarnings.length > 0) readiness.push({
    kind: "font-warning",
    label: `${fontWarnings.length} font warning${fontWarnings.length === 1 ? "" : "s"}`,
    detail: fontWarnings.join("; "),
  });
  if (saveError) readiness.push({
    kind: "save-error",
    label: "Latest Workspace save failed",
    detail: saveError,
  });

  const location = selection.sourceKind !== "managed-project"
    && selection.capabilities.revealLocation
    && selection.displayLocation
    ? selection.displayLocation
    : undefined;

  return {
    name: project.meta.name,
    source: {
      kind: selection.sourceKind,
      label: SOURCE_LABELS[selection.sourceKind] ?? selection.sourceKind,
      ...(location ? { location } : {}),
    },
    platforms,
    locales,
    screenCount: allScreens.length,
    emptyScreenCount,
    preferredLayout: { id: preferred.id, name: preferred.name },
    layouts: project.layouts.map((layout) => ({
      id: layout.id,
      name: layout.name,
      mode: layout.mode,
      screenCount: layout.screens.length,
      emptyScreenCount: layout.screens.filter((screen) => screen.elements.length === 0).length,
      preferred: layout.id === project.preferredExportLayoutId,
    })),
    outputFamilies: [...outputFamilies].map(([key, family]) => ({
      key,
      label: family.label,
      screenCount: family.screens.length,
      storeTargets: [...family.targets],
    })),
    representativeScreens: project.layouts.map((layout) => {
      const screen = layout.screens.find((candidate) => candidate.storeTargetId === undefined)
        ?? layout.screens[0]!;
      return { layoutId: layout.id, screenId: screen.id, name: screen.name, layoutName: layout.name };
    }),
    readiness,
    actions: buildActions(selection),
  };
}
