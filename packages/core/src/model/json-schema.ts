// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import {
  Background,
  DeviceFrameElement,
  Element,
  GroupElement,
  IconElement,
  ImageElement,
  LeafElement,
  Project,
  ScreenshotElement,
  ShapeElement,
  TextElement,
} from "./schema.js";

// Every platform screen variant and group repeats the element and background unions; named $defs
// keep one copy of each instead of inlining them at every use.
const definitions = z.registry<{ id: string }>();
for (const [id, schema] of Object.entries({
  Background,
  Element,
  LeafElement,
  TextElement,
  ShapeElement,
  ScreenshotElement,
  ImageElement,
  IconElement,
  DeviceFrameElement,
  GroupElement,
})) {
  definitions.add(schema, { id });
}

/**
 * JSON Schema (draft 2020-12) of `app-store-screenshots.json`, generated from the strict `Project`.
 * Input mode describes the file on disk: fields with a schema default may be omitted there.
 * Any transform or custom type throws instead of degrading to `{}`. Zod drops `.refine` and
 * `.superRefine` checks, so cross-field rules and portable-path checks stay with `parseProject`.
 */
export function projectJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(Project, {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "throw",
    metadata: definitions,
  });
  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
}
