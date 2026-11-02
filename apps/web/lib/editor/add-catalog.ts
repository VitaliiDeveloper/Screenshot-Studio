// SPDX-License-Identifier: Apache-2.0
export type AddCatalogCategory = "Basic" | "Media" | "Frames" | "Library";
export type AddCatalogAction =
  | "insert-text"
  | "insert-shape"
  | "insert-icon"
  | "insert-badge"
  | "insert-device-frame"
  | "open-templates"
  | "open-asset-picker"
  | "open-store-badge-picker"
  | "unavailable";

export interface AddCatalogItem {
  id:
    | "text" | "shape" | "icon" | "screenshot" | "image" | "device-frame" | "device-frame-image"
    | "rating-badge" | "as-seen-on-badge" | "store-badge" | "components";
  label: string;
  category: AddCatalogCategory;
  action: AddCatalogAction;
  shortcut?: string;
  hint?: string;
}

/**
 * The creation shelf is data-driven so schema additions only add one descriptor + action.
 * Every action maps to an enforced element type or an explicit future placeholder.
 */
export const ADD_CATALOG: readonly AddCatalogItem[] = [
  { id: "text", label: "Text", category: "Basic", action: "insert-text", shortcut: "T" },
  { id: "shape", label: "Shape", category: "Basic", action: "insert-shape", shortcut: "R" },
  { id: "icon", label: "Icon", category: "Basic", action: "insert-icon", hint: "Editable built-in vector" },
  {
    id: "screenshot",
    label: "Screenshot",
    category: "Media",
    action: "open-asset-picker",
    hint: "Choose a project image asset",
  },
  {
    id: "image",
    label: "Image",
    category: "Media",
    action: "open-asset-picker",
    hint: "Choose a decorative project asset",
  },
  {
    id: "device-frame",
    label: "Add device mockup",
    category: "Frames",
    action: "insert-device-frame",
    hint: "Create an empty mockup; assign or replace its local screenshot later",
  },
  {
    id: "device-frame-image",
    label: "Place screenshot in mockup",
    category: "Frames",
    action: "open-asset-picker",
    hint: "Choose a local project screenshot and create a populated mockup",
  },
  {
    id: "components",
    label: "Screen templates",
    category: "Library",
    action: "open-templates",
    shortcut: "⌘/",
    hint: "Create a screen from a template",
  },
  {
    id: "rating-badge",
    label: "Rating badge",
    category: "Library",
    action: "insert-badge",
    hint: "Editable grouped rating proof",
  },
  {
    id: "as-seen-on-badge",
    label: "As seen on badge",
    category: "Library",
    action: "insert-badge",
    hint: "Editable grouped press proof",
  },
  {
    id: "store-badge",
    label: "Store badge",
    category: "Library",
    action: "open-store-badge-picker",
    hint: "Choose an official project asset",
  },
] as const;

export const ADD_CATEGORIES: readonly AddCatalogCategory[] = ["Basic", "Media", "Frames", "Library"];

export function filterAddCatalog(query: string): AddCatalogItem[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...ADD_CATALOG];
  return ADD_CATALOG.filter((item) =>
    `${item.label} ${item.category} ${item.hint ?? ""}`.toLocaleLowerCase().includes(normalized),
  );
}
