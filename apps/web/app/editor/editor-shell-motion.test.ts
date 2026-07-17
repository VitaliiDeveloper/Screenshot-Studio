import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const leftPanelSource = readFileSync(
  new URL("../../components/LeftPanel.tsx", import.meta.url),
  "utf8",
);

describe("editor side-panel motion integration", () => {
  it("keeps both motion shells mounted and drives them from existing state", () => {
    expect(pageSource).toContain(
      'import { EditorSidePanel } from "../../components/editor-shell/EditorSidePanel";',
    );
    expect(pageSource).toContain('<EditorSidePanel side="left" open={panel !== null}>');
    expect(pageSource).toContain('<EditorSidePanel side="right" open={inspectorOpen}>');
    expect(pageSource).not.toContain("{panel ? (");
    expect(pageSource).not.toContain("{inspectorOpen ? (");
  });

  it("retains the last left-panel content while its shell closes", () => {
    expect(pageSource).toContain(
      'const [lastPanel, setLastPanel] = useState<WorkspacePanel>("structure");',
    );
    expect(pageSource).toContain("const setPanel = useCallback((next: WorkspacePanel | null) => {");
    expect(pageSource).toContain("setPanelState(next);");
    expect(pageSource).toContain("if (next) setLastPanel(next);");
    expect(pageSource).not.toContain("if (panel) setLastPanel(panel);");
    expect(pageSource).toContain("panel={panel ?? lastPanel}");
  });

  it("lets the shared shell own width and positioning", () => {
    expect(leftPanelSource).toContain(
      '"flex h-full w-full shrink-0 flex-col overflow-hidden border-r',
    );
    expect(leftPanelSource).not.toContain("absolute inset-y-0 left-14");
    expect(pageSource).toContain('className="!w-full"');
  });

  it("preserves canvas inset state instead of coupling it to animation presence", () => {
    expect(pageSource).toContain("leftInset={layout.overlay && panel ? SIDE_PANEL_WIDTH : 0}");
    expect(pageSource).toContain(
      "rightInset={layout.overlay && inspectorOpen ? SIDE_PANEL_WIDTH : 0}",
    );
  });
});
