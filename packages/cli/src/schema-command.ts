// SPDX-License-Identifier: Apache-2.0
import { projectJsonSchema } from "@screenshot-studio/core/model";

const USAGE = "Usage: screenshots schema [--help]";

const HELP = [
  USAGE,
  "",
  "Prints the JSON Schema (draft 2020-12) of app-store-screenshots.json to stdout. It is generated",
  "from the strict project schema the CLI enforces, describes the file as written on disk (fields",
  "with a default may be omitted), and rejects unknown keys.",
  "",
  "JSON Schema cannot express the cross-field and cross-reference rules the CLI enforces, so a",
  "document that passes it can still be invalid. Not covered:",
  "  - unique ids: layouts, screens within a layout, elements within a screen (group children included)",
  "  - layout names: unique ignoring case, no leading or trailing whitespace",
  "  - references: preferredExportLayoutId names a layout; variantOf names a root screen of the same",
  "    platform, device, and locale, requires storeTargetId, and has one variant per store target",
  "  - screen set policies: one per platform/device/locale, each matching an output family; a",
  "    synchronized family has the root screen count and order on every exact size",
  "  - one text direction per locale within a layout",
  "  - fonts: unique family and weight",
  "  - asset and font paths: portable project-relative paths",
  "",
  "screenshots check is the authoritative validation. It also checks store targets, artboard sizes,",
  "fonts, and asset files against store-specs.json and the project folder.",
].join("\n");

export function runSchemaCommand(args: string[], flags: Record<string, string>): string {
  if (flags.help === "true") return HELP;
  if (args.length > 0) throw new Error(USAGE);
  return JSON.stringify(projectJsonSchema(), null, 2);
}
