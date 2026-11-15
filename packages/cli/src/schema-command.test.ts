// SPDX-License-Identifier: Apache-2.0
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { projectJsonSchema } from "@screenshot-studio/core/model";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchCommand } from "./command-dispatch.js";
import { runSchemaCommand } from "./schema-command.js";

const binPath = fileURLToPath(new URL("../bin/screenshots.mjs", import.meta.url));

describe("screenshots schema", () => {
  afterEach(() => vi.restoreAllMocks());

  it("prints the project JSON Schema without a project", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await dispatchCommand("schema", [], { storeSpecsPath: "/does/not/exist.json" });

    expect(log).toHaveBeenCalledOnce();
    const printed = String(log.mock.calls[0]![0]);
    expect(JSON.parse(printed)).toEqual(projectJsonSchema());
    expect(printed).toBe(runSchemaCommand([], {}));
  });

  it("explains in --help what JSON Schema cannot check and names screenshots check", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await dispatchCommand("schema", ["--help"], { storeSpecsPath: "/does/not/exist.json" });

    const help = String(log.mock.calls[0]![0]);
    expect(help).toMatch(/^Usage: screenshots schema/);
    expect(help).toContain("JSON Schema cannot express the cross-field and cross-reference rules");
    for (const rule of ["unique ids", "preferredExportLayoutId", "variantOf", "screen set policies", "text direction", "portable project-relative paths"]) {
      expect(help).toContain(rule);
    }
    expect(help).toContain("screenshots check is the authoritative validation");
  });

  it("exits quietly when the reader closes the pipe early", async () => {
    const child = spawn(process.execPath, [binPath, "schema"], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.once("data", () => child.stdout.destroy());
    const [code] = await once(child, "close");
    expect(stderr).not.toContain("EPIPE");
    expect(code).toBe(0);
  }, 60_000);

  it("rejects arguments and unknown options", async () => {
    expect(() => runSchemaCommand(["extra"], {})).toThrow("Usage: screenshots schema [--help]");
    await expect(dispatchCommand("schema", ["--project", "x.json"], { storeSpecsPath: "/does/not/exist.json" }))
      .rejects.toThrow("Unknown option --project");
  });
});
