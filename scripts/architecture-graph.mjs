#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import console from "node:console";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const OUTPUT_PATH = "docs/graph/graph-data.js";
export const REGENERATE_COMMAND = "pnpm graph:architecture";
const BLOB_URL = "https://github.com/VitaliiDeveloper/Screenshot-Studio/blob/main/";
const DOC = "docs/architecture.md";

// Groups are drawn as nested boxes; areas inside them are the graph's nodes.
export const GROUPS = [
  { id: "web", label: "apps/web" },
  { id: "web-pages", label: "Pages", parent: "web" },
  { id: "web-ui", label: "UI components", parent: "web" },
  { id: "web-client", label: "Client state", parent: "web" },
  { id: "web-api", label: "API routes", parent: "web" },
  { id: "web-server", label: "Server lib", parent: "web" },
  { id: "cli", label: "packages/cli" },
  { id: "core", label: "packages/core" },
  { id: "root", label: "Repository root" },
  { id: "external", label: "Outside the repository" },
];

// Every tracked non-test source file must match exactly one area (enforced by the test).
// Keep these areas in step with docs/architecture-map.md.
export const AREAS = [
  {
    id: "web-home",
    group: "web-pages",
    label: "Home and root layout",
    description: "Project launcher page and the Next root layout.",
    paths: ["apps/web/app/page.tsx", "apps/web/app/layout.tsx", "apps/web/app/home/"],
    doc: "docs/editor.md",
  },
  {
    id: "web-editor-route",
    group: "web-pages",
    label: "Workspace route",
    description: "/editor/[entryId]: activates a project entry and wires editor resources, saves, issues, and agent chat.",
    paths: ["apps/web/app/editor/"],
    doc: `${DOC}#4-project-sources-sessions-and-persistence`,
  },
  {
    id: "web-render",
    group: "web-pages",
    label: "/render target",
    description: "The shared browser render stage. Editor export and the CLI drive this page to produce every PNG.",
    paths: ["apps/web/app/render/"],
    doc: `${DOC}#3-rendering-and-export-parity`,
  },
  {
    id: "web-ui-shell",
    group: "web-ui",
    label: "Shell and panels",
    description: "Editor shell, toolbar, tool rail, layers and screens panels.",
    paths: [
      "apps/web/components/editor-shell/",
      "apps/web/components/toolbar/",
      "apps/web/components/ToolRail.tsx",
      "apps/web/components/LeftPanel.tsx",
      "apps/web/components/LayersSection.tsx",
      "apps/web/components/LayerActionsMenu.tsx",
      "apps/web/components/LayerSearch.tsx",
      "apps/web/components/LayoutSelector.tsx",
      "apps/web/components/ScreensSection.tsx",
      "apps/web/components/SortableRow.tsx",
      "apps/web/components/sizes-bar-model.ts",
    ],
    doc: "docs/editor.md",
  },
  {
    id: "web-ui-canvas",
    group: "web-ui",
    label: "Canvas",
    description: "Canvas viewport, the editor Konva stage, and thumbnails rendered through the core engine.",
    paths: [
      "apps/web/components/canvas-viewport/",
      "apps/web/components/editor-stage/",
      "apps/web/components/EditorStage.tsx",
      "apps/web/components/ScreenThumbnail.tsx",
      "apps/web/components/DeviceFramePreset*.tsx",
    ],
    doc: `${DOC}#3-rendering-and-export-parity`,
  },
  {
    id: "web-ui-inspector",
    group: "web-ui",
    label: "Inspector",
    description: "Property panels for the selected screen or element.",
    paths: ["apps/web/components/inspector/"],
    doc: "docs/editor.md",
  },
  {
    id: "web-ui-dialogs",
    group: "web-ui",
    label: "Dialogs",
    description: "Export, store upload, stores, fonts, themes, templates, locales, issues, and asset dialogs.",
    paths: [
      "apps/web/components/*Dialog*.tsx",
      "apps/web/components/ExportProgressStatus.tsx",
      "apps/web/components/LocaleMatrixTable.tsx",
      "apps/web/components/SystemFontImport.tsx",
      "apps/web/components/asset-picker-model.ts",
      "apps/web/components/export-dialog-model.ts",
      "apps/web/components/font-manager-model.ts",
      "apps/web/components/locale-matrix-model.ts",
      "apps/web/components/play-gallery-model.ts",
      "apps/web/components/system-font-model.ts",
    ],
    doc: "docs/editor.md",
  },
  {
    id: "web-ui-agent",
    group: "web-ui",
    label: "Agent panel",
    description: "Agent picker, chat panel, and attachments.",
    paths: [
      "apps/web/components/agent-panel/",
      "apps/web/components/AgentPanel.tsx",
      "apps/web/components/AgentPicker.tsx",
      "apps/web/components/ComposerAttachments.tsx",
      "apps/web/components/agent-chat-memory.ts",
      "apps/web/components/agent-panel-model.ts",
    ],
    doc: `${DOC}#6-interfaces-for-people-and-tools`,
  },
  {
    id: "web-ui-launcher",
    group: "web-ui",
    label: "Project launcher",
    description: "Project Library: open, create, import, and delete projects.",
    paths: ["apps/web/components/project-launcher/"],
    doc: "docs/editor.md",
  },
  {
    id: "web-ui-primitives",
    group: "web-ui",
    label: "UI primitives",
    description: "Local editor primitives shared by every panel and dialog.",
    paths: ["apps/web/components/editor-ui/", "apps/web/components/editor-ui.tsx"],
    doc: "docs/editor.md",
  },
  {
    id: "web-state",
    group: "web-client",
    label: "Editor store",
    description: "Zustand store, history, selection, debounced save, and client-side view models.",
    paths: [
      "apps/web/lib/editor/",
      "apps/web/lib/export-progress.ts",
      "apps/web/lib/export-selection.ts",
      "apps/web/lib/layout-mode-labels.ts",
      "apps/web/lib/panel-helpers.ts",
      "apps/web/lib/project-assets.ts",
      "apps/web/lib/project-home-model.ts",
      "apps/web/lib/screen-thumbnail.ts",
      "apps/web/lib/store-upload.ts",
    ],
    doc: "docs/editor.md",
  },
  {
    id: "web-clients",
    group: "web-client",
    label: "API clients",
    description: "Typed callers for the /api routes.",
    paths: ["apps/web/lib/clients/"],
    doc: `${DOC}#4-project-sources-sessions-and-persistence`,
  },
  {
    id: "web-api-project",
    group: "web-api",
    label: "Project and session routes",
    description: "project, project-session, instance, recent-projects, project-library.",
    paths: [
      "apps/web/app/api/project/",
      "apps/web/app/api/project-session/",
      "apps/web/app/api/instance/",
      "apps/web/app/api/recent-projects/",
      "apps/web/app/api/project-library/",
    ],
    doc: `${DOC}#4-project-sources-sessions-and-persistence`,
  },
  {
    id: "web-api-lifecycle",
    group: "web-api",
    label: "Project lifecycle routes",
    description: "project-create, project-import, project-delete, project-archive.",
    paths: [
      "apps/web/app/api/project-create/",
      "apps/web/app/api/project-import/",
      "apps/web/app/api/project-delete/",
      "apps/web/app/api/project-archive/",
    ],
    doc: `${DOC}#4-project-sources-sessions-and-persistence`,
  },
  {
    id: "web-api-resources",
    group: "web-api",
    label: "Resource routes",
    description: "asset, assets, fonts, system-fonts, templates, themes, capture-import, store-specs.",
    paths: [
      "apps/web/app/api/asset/",
      "apps/web/app/api/assets/",
      "apps/web/app/api/fonts/",
      "apps/web/app/api/system-fonts/",
      "apps/web/app/api/templates/",
      "apps/web/app/api/themes/",
      "apps/web/app/api/capture-import/",
      "apps/web/app/api/store-specs/",
    ],
    doc: `${DOC}#5-resources-and-trust-boundaries`,
  },
  {
    id: "web-api-output",
    group: "web-api",
    label: "Export and upload routes",
    description: "export, upload, store-credentials.",
    paths: ["apps/web/app/api/export/", "apps/web/app/api/upload/", "apps/web/app/api/store-credentials/"],
    doc: `${DOC}#3-rendering-and-export-parity`,
  },
  {
    id: "web-api-agents",
    group: "web-api",
    label: "Agent routes",
    description: "Agent detection, consent, sessions, and run outcomes.",
    paths: ["apps/web/app/api/agents/"],
    doc: `${DOC}#6-interfaces-for-people-and-tools`,
  },
  {
    id: "web-http",
    group: "web-server",
    label: "Request guard",
    description: "proxy.ts loopback and same-origin guard, JSON and ETag helpers.",
    paths: [
      "apps/web/proxy.ts",
      "apps/web/lib/api-request-guard.server.ts",
      "apps/web/lib/api-error-response.server.ts",
      "apps/web/lib/http-etag.ts",
      "apps/web/lib/json-guards.ts",
      "apps/web/lib/json-response.ts",
    ],
    doc: `${DOC}#4-project-sources-sessions-and-persistence`,
  },
  {
    id: "web-session",
    group: "web-server",
    label: "Sessions",
    description: "Active project session, request fence, Project Library, recents.",
    paths: ["apps/web/lib/session/"],
    doc: `${DOC}#4-project-sources-sessions-and-persistence`,
  },
  {
    id: "web-managed",
    group: "web-server",
    label: "Managed projects",
    description: "Managed project catalog, lifecycle lock, archive, import, deletion.",
    paths: ["apps/web/lib/managed-projects/"],
    doc: `${DOC}#4-project-sources-sessions-and-persistence`,
  },
  {
    id: "web-server-resources",
    group: "web-server",
    label: "Server resources",
    description: "Project asset serving, system fonts, storage lock, private JSON documents.",
    paths: [
      "apps/web/lib/project-asset.server.ts",
      "apps/web/lib/project-assets.server.ts",
      "apps/web/lib/system-fonts.server.ts",
      "apps/web/lib/storage-lock.server.ts",
      "apps/web/lib/private-json-document.server.ts",
    ],
    doc: `${DOC}#5-resources-and-trust-boundaries`,
  },
  {
    id: "web-output",
    group: "web-server",
    label: "Export and upload server",
    description: "Export artifacts and progress, archive artifacts, upload plan, store key folder.",
    paths: [
      "apps/web/lib/export-*.server.ts",
      "apps/web/lib/project-archive-artifacts.server.ts",
      "apps/web/lib/store-*.server.ts",
      "apps/web/lib/store-specs-path.ts",
    ],
    doc: `${DOC}#3-rendering-and-export-parity`,
  },
  {
    id: "web-agents",
    group: "web-server",
    label: "Agent runtime",
    description: "Agent registry, adapters, run guard, render broker, startup sweep.",
    paths: ["apps/web/lib/agents/", "apps/web/instrumentation.ts"],
    doc: `${DOC}#6-interfaces-for-people-and-tools`,
  },
  {
    id: "cli-entry",
    group: "cli",
    label: "Entry and dispatch",
    description: "Parses and routes `screenshots` commands.",
    paths: [
      "packages/cli/src/index.ts",
      "packages/cli/src/command-dispatch.ts",
      "packages/cli/src/command-flags.ts",
      "packages/cli/src/cli-runtime.ts",
      "packages/cli/src/update-check.ts",
    ],
    doc: `${DOC}#6-interfaces-for-people-and-tools`,
  },
  {
    id: "cli-commands",
    group: "cli",
    label: "Project commands",
    description: "Structural edits: layouts, screens, elements, locales, copy, assets, fonts, templates, themes, publishing ids.",
    paths: [
      "packages/cli/src/init.ts",
      "packages/cli/src/*-commands.ts",
      "packages/cli/src/csv.ts",
      "packages/cli/src/direction.ts",
    ],
    doc: `${DOC}#6-interfaces-for-people-and-tools`,
  },
  {
    id: "cli-services",
    group: "cli",
    label: "Resource services",
    description: "Resource files and locked project writes.",
    paths: [
      "packages/cli/src/*-service.ts",
      "packages/cli/src/project-io.ts",
      "packages/cli/src/font-validation.ts",
      "packages/cli/src/system-fonts.ts",
      "packages/cli/src/managed-definition-store.ts",
    ],
    doc: "docs/project-mutation-locking.md",
  },
  {
    id: "cli-host",
    group: "cli",
    label: "Render host",
    description: "Starts the web host and drives /render with Playwright; renders through the editor inside an agent run.",
    paths: [
      "packages/cli/src/server.ts",
      "packages/cli/src/packaged-render-host.ts",
      "packages/cli/src/render-driver.ts",
      "packages/cli/src/render-host-readiness.ts",
      "packages/cli/src/browser-setup.ts",
      "packages/cli/src/render-through-editor.ts",
      "packages/cli/src/launch-command.ts",
      "packages/cli/src/dev-command.ts",
    ],
    doc: `${DOC}#3-rendering-and-export-parity`,
  },
  {
    id: "cli-export",
    group: "cli",
    label: "Export and check",
    description: "Bundles, web-share and fastlane profiles, check --render.",
    paths: [
      "packages/cli/src/export-command.ts",
      "packages/cli/src/export.ts",
      "packages/cli/src/check-command.ts",
      "packages/cli/src/web-share.ts",
      "packages/cli/src/fastlane-*.ts",
      "packages/cli/src/store-ready-png.ts",
    ],
    doc: `${DOC}#3-rendering-and-export-parity`,
  },
  {
    id: "cli-upload",
    group: "cli",
    label: "Store upload",
    description: "Human-only upload to Google Play and App Store Connect.",
    paths: [
      "packages/cli/src/upload-command.ts",
      "packages/cli/src/app-store-upload-command.ts",
      "packages/cli/src/store-upload-plan.ts",
      "packages/cli/src/google-play-client.ts",
      "packages/cli/src/app-store-connect-client.ts",
      "packages/cli/src/store-credential-env.ts",
    ],
    doc: `${DOC}#3-rendering-and-export-parity`,
  },
  {
    id: "cli-import",
    group: "cli",
    label: "Capture import",
    description: "Import transaction and crash recovery.",
    paths: ["packages/cli/src/import-command.ts", "packages/cli/src/capture-import-*.ts"],
    doc: `${DOC}#5-resources-and-trust-boundaries`,
  },
  {
    id: "cli-publish",
    group: "cli",
    label: "File publication",
    description: "Fail-closed publication of generated files.",
    paths: [
      "packages/cli/src/safe-file/",
      "packages/cli/src/safe-file-publisher.ts",
      "packages/cli/src/bundle-publisher.ts",
      "packages/cli/src/managed-resource-file.ts",
      "packages/cli/src/read-capped-body.ts",
    ],
    doc: "docs/safe-file-publication.md",
  },
  ...[
    ["model", "Strict Zod schema and Project operations.", `${DOC}#2-project-model-and-ownership`],
    ["validation", "Issues engine shared by the editor and `screenshots check`.", `${DOC}#3-rendering-and-export-parity`],
    ["engine", "The one Konva node mapping: elementToNodeConfig, renderScreen, text fit.", `${DOC}#3-rendering-and-export-parity`],
    ["fonts", "Browser FontFace registration before render.", `${DOC}#5-resources-and-trust-boundaries`],
    ["assets", "Browser image preloading before render.", `${DOC}#5-resources-and-trust-boundaries`],
    ["export", "store-specs decoding, bundle entries, profiles, PNG flattening.", `${DOC}#3-rendering-and-export-parity`],
    ["templates", "Built-in starters and screen packs.", `${DOC}#5-resources-and-trust-boundaries`],
    ["themes", "Themes and Design packs.", `${DOC}#5-resources-and-trust-boundaries`],
    ["packs", "Project packs read from packs/<id>/.", `${DOC}#project-packs`],
    ["scaffold", "New-project scaffold.", `${DOC}#6-interfaces-for-people-and-tools`],
    ["storage", "Project file read/write, mutation lock, no-follow open flags.", "docs/project-mutation-locking.md"],
    ["capture-import", "Capture discovery, plan, fingerprint, apply.", `${DOC}#5-resources-and-trust-boundaries`],
    ["agent-render", "File protocol for a sandboxed agent's render requests.", `${DOC}#6-interfaces-for-people-and-tools`],
  ].map(([domain, description, doc]) => ({
    id: `core-${domain}`,
    group: "core",
    label: `${domain}/`,
    description,
    paths: [`packages/core/src/${domain}/`],
    doc,
  })),
  {
    id: "root-store-specs",
    group: "root",
    label: "store-specs.json",
    description: "Output destinations, families, and exact sizes.",
    paths: ["store-specs.json"],
    doc: `${DOC}#1-system-shape`,
  },
];

