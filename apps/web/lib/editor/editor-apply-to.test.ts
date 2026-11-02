// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";
import { editorStore, selectApplyScope } from "./editor-store.js";
import { project } from "./editor-store-test-fixtures.js";
import { applyElementPatchToScope } from "./editor-apply-to.js";

vi.mock("./mutate-and-save.js", () => ({ mutateAndSave: (mutate: () => void) => mutate() }));

const elementX = (id: string) => editorStore.getState().project!.layouts[0]!.screens[0]!.elements
  .find((element) => element.id === id)!.x;

describe("discrete layer edits", () => {
  const first = () => editorStore.getState().project!.layouts[0]!.screens[0]!.elements[0]!;

  beforeEach(() => {
    editorStore.setState({ project: null, activeScreenId: null, selectedItems: [], applyScopeChoice: null });
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

describe("selectApplyScope", () => {
  beforeEach(() => {
    editorStore.setState({ project: null, activeScreenId: null, selectedItems: [], applyScopeChoice: null });
    editorStore.getState().load(project());
  });

  it("holds a wider scope only for the selection it was chosen on", () => {
    const { id } = editorStore.getState().project!.layouts[0]!.screens[0]!.elements[0]!;
    const store = editorStore.getState();
    store.select(id);
    expect(selectApplyScope(editorStore.getState())).toBe("screen");

    store.setApplyScope("family");
    expect(selectApplyScope(editorStore.getState())).toBe("family");

    store.select(null);
    expect(selectApplyScope(editorStore.getState())).toBe("screen");
    store.select(id);
    expect(selectApplyScope(editorStore.getState())).toBe("family");
  });
});
