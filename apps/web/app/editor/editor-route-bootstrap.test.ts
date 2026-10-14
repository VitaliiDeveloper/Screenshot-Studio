// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bootstrapSource = readFileSync(new URL("./editor-route-bootstrap.tsx", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("./[entryId]/page.tsx", import.meta.url), "utf8");
const compatibilitySource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("editor route bootstrap", () => {
  it("mounts Workspace only after the URL entry activation gate succeeds", () => {
    expect(routeSource).toContain("<EditorRouteBootstrap key={entryId} entryId={entryId} />");
    expect(bootstrapSource).toContain("switchActiveProject(() => activateEditorRouteEntry(entryId))");
    expect(bootstrapSource).toContain("setExpectedProjectId(activated.projectId)");
    expect(bootstrapSource).toContain("<EditorWorkspace expectedProjectId={expectedProjectId} />");
    expect(bootstrapSource.indexOf("activateEditorRouteEntry(entryId)"))
      .toBeLessThan(bootstrapSource.indexOf('setStatus("ready")'));
  });

  it("shows activation failures without mounting or falling back to another project", () => {
    expect(bootstrapSource).toContain('setStatus("error")');
    expect(bootstrapSource).toContain('role="alert"');
    expect(bootstrapSource).not.toContain("setStatus(\"ready\")\n      } catch");
  });

  it("keeps generic Workspace compatibility and canonicalizes managed sessions", () => {
    expect(compatibilitySource).toContain("<EditorRouteBootstrap />");
    expect(bootstrapSource).toContain("fetchActiveProject()");
    expect(bootstrapSource).toContain("canonicalEditorUrlForSelection(selection)");
    expect(bootstrapSource).toContain("router.replace(canonicalUrl)");
    expect(bootstrapSource).toContain("setExpectedProjectId(selection.projectId)");
  });
});
