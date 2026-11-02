// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { readAgentChat, readAgentChoice, writeAgentChat, writeAgentChoice } from "./agent-chat-memory";
import { createAgentTurn, type AgentTurn } from "./agent-panel-model";

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const throwing = new Proxy(new MemoryStorage(), {
  get(target, property) {
    if (property === "getItem" || property === "setItem" || property === "removeItem") {
      return () => { throw new DOMException("blocked", "SecurityError"); };
    }
    return Reflect.get(target, property);
  },
});

function finished(id: number, message: string): AgentTurn {
  return {
    ...createAgentTurn(id, "Claude Code", message),
    text: ["Done."],
    done: { type: "done", status: "completed", summary: "Changed 1 screen", durationMs: 10 },
  };
}

describe("agent chat memory", () => {
  it("restores the chat text per project, marked as earlier and without images", () => {
    const storage = new MemoryStorage();
    const image = { file: new File(["x"], "ref.png", { type: "image/png" }), url: "blob:ref" };
    writeAgentChat("project-a", [{ ...finished(1, "Add German"), attachments: [image] }, finished(2, "Now French")], storage);

    const restored = readAgentChat("project-a", storage);
    expect(restored.map(({ id, message, earlier, attachments, droppedImages }) => ({ id, message, earlier, attachments, droppedImages })))
      .toEqual([
        { id: 1, message: "Add German", earlier: true, attachments: [], droppedImages: 1 },
        { id: 2, message: "Now French", earlier: true, attachments: [], droppedImages: 0 },
      ]);
    expect(restored[0]?.done?.summary).toBe("Changed 1 screen");
    expect(readAgentChat("project-b", storage)).toEqual([]);

    // A restored turn written again keeps its dropped-image count instead of resetting it.
    writeAgentChat("project-a", restored, storage);
    expect(readAgentChat("project-a", storage)[0]?.droppedImages).toBe(1);
  });

  it("closes a run the reload cut off as failed", () => {
    const storage = new MemoryStorage();
    writeAgentChat("project-a", [createAgentTurn(1, "Claude Code", "Add German")], storage);
    const [turn] = readAgentChat("project-a", storage);
    expect(turn?.done?.status).toBe("failed");
    expect(turn?.error?.message).toBe("The page reloaded before this run finished.");
  });

  it("keeps only the latest turns and clears the key for an empty chat", () => {
    const storage = new MemoryStorage();
    writeAgentChat("project-a", Array.from({ length: 40 }, (_, index) => finished(index + 1, `m${index + 1}`)), storage);
    const restored = readAgentChat("project-a", storage);
    expect(restored).toHaveLength(30);
    expect(restored[0]?.id).toBe(11);

    writeAgentChat("project-a", [], storage);
    expect(storage.length).toBe(0);
  });

  it("ignores malformed, outdated, and unreadable storage", () => {
    const storage = new MemoryStorage();
    storage.setItem("screenshot-studio:agent-chat:v1:project-a", "{not json");
    expect(readAgentChat("project-a", storage)).toEqual([]);
    storage.setItem("screenshot-studio:agent-chat:v1:project-a", JSON.stringify({ version: 2, turns: [finished(1, "x")] }));
    expect(readAgentChat("project-a", storage)).toEqual([]);
    storage.setItem("screenshot-studio:agent-chat:v1:project-a", JSON.stringify({ version: 1, turns: [{ id: "1" }, finished(2, "kept")] }));
    expect(readAgentChat("project-a", storage).map(({ id }) => id)).toEqual([2]);

    expect(readAgentChat("project-a", throwing)).toEqual([]);
    expect(() => writeAgentChat("project-a", [finished(1, "x")], throwing)).not.toThrow();
    expect(readAgentChoice(throwing)).toBeNull();
    expect(() => writeAgentChoice({ agentId: "codex", model: null, effort: null }, throwing)).not.toThrow();
  });

  it("remembers the agent, model, and effort", () => {
    const storage = new MemoryStorage();
    expect(readAgentChoice(storage)).toBeNull();
    writeAgentChoice({ agentId: "claude-code", model: "claude-sonnet-5-5", effort: "max" }, storage);
    expect(readAgentChoice(storage)).toEqual({ agentId: "claude-code", model: "claude-sonnet-5-5", effort: "max" });
    storage.setItem("screenshot-studio:agent-choice:v1", JSON.stringify({ version: 1, agentId: 3, model: "", effort: "low" }));
    expect(readAgentChoice(storage)).toEqual({ agentId: null, model: null, effort: "low" });
  });
});
