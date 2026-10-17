// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  toolbarDensityProbeFocusRestoration,
  toolbarDensityTransitionFocusPolicy,
} from "./use-toolbar-density";

const densityHookSource = () =>
  readFileSync(new URL("./use-toolbar-density.ts", import.meta.url), "utf8");

describe("toolbar responsive labels", () => {
  it("opens Projects from the product-name crumb and names Export with its file count", () => {
    const source = readFileSync(new URL("./Toolbar.tsx", import.meta.url), "utf8");
    expect(source).toContain('aria-label="Screenshot Studio, back to Projects"');
    expect(source).toContain("onClick={onOpenProjects}");
    expect(source).toContain("disabled={projectsBusy}");
    expect(source).toContain("aria-label={exportLabel}");
    expect(source).toContain("exportFileCount(state.project, state.activeLayoutId, specs)");
    expect(source).toContain("exportCount,");
    expect(source).toContain("<LayoutSelector />");
  });

  it("integrates the measured five-state density model", () => {
    const source = readFileSync(new URL("./Toolbar.tsx", import.meta.url), "utf8");
    const density = densityHookSource();
    const integrated = source + density;

    expect(source).toContain("useToolbarDensity(measurementContentKey)");
    expect(density).toContain("nextToolbarDensity,");
    expect(density).toContain("toolbarGap,");
    expect(density).toContain('from "./toolbar-density";');
    expect(source).toContain('import { ToolbarOverflowMenu } from "./ToolbarOverflowMenu";');
    expect(density).toContain("nextToolbarDensity({");
    expect(density).toContain("toolbarGap({");
    expect(source).toContain("<ToolbarOverflowMenu");
    expect(integrated).toContain('"full"');
    expect(integrated).toContain('"compact"');
    expect(integrated).toContain('"overflow-secondary"');
    expect(integrated).toContain('"overflow-locale"');
    expect(integrated).toContain('"minimal"');
    expect(source).toContain("data-density={density}");
    expect(density).toContain("widthsByContext: Map<ToolbarDensity, Map<string, ToolbarWidths>>;");
    expect(density).toContain("window.innerWidth");
    expect(density).toContain("toolbarDensityProbeTarget(density)");
    expect(density).toContain("resolveToolbarDensityProbe({");
    expect(integrated).not.toContain("resetToFull");
    expect(integrated).not.toContain("latestWidths");
    expect(integrated).not.toContain("forceOneLevelRestore");
    expect(density).toContain("overflowRef.current?.contains(document.activeElement)");
  });

  it("keeps the first toolbar paint hidden until measured density stabilizes", () => {
    const source = readFileSync(new URL("./Toolbar.tsx", import.meta.url), "utf8");
    const density = densityHookSource();

    expect(density).toContain("const [densityReady, setDensityReady] = useState(false);");
    expect(source).toContain("data-density-ready={densityReady}");
    expect(source).toContain('!densityReady && "invisible"');
    expect(density).toContain("setDensityReady(true);");
  });

  it("owns the controlled overflow state and trigger focus ref", () => {
    const source = readFileSync(new URL("./Toolbar.tsx", import.meta.url), "utf8");
    const density = densityHookSource();

    expect(density).toContain("const [overflowOpen, setOverflowOpen] = useState(false);");
    expect(density).toContain("const overflowTriggerRef = useRef<HTMLButtonElement>(null);");
    expect(source).toContain("open={overflowOpen}");
    expect(source).toContain("onOpenChange={setOverflowOpen}");
    expect(source).toContain("triggerRef={overflowTriggerRef}");
  });

  it("does not restart density measurement when the controlled menu opens", () => {
    const source = densityHookSource();

    expect(source).toContain("const overflowOpenRef = useRef(false);");
    expect(source).toContain("overflowOpenRef.current = overflowOpen;");
    expect(source).toContain("overflowOpen: overflowOpenRef.current,");
    expect(source).toContain("}, [density, measurementContentKey]);");
    expect(source).not.toContain("}, [density, measurementContentKey, overflowOpen]);");
  });

  it("closes and focuses More when a focused locale radio is removed", () => {
    expect(toolbarDensityTransitionFocusPolicy({
      nextDensity: "overflow-secondary",
      overflowOpen: true,
      focusWithinOverflow: true,
      focusedItemRole: "menuitemradio",
    })).toEqual({ closeOverflow: true, focusTarget: "overflow-trigger" });
  });

  it.each(["compact", "full"] as const)(
    "closes and focuses Export before %s removes More",
    (nextDensity) => {
      expect(toolbarDensityTransitionFocusPolicy({
        nextDensity,
        overflowOpen: true,
        focusWithinOverflow: true,
        focusedItemRole: "menuitemcheckbox",
      })).toEqual({ closeOverflow: true, focusTarget: "export" });
    },
  );

  it("does not steal focus when a density transition preserves the focused item", () => {
    expect(toolbarDensityTransitionFocusPolicy({
      nextDensity: "overflow-locale",
      overflowOpen: true,
      focusWithinOverflow: true,
      focusedItemRole: "menuitemcheckbox",
    })).toEqual({ closeOverflow: false, focusTarget: null });
  });

  it("restores the logical fallback focus after a compact probe is rejected", () => {
    expect(toolbarDensityProbeFocusRestoration({
      fallbackDensity: "overflow-secondary",
      candidateDensity: "compact",
      resolvedDensity: "overflow-secondary",
      fallbackFocusTarget: "overflow-trigger",
    })).toBe("overflow-trigger");
  });

  it("keeps the accepted compact candidate focus instead of restoring More", () => {
    expect(toolbarDensityProbeFocusRestoration({
      fallbackDensity: "overflow-secondary",
      candidateDensity: "compact",
      resolvedDensity: "compact",
      fallbackFocusTarget: "overflow-trigger",
    })).toBeNull();
  });

  it("applies rejected-probe focus only after the fallback subtree remounts", () => {
    const source = densityHookSource();

    expect(source).toContain("fallbackFocusTarget: ToolbarDensityTransitionFocusTarget;");
    expect(source).toContain(
      "const pendingDensityFocusRef = useRef<ToolbarDensityTransitionFocusTarget>(null);",
    );
    expect(source).toContain(
      "pendingDensityFocusRef.current = toolbarDensityProbeFocusRestoration({",
    );
    expect(source).toContain("const pendingFocusTarget = pendingDensityFocusRef.current;");
    expect(source).toContain("pendingDensityFocusRef.current = null;");
  });

  it("keeps the centered grid gap and shrinkable priority groups", () => {
    const source = readFileSync(new URL("./Toolbar.tsx", import.meta.url), "utf8");

    expect(source).toContain('<div className="contents">');
    expect(source).toContain("grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-5");
    expect(source).toContain('className="flex w-full min-w-0 items-center justify-self-start"');
    expect(source).not.toContain("min-[1120px]:inline");
  });

  it("measures the visual left row instead of its full grid track", () => {
    const source = readFileSync(new URL("./Toolbar.tsx", import.meta.url), "utf8");

    expect(source).toContain('<div className="flex w-full min-w-0 items-center justify-self-start">');
    expect(source).toContain('ref={leftRef} data-toolbar-left-content className="flex min-w-0 items-center gap-2.5"');
    expect(source).toContain('"flex shrink-0 items-center justify-self-end"');
    expect(source).toContain('minimalControls ? "gap-0.5" : "gap-1"');
    expect(source).not.toContain("sm:gap-1.5");
  });

  it("removes icon-label gaps whenever labels are compacted", () => {
    const source = readFileSync(new URL("./Toolbar.tsx", import.meta.url), "utf8");

    expect(source).toContain('compactControls ? "gap-0" : "gap-1.5"');
    expect(source).toContain('const compactSharedButtonClassName = compactControls ? "!gap-0" : undefined;');
    expect(source.match(/compactSharedButtonClassName/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("uses minimal geometry without changing the measured header gap or padding", () => {
    const source = readFileSync(new URL("./Toolbar.tsx", import.meta.url), "utf8");

    expect(source).toContain('const minimalControls = density === "minimal";');
    expect(source).toContain('minimalControls ? "p-0.5" : "p-1"');
    expect(source).toContain('minimalControls ? "gap-0.5" : "gap-1"');
    expect(source.match(/minimalControls && "!size-7"/g)?.length).toBe(2);
    expect(source).toContain('minimalControls && "!size-7 !min-h-7 !px-0"');
    expect(source).toContain("items-center gap-5 border-b border-slate-200 bg-white px-3");
    expect(source).not.toMatch(/data-density=\{density\}[\s\S]{0,200}minimalControls/);
  });
});
