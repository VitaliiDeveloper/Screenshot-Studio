// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseProject, type Project } from "@screenshot-studio/core/model";
import {
  layoutActionPresentation,
  layoutDeleteConfirmation,
  layoutPresentation,
  toggleLayoutMenuState,
} from "./LayoutSelector";

function project(): Project {
  const screen = {
    id: "hero",
    name: "Hero",
    platform: "apple",
    device: "iphone",
    locale: "en",
    direction: "ltr",
    artboard: { width: 1320, height: 2868 },
    background: { type: "solid", color: "#101827" },
    elements: [],
  };
  return parseProject({
    meta: { name: "Layouts", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "middle",
    layouts: [
      { id: "first", name: "First", mode: "isolated", screens: [{ ...screen, id: "first-screen" }] },
      { id: "middle", name: "Middle", mode: "connected", screens: [{ ...screen, id: "middle-screen" }] },
      { id: "last", name: "Last", mode: "isolated", screens: [{ ...screen, id: "last-screen" }] },
    ],
  });
}

describe("layout delete confirmation", () => {
  it("names the deterministic next preferred layout", () => {
    const fixture = project();
    expect(layoutDeleteConfirmation(fixture, fixture.layouts[1]!)).toBe(
      'Delete layout "Middle"? "Last" will become the preferred export layout.',
    );
  });

  it("names the previous layout when the preferred layout is last", () => {
    const fixture = { ...project(), preferredExportLayoutId: "last" };
    expect(layoutDeleteConfirmation(fixture, fixture.layouts[2]!)).toBe(
      'Delete layout "Last"? "Middle" will become the preferred export layout.',
    );
  });

  it("does not mention preferred reassignment for a non-preferred layout", () => {
    const fixture = project();
    expect(layoutDeleteConfirmation(fixture, fixture.layouts[0]!)).toBe('Delete layout "First"?');
  });
});

describe("layout presentation", () => {
  it("uses available toolbar width before truncating and still shrinks inside a narrow track", () => {
    const source = readFileSync(new URL("./LayoutSelector.tsx", import.meta.url), "utf8");

    expect(source).toContain('<div ref={rootRef} className="relative size-9 shrink-0 sm:h-10 sm:w-auto sm:max-w-80 sm:min-w-0 sm:flex-1">');
    expect(source).toContain("sm:h-10 sm:w-full sm:min-w-0");
    expect(source).not.toContain("sm:w-[14.5rem]");
    expect(source).not.toContain("sm:min-w-56");
  });

  it("keeps selected layout backgrounds separated from row dividers", () => {
    const source = readFileSync(new URL("./LayoutSelector.tsx", import.meta.url), "utf8");

    expect(source).toContain(
      'className="group relative flex items-center border-b border-slate-100 py-1.5 last:border-b-0"',
    );
  });

  it("marks the active preferred layout with the approved subtitle", () => {
    const fixture = project();

    expect(layoutPresentation(fixture, fixture.layouts[1]!, "middle")).toEqual({
      active: true,
      preferred: true,
      preferredIndicator: "subtitle",
      showActions: true,
      subtitle: "Preferred for export",
    });
  });

  it("leaves a non-preferred inactive layout without a subtitle", () => {
    const fixture = project();

    expect(layoutPresentation(fixture, fixture.layouts[0]!, "middle")).toEqual({
      active: false,
      preferred: false,
      preferredIndicator: null,
      showActions: true,
      subtitle: null,
    });
  });

  it("closes the nested actions whenever the layout list closes", () => {
    expect(toggleLayoutMenuState({ open: true, actionMenuId: "middle" })).toEqual({
      open: false,
      actionMenuId: null,
    });
    expect(toggleLayoutMenuState({ open: false, actionMenuId: "middle" })).toEqual({
      open: true,
      actionMenuId: null,
    });
  });

  it("keeps useful actions and mode switching available for the only layout", () => {
    const fixture = project();
    const only = fixture.layouts[0]!;
    const single = {
      ...fixture,
      preferredExportLayoutId: only.id,
      layouts: [only],
    };

    expect(layoutActionPresentation(single, only)).toEqual({
      canDelete: false,
      canPrefer: false,
      nextMode: "connected",
      switchModeLabel: "Switch to connected",
    });
  });
});
