// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import {
  createTextElement,
  createShapeElement,
  createScreenshotElement,
  createDeviceFrameElement,
} from "./factories.js";
import { Element } from "./schema.js";

describe("element factories (slice 5)", () => {
  it("createTextElement returns a schema-valid text element", () => {
    const el = createTextElement({ font: { family: "Inter", weight: 700 } });
    expect(() => Element.parse(el)).not.toThrow();
    expect(el.type).toBe("text");
    expect(el.id).toMatch(/[0-9a-f-]{36}/);
    expect(el).toMatchObject({ fontFamily: "Inter", weight: 700 });
  });

  it("right-aligns newly inserted text for an RTL screen", () => {
    expect(createTextElement({
      font: { family: "Inter", weight: 700 },
      direction: "rtl",
    }).align).toBe("right");
  });

  it("createShapeElement returns a schema-valid shape element", () => {
    const el = createShapeElement();
    expect(() => Element.parse(el)).not.toThrow();
    expect(el.type).toBe("shape");
    expect(el.kind).toBe("rect");
  });

  it("createScreenshotElement returns a schema-valid screenshot element", () => {
    const el = createScreenshotElement({
      assetUrl: "assets/shot.png",
      width: 1320,
      height: 2868,
      x: 0,
      y: 0,
    });
    expect(() => Element.parse(el)).not.toThrow();
    expect(el).toMatchObject({ type: "screenshot", assetUrl: "assets/shot.png", fit: "cover" });
  });

  it("createDeviceFrameElement returns a schema-valid device-frame element", () => {
    const el = createDeviceFrameElement({ assetUrl: "assets/shot.png" });
    expect(() => Element.parse(el)).not.toThrow();
    expect(el).toMatchObject({ type: "device-frame", deviceType: "iphone" });
  });

  it("gives each element a fresh id", () => {
    const input = { font: { family: "Inter", weight: 400 } };
    expect(createTextElement(input).id).not.toBe(createTextElement(input).id);
  });

  it("honours a supplied origin", () => {
    const el = createShapeElement({ x: 250, y: 400 });
    expect(el).toMatchObject({ x: 250, y: 400 });
  });
});