export const EXTERNALS = [
  { id: "ext-agents", label: "Agent CLIs", description: "Claude Code and Codex, installed and signed in by the user." },
  { id: "ext-google-play", label: "Google Play", description: "androidpublisher v3 API." },
  { id: "ext-app-store", label: "App Store Connect", description: "App Store Connect v1 API." },
];

// Links that no import shows. Each cites a file that implements it; the test checks it exists.
export const RUNTIME_EDGES = [
  { source: "web-clients", target: "web-api", label: "HTTP /api", evidence: "apps/web/lib/clients/project-api-client.ts" },
  { source: "web-state", target: "web-api", label: "HTTP /api", evidence: "apps/web/lib/editor/external-project-changes.ts" },
  { source: "web-editor-route", target: "web-api", label: "HTTP /api", evidence: "apps/web/app/editor/editor-resources.ts" },
  { source: "web-ui-dialogs", target: "web-api", label: "HTTP /api", evidence: "apps/web/components/ExportDialog.tsx" },
  { source: "web-ui-launcher", target: "web-api", label: "HTTP /api", evidence: "apps/web/components/project-launcher/ProjectLauncher.tsx" },
  { source: "cli-host", target: "web-render", label: "Playwright drives /render", evidence: "packages/cli/src/render-driver.ts" },
  { source: "cli-host", target: "web-api-project", label: "POST /api/instance/open", evidence: "packages/cli/src/launch-command.ts" },
  { source: "cli-host", target: "web-agents", label: "render inbox request", evidence: "packages/cli/src/render-through-editor.ts" },
  { source: "web-agents", target: "ext-agents", label: "spawns agent run", evidence: "apps/web/lib/agents/agent-run-process.server.ts" },
  { source: "ext-agents", target: "cli-entry", label: "runs screenshots commands", evidence: "packages/cli/src/project-agent-guide.md" },
  { source: "cli-upload", target: "ext-google-play", label: "HTTPS upload", evidence: "packages/cli/src/google-play-client.ts" },
  { source: "cli-upload", target: "ext-app-store", label: "HTTPS upload", evidence: "packages/cli/src/app-store-connect-client.ts" },
];

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(pattern.endsWith("/") ? `^${escaped}` : `^${escaped}$`);
}

