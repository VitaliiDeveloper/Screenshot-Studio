// SPDX-License-Identifier: Apache-2.0
"use client";

import { editorStore } from "@web/lib/editor/editor-store";
import { MenuSelect, type MenuSelectOption } from "@web/components/editor-ui";

export function ToolbarLocaleSelect({
  activeLocale,
  localeOptions,
}: {
  activeLocale: string;
  localeOptions: MenuSelectOption<string>[];
}) {
  return (
    <MenuSelect
      ariaLabel={`Active locale: ${activeLocale}`}
      menuLabel="Project locales"
      value={activeLocale}
      options={localeOptions}
      onChange={(locale) => editorStore.getState().selectLocale(locale)}
      className="w-fit min-w-16 max-w-24"
      triggerClassName="h-8 px-2 font-semibold"
      menuClassName="w-32"
    />
  );
}
