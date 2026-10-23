// SPDX-License-Identifier: Apache-2.0
"use client";

import { useMemo, type ReactNode } from "react";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import type { Screen } from "@screenshot-studio/core/model";
import {
  compactStoreSizeLabel,
  distinctSizeLabels,
  OVERVIEW_GAP,
  screenStoreTarget,
  storeOutputLabel,
  type WorkspaceOutputFamily,
} from "@web/lib/editor/editor-workspace";
import { OutputFamilySection } from "./OutputFamilySection";
import { SizeRowHeader } from "./SizeRowHeader";

interface IsolatedOverviewFamily {
  key: string;
  label: string;
  rows: WorkspaceOutputFamily[];
  editing: boolean;
}

function groupIsolatedOverviewRows(
  rows: readonly WorkspaceOutputFamily[],
  specs: StoreSpecs | null,
): IsolatedOverviewFamily[] {
  const families = new Map<string, IsolatedOverviewFamily>();
  for (const row of rows) {
    const screen = row.screens[0];
    if (!screen) continue;
    const key = `${screen.platform}/${screen.device}`;
    const family = families.get(key) ?? {
      key,
      label: specs
        ? storeOutputLabel(screen.platform, screen.device, specs)
        : storeOutputLabel(screen.platform, screen.device),
      rows: [],
      editing: false,
    };
    family.rows.push(row);
    family.editing ||= row.editing;
    families.set(key, family);
  }
  return Array.from(families.values());
}

function outputSizeLabel(row: WorkspaceOutputFamily, specs: StoreSpecs | null): string {
  const screen = row.screens[0];
  if (!screen) return "Size";
  const target = screenStoreTarget(screen, specs ?? undefined);
  if (target) return compactStoreSizeLabel(target.label, screen.device);
  // Keep the persisted id visible when store specs cannot resolve it.
  return screen.storeTargetId ?? "Master";
}

export function IsolatedOutputFamilies({
  rows,
  specs,
  zoom,
  renderScreen,
}: {
  rows: readonly WorkspaceOutputFamily[];
  specs: StoreSpecs | null;
  zoom: number;
  renderScreen: (screen: Screen) => ReactNode;
}) {
  const families = useMemo(() => groupIsolatedOverviewRows(rows, specs), [rows, specs]);
  return families.map((family) => {
    const masterRow = family.rows.find((row) => row.screens[0]?.storeTargetId === undefined);
    const variantRows = family.rows.filter((row) => row !== masterRow);
    const sizeLabels = distinctSizeLabels(family.rows.map((row) => ({
      label: outputSizeLabel(row, specs),
      screen: row.screens[0]!,
    })));
    const sizeLabel = (row: WorkspaceOutputFamily) => sizeLabels[family.rows.indexOf(row)]!;
    const artworkWidth = Math.max(...family.rows.map((row) =>
      row.screens.reduce((width, screen) => width + screen.artboard.width * zoom, 0)
      + OVERVIEW_GAP * Math.max(0, row.screens.length - 1)
    ));
    return (
      <OutputFamilySection
        key={family.key}
        label={family.label}
        editing={family.editing}
        headerEditing={masterRow?.editing ?? false}
        artworkWidth={artworkWidth}
        sizeLabel={masterRow ? sizeLabel(masterRow) : undefined}
        role={masterRow ? "master" : undefined}
        testId="overview-output-family"
        ariaLabel={`${family.label} output`}
      >
        <div className="flex flex-col gap-10">
          {masterRow ? (
            <section
              data-testid="overview-size-row"
              data-size-kind="master"
              data-editing={masterRow.editing ? "true" : "false"}
            >
              <div className="flex items-start gap-12">
                {masterRow.screens.map(renderScreen)}
              </div>
            </section>
          ) : null}
          {variantRows.map((row) => (
            <section
              key={row.key}
              data-testid="overview-size-row"
              data-size-kind="variant"
              data-editing={row.editing ? "true" : "false"}
            >
              <SizeRowHeader
                label={family.label}
                sizeLabel={sizeLabel(row)}
                editing={row.editing}
              />
              <div className="flex items-start gap-12">
                {row.screens.map(renderScreen)}
              </div>
            </section>
          ))}
        </div>
      </OutputFamilySection>
    );
  });
}