const matchers = AREAS.map((area) => ({ id: area.id, patterns: area.paths.map(globToRegExp) }));

export function areasOf(file) {
  return matchers.filter((m) => m.patterns.some((p) => p.test(file))).map((m) => m.id);
}

export function isGraphSource(file) {
  return (
    /^(apps\/web|packages)\//.test(file) &&
    /\.(ts|tsx)$/.test(file) &&
    !/\.d\.ts$|\.test\.|test-support|\/fixtures\//.test(file)
  );
}

function trackedFiles(root) {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean);
}

function resolveSpecifier(from, specifier, tracked, cliExports) {
  const candidates = (base) => {
    const stem = base.replace(/\.(m?js|jsx)$/, "");
    return [base, `${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`, `${stem}/index.tsx`];
  };
  let options = [];
  if (specifier.startsWith(".")) options = candidates(posix.normalize(posix.join(posix.dirname(from), specifier)));
  else if (specifier.startsWith("@web/")) options = candidates(`apps/web/${specifier.slice(5)}`);
  else if (specifier.startsWith("@screenshot-studio/core/")) {
    options = [`packages/core/src/${specifier.slice("@screenshot-studio/core/".length)}/index.ts`];
  } else if (specifier.startsWith("@screenshot-studio/cli/")) {
    const target = cliExports[`./${specifier.slice("@screenshot-studio/cli/".length)}`];
    if (typeof target === "string") options = [posix.join("packages/cli", target)];
  }
  return options.find((option) => tracked.has(option));
}

