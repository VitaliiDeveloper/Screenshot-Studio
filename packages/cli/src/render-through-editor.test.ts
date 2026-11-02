// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editorRenderInbox, renderThroughEditor } from "./render-through-editor.js";

const FAST = { pollMs: 5, pickupTimeoutMs: 150, heartbeatStaleMs: 150 };

let inbox: string;

beforeEach(async () => {
  inbox = await mkdtemp(join(tmpdir(), "render-through-editor-"));
});

afterEach(async () => {
  await rm(inbox, { recursive: true, force: true });
});

/** The editor's side, reduced to: answer the first request once it has seen it. */
async function nextRequest(): Promise<{ id: string; body: unknown }> {
  for (;;) {
    const name = (await readdir(inbox)).find((entry) => entry.startsWith("request-"));
    if (name) {
      return {
        id: name.slice("request-".length, -".json".length),
        body: JSON.parse(await readFile(join(inbox, name), "utf8")),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

const answer = (id: string, response: unknown) => writeFile(join(inbox, `response-${id}.json`), JSON.stringify(response));

describe("renderThroughEditor", () => {
  it("is off without the env var, so a terminal CLI behaves as before", () => {
    expect(editorRenderInbox({})).toBeUndefined();
    expect(editorRenderInbox({ SCREENSHOT_STUDIO_RENDER_INBOX: "" })).toBeUndefined();
    expect(editorRenderInbox({ SCREENSHOT_STUDIO_RENDER_INBOX: "/x" })).toBe("/x");
  });

  it.each(["project", "out", "browser", "store-specs"])("refuses --%s with a clear message and sends nothing", async (flag) => {
    await expect(renderThroughEditor("export", { [flag]: "/x" }, inbox, FAST)).rejects.toThrow(
      `--${flag} is not available inside an editor run`,
    );
    expect(await readdir(inbox)).toEqual([]);
  });

  it("refuses --project on check --render too", async () => {
    await expect(renderThroughEditor("check", { render: "true", project: "/x" }, inbox, FAST)).rejects.toThrow("--project is not available");
  });

  it("sends structured flags and returns the editor's answer, then cleans up", async () => {
    const rendering = renderThroughEditor("export", { screen: "hero", size: "6.3" }, inbox, FAST);
    const { id, body } = await nextRequest();
    expect(body).toEqual({ command: "export", flags: { screen: "hero", size: "6.3" } });
    await answer(id, { ok: true, output: "Exported x.png (1x1)", exitCode: 0 });
    await expect(rendering).resolves.toEqual({ output: "Exported x.png (1x1)", exitCode: 0 });
    expect(await readdir(inbox)).toEqual([]);
  });

  it("passes check's exit code and turns its boolean flags into values", async () => {
    const rendering = renderThroughEditor("check", { render: "true", json: "true", strict: "true" }, inbox, FAST);
    const { id, body } = await nextRequest();
    expect(body).toEqual({ command: "check", flags: { render: true, json: true, strict: true } });
    await answer(id, { ok: true, output: "{}", exitCode: 1 });
    await expect(rendering).resolves.toEqual({ output: "{}", exitCode: 1 });
  });

  it("raises the editor's refusal as the command's error", async () => {
    const rendering = renderThroughEditor("export", {}, inbox, FAST);
    const { id } = await nextRequest();
    await answer(id, { ok: false, message: "No such screen" });
    await expect(rendering).rejects.toThrow("No such screen");
  });

  it("fails fast when no editor picks the request up", async () => {
    await expect(renderThroughEditor("export", {}, inbox, FAST)).rejects.toThrow("did not pick up this render");
  });

  it("outlives the pick-up timeout while the heartbeat beats", async () => {
    const rendering = renderThroughEditor("export", {}, inbox, FAST);
    const { id } = await nextRequest();
    const marker = join(inbox, `picked-${id}`);
    await writeFile(marker, "");
    for (let beat = 1; beat <= 8; beat += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await utimes(marker, beat, beat);
    }
    await answer(id, { ok: true, output: "", exitCode: 0 });
    await expect(rendering).resolves.toEqual({ output: "", exitCode: 0 });
  });

  it("ends the wait when the heartbeat stops", async () => {
    const rendering = renderThroughEditor("export", {}, inbox, FAST);
    const { id } = await nextRequest();
    await writeFile(join(inbox, `picked-${id}`), "");
    await expect(rendering).rejects.toThrow("stopped responding");
  });

  it("ends the wait when the marker disappears with the inbox", async () => {
    const rendering = renderThroughEditor("export", {}, inbox, FAST);
    const { id } = await nextRequest();
    const marker = join(inbox, `picked-${id}`);
    await writeFile(marker, "");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await rm(marker);
    await expect(rendering).rejects.toThrow("stopped responding");
  });
});
