// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { transformerAppearance } from "@web/components/editor-stage/transformer-appearance.js";

describe("transformer appearance", () => {
  it("keeps the selection border and handles compact", () => {
    expect(transformerAppearance).toMatchObject({
      anchorSize: 6,
      anchorStrokeWidth: 1,
      borderStrokeWidth: 1,
    });
  });
});
