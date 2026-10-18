// SPDX-License-Identifier: Apache-2.0
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ExportProgressSnapshot } from "@web/lib/export-progress.js";
import { ExportProgressStatus } from "./ExportProgressStatus.js";

const operationId = `export_${"a".repeat(32)}`;

function render(progress: Omit<ExportProgressSnapshot, "operationId">, currentPath?: string): string {
  return renderToStaticMarkup(createElement(ExportProgressStatus, {
    progress: { operationId, ...progress },
    currentPath,
  }));
}

describe("ExportProgressStatus", () => {
  it("starts at zero without presenting preparation as half complete", () => {
    const markup = render({ phase: "preparing", completed: 0, total: 0 });

    expect(markup).toContain("Preparing export…");
    expect(markup).toContain('aria-valuenow="0"');
    expect(markup).toContain('style="width:0%"');
    expect(markup).toContain("animate-spin");
    expect(markup).not.toContain("w-1/2");
  });

  it("retains completed rendering while auxiliary phases report activity separately", () => {
    const rendering = render({ phase: "rendering", completed: 1, total: 4 });
    const packaging = render({ phase: "packaging", completed: 4, total: 4 });

    expect(rendering).toContain('style="width:25%"');
    expect(rendering).not.toContain("animate-spin");
    expect(rendering).toContain("Rendering 1 of 4");
    expect(packaging).toContain("Packaging");
    expect(packaging).toContain('style="width:100%"');
    expect(packaging).toContain("animate-spin");
  });

  it("names the file being rendered only while rendering", () => {
    const path = "apple/iphone/locale-uk/size-6.3/02-save-fast-6.3.png";

    expect(render({ phase: "rendering", completed: 1, total: 4 }, path)).toContain(path);
    expect(render({ phase: "packaging", completed: 4, total: 4 }, path)).not.toContain(path);
  });
});