export function buildGraph(root = repoRoot) {
  const files = trackedFiles(root);
  const tracked = new Set(files);
  const cliExports = JSON.parse(readFileSync(join(root, "packages/cli/package.json"), "utf8")).exports ?? {};
  const sources = files.filter(isGraphSource).sort();
  const unmapped = [];
  const ambiguous = [];
  const unresolved = [];
  const importers = new Map();

  for (const file of sources) {
    const owners = areasOf(file);
    if (owners.length === 0) unmapped.push(file);
    if (owners.length > 1) ambiguous.push(`${file}: ${owners.join(", ")}`);
    if (owners.length !== 1) continue;
    const text = readFileSync(join(root, file), "utf8");
    for (const { fileName } of ts.preProcessFile(text, true, true).importedFiles) {
      const resolved = resolveSpecifier(file, fileName, tracked, cliExports);
      if (!resolved) {
        if (/^(\.|@web\/|@screenshot-studio\/)/.test(fileName)) unresolved.push(`${file}: ${fileName}`);
        continue;
      }
      const targets = areasOf(resolved);
      if (targets.length !== 1 || targets[0] === owners[0]) continue;
      const key = `${owners[0]}\u0000${targets[0]}`;
      if (!importers.has(key)) importers.set(key, new Set());
      importers.get(key).add(file);
    }
  }

  const nodes = [
    ...GROUPS.map((g) => ({ id: g.id, label: g.label, kind: "group", ...(g.parent ? { parent: g.parent } : {}) })),
    ...AREAS.map((a) => ({
      id: a.id,
      label: a.label,
      kind: "area",
      parent: a.group,
      description: a.description,
      paths: a.paths,
      doc: `${BLOB_URL}${a.doc}`,
    })),
    ...EXTERNALS.map((e) => ({ id: e.id, label: e.label, kind: "external", parent: "external", description: e.description })),
  ];
  const edges = [
    ...[...importers]
      .map(([key, set]) => {
        const [source, target] = key.split("\u0000");
        return { id: `import:${source}->${target}`, source, target, kind: "import", weight: set.size };
      })
      .sort((a, b) => a.id.localeCompare(b.id)),
    ...RUNTIME_EDGES.map((e) => ({
      id: `runtime:${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      kind: "runtime",
      label: e.label,
      evidence: e.evidence,
    })),
  ];
  return { nodes, edges, unmapped, ambiguous, unresolved };
}

// The freshness test compares this projection, so ordinary import changes that only move a
// file count do not fail CI; counts refresh whenever the graph is regenerated.
export function graphStructure({ nodes, edges }) {
  return {
    nodes: nodes.map(({ id, label, kind, parent, description, paths, doc }) => ({ id, label, kind, parent, description, paths, doc })),
    edges: edges.map(({ id, source, target, kind, label, evidence }) => ({ id, source, target, kind, label, evidence })),
  };
}

export function parseGraphData(text) {
  const start = text.indexOf("{");
  return JSON.parse(text.slice(start, text.lastIndexOf("}") + 1));
}

export function renderGraphData(graph) {
  const data = { blobUrl: BLOB_URL, nodes: graph.nodes, edges: graph.edges };
  return (
    `// Generated by scripts/architecture-graph.mjs. Do not edit; run \`${REGENERATE_COMMAND}\`.\n` +
    `window.ARCH_GRAPH = ${JSON.stringify(data, null, 2)};\n`
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const graph = buildGraph();
  const problems = [
    ...graph.unmapped.map((f) => `unmapped: ${f}`),
    ...graph.ambiguous.map((f) => `ambiguous: ${f}`),
    ...graph.unresolved.map((f) => `unresolved import: ${f}`),
  ];
  if (problems.length) {
    console.error("Every source file must belong to exactly one area in scripts/architecture-graph.mjs.");
    for (const line of problems) {
      console.error(`  ${line}`);
    }
    process.exit(1);
  }
  writeFileSync(join(repoRoot, OUTPUT_PATH), renderGraphData(graph));
  const imports = graph.edges.filter((e) => e.kind === "import").length;
  console.log(`Wrote ${OUTPUT_PATH}: ${AREAS.length} areas, ${imports} import edges, ${RUNTIME_EDGES.length} runtime edges.`);
}
