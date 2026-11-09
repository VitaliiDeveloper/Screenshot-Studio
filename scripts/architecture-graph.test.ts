// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AREAS,
  EXTERNALS,
  GROUPS,
  OUTPUT_PATH,
  REGENERATE_COMMAND,
  RUNTIME_EDGES,
  areasOf,
  buildGraph,
  graphStructure,
  parseGraphData,
  repoRoot,
} from "./architecture-graph.mjs";

const graph = buildGraph();

describe("architecture graph", () => {
  it("assigns every source file to exactly one area and resolves every internal import", () => {
    expect(graph.unmapped, "Add these files to an area in scripts/architecture-graph.mjs").toEqual([]);
    expect(graph.ambiguous, "Make the area patterns in scripts/architecture-graph.mjs disjoint").toEqual([]);
    expect(graph.unresolved, "Teach resolveSpecifier this import form").toEqual([]);
  });

  it("matches folder prefixes and single-segment globs only", () => {
    expect(areasOf("packages/cli/src/safe-file/publish.ts")).toEqual(["cli-publish"]);
    expect(areasOf("packages/cli/src/theme-commands.ts")).toEqual(["cli-commands"]);
    expect(areasOf("apps/web/lib/export-progress.ts")).toEqual(["web-state"]);
    expect(areasOf("apps/web/lib/export-progress.server.ts")).toEqual(["web-output"]);
    expect(areasOf("apps/web/components/nested/ExportDialog.tsx")).toEqual([]);
  });

  it("links runtime edges to known nodes and existing evidence", () => {
    const ids = new Set([...GROUPS, ...AREAS, ...EXTERNALS].map((node) => node.id));
    for (const edge of RUNTIME_EDGES) {
      expect(ids.has(edge.source), edge.source).toBe(true);
      expect(ids.has(edge.target), edge.target).toBe(true);
      expect(existsSync(join(repoRoot, edge.evidence)), edge.evidence).toBe(true);
    }
  });

  it("keeps the committed areas and links current", () => {
    const committed = parseGraphData(readFileSync(join(repoRoot, OUTPUT_PATH), "utf8"));
    expect(graphStructure(committed), `${OUTPUT_PATH} is stale; run \`${REGENERATE_COMMAND}\``).toEqual(
      graphStructure(graph),
    );
  });
});
