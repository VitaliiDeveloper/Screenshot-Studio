import { describe, it, expect } from "vitest";
import { elementToNodeConfig } from "./node-config.js";
import type { TextElement, ShapeElement } from "../model/schema.js";

const baseText: TextElement = {
  id: "t1", type: "text", x: 10, y: 20, width: 300, height: 100,
  rotation: 5, opacity: 0.8, locked: false, visible: true,
  content: "Hi", fontFamily: "Pacifico", size: 96, weight: 600,
  lineHeight: 1.2, letterSpacing: 2, align: "center", color: "#FFFFFF",
};

const baseShape: ShapeElement = {
  id: "s1", type: "shape", x: 0, y: 0, width: 50, height: 40,
  rotation: 0, opacity: 1, locked: false, visible: true,
  kind: "rect", fill: "#FF0000", radius: 8,
};

describe("elementToNodeConfig", () => {
  it("maps a text element to a Konva Text config", () => {
    const result = elementToNodeConfig(baseText);
    expect(result.konva).toBe("Text");
    expect(result.config).toMatchObject({
      id: "t1", x: 10, y: 20, width: 300, height: 100,
      rotation: 5, opacity: 0.8, text: "Hi", fontFamily: "Pacifico",
      fontSize: 96, fontStyle: "600", lineHeight: 1.2,
      letterSpacing: 2, align: "center", fill: "#FFFFFF",
    });
  });

  it("maps a shape element to a Konva Rect config", () => {
    const result = elementToNodeConfig(baseShape);
    expect(result.konva).toBe("Rect");
    expect(result.config).toMatchObject({
      id: "s1", x: 0, y: 0, width: 50, height: 40,
      rotation: 0, opacity: 1, fill: "#FF0000", cornerRadius: 8,
    });
  });
});
