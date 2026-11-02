// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";
import { editorStore } from "./editor-store.js";
import { project } from "./editor-store-test-fixtures.js";
import { applyElementPatchToScope } from "./editor-apply-to.js";

vi.mock("./mutate-and-save.js", () => ({ mutateAndSave: (mutate: () => void) => mutate() }));

const elementX = (id: string) => editorStore.getState().project!.layouts[0]!.screens[0]!.elements
  .find((element) => element.id === id)!.x;

describe("discrete layer edits", () => {
  const first = () => editorStore.getState().project!.layouts[0]!.screens[0]!.elements[0]!;

  beforeEach(() => {
    editorStore.setState({ project: null, activeScreenId: null, selectedItems: [] });
    editorStore.getState().load(project());
  });

  it("stay one undo step apart from typing around them, which still coalesces", () => {
    const { id, type, x } = first();
    const store = editorStore.getState();
    const typed = (value: number) => store.patchElement({ id, type, patch: { x: value } });

    typed(1);
    typed(12);
    applyElementPatchToScope({ id, type, patch: { x: 50 }, scope: "screen" });
    typed(123);
    typed(1234);
    expect(editorStore.getState().historyPast).toHaveLength(3);

    store.undo();
    expect(elementX(id)).toBe(50);
    store.undo();
    expect(elementX(id)).toBe(12);
    store.undo();
    expect(elementX(id)).toBe(x);
  });
});
