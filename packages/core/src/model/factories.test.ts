import { describe, it, expect } from "vitest";
import { createTextElement, createShapeElement } from "./factories.js";
import { Element } from "./schema.js";

describe("element factories (slice 5)", () => {
  it("createTextElement returns a schema-valid text element", () => {
    const el = createTextElement();
    expect(() => Element.parse(el)).not.toThrow();
    expect(el.type).toBe("text");
    expect(el.id).toMatch(/[0-9a-f-]{36}/);
  });

  it("createShapeElement returns a schema-valid shape element", () => {
    const el = createShapeElement();
    expect(() => Element.parse(el)).not.toThrow();
    expect(el.type).toBe("shape");
    expect(el.kind).toBe("rect");
  });

  it("gives each element a fresh id", () => {
    expect(createTextElement().id).not.toBe(createTextElement().id);
  });

  it("honours a supplied origin", () => {
    const el = createShapeElement({ x: 250, y: 400 });
    expect(el).toMatchObject({ x: 250, y: 400 });
  });
});
