// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverCaptureImport } from "@screenshot-studio/core/capture-import";
import { type Project } from "@screenshot-studio/core/model";
import { projectRevision, serializeProject } from "@screenshot-studio/core/storage";
import {
  applyCaptureImportToProject,
  CaptureImportCrashSimulation,
} from "./capture-import-transaction.js";
import { captureImportIntentPath, reconcileCaptureImport } from "./capture-import-recovery.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function project(): Project {
  return {
    meta: { name: "Transaction", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [{
      id: "default", name: "Default", mode: "isolated", screens: [{
        id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
        direction: "ltr", artboard: { width: 1320, height: 2868 },
        background: { type: "solid", color: "#101827" }, elements: [],
      }],
    }],
  };
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "capture-import-transaction-"));
  roots.push(root);
  const projectPath = join(root, "app-store-screenshots.json");
  const bytes = serializeProject(project());
  await writeFile(projectPath, bytes);
  const png = new Uint8Array(await readFile(new URL(
    "../../../fixtures/regressions/screenshot-parity/assets/shot.png",
    import.meta.url,
  )));
  return {
    root,
    projectPath,
    revision: projectRevision(bytes),
    discovery: discoverCaptureImport({
      files: [{ relativePath: "apple/iphone/en/01.png", bytes: png }],
    }),
  };
}

describe("capture import transaction", () => {
  it("conditionally publishes resources and the strict target-layout Project as one transaction", async () => {
    const input = await setup();

    const result = await applyCaptureImportToProject({
      projectPath: input.projectPath,
      expectedRevision: input.revision,
      discovery: input.discovery,
      layoutId: "default",
    });

    expect(result.imported).toBe(1);
    expect(result.revision).not.toBe(input.revision);
    expect(result.project.layouts[0]!.screens.map(({ id }) => id)).toEqual([
      "hero",
      "apple-iphone-en-01",
    ]);
    expect([...await readFile(join(input.root, result.plan.screens[0]!.resourcePath))]).toEqual(
      [...input.discovery.captures[0]!.bytes],
    );
    await expect(readFile(captureImportIntentPath(input.projectPath))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a stale revision before resource or intent publication", async () => {
    const input = await setup();

    await expect(applyCaptureImportToProject({
      projectPath: input.projectPath,
      expectedRevision: "0".repeat(64),
      discovery: input.discovery,
      layoutId: "default",
    })).rejects.toThrow(/revision conflict/i);

    expect(await readFile(input.projectPath, "utf8")).toBe(serializeProject(project()));
    await expect(readdir(join(input.root, "assets"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(captureImportIntentPath(input.projectPath))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a changed preview confirmation before resource or intent publication", async () => {
    const input = await setup();

    await expect(applyCaptureImportToProject({
      projectPath: input.projectPath,
      expectedRevision: input.revision,
      confirmationFingerprint: "0".repeat(64),
      discovery: input.discovery,
      layoutId: "default",
    })).rejects.toThrow(/preview changed/i);

    expect(await readFile(input.projectPath, "utf8")).toBe(serializeProject(project()));
    await expect(readdir(join(input.root, "assets"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(captureImportIntentPath(input.projectPath))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rolls published resources back when the conditional Project write fails", async () => {
    const input = await setup();

    await expect(applyCaptureImportToProject({
      projectPath: input.projectPath,
      discovery: input.discovery,
      layoutId: "default",
    }, {
      fileDependencies: {
        beforeDestinationRevalidation: async () => { throw new Error("injected project write failure"); },
      },
    })).rejects.toThrow(/injected project write failure/i);

    expect(await readFile(input.projectPath, "utf8")).toBe(serializeProject(project()));
    await expect(readFile(captureImportIntentPath(input.projectPath))).rejects.toMatchObject({ code: "ENOENT" });
    const imports = join(input.root, "assets", "imports");
    await mkdir(imports, { recursive: true });
    await expect(readdir(imports)).resolves.toEqual([]);
  });

  it("rolls the owned link and stage back when destination directory sync fails", async () => {
    const input = await setup();

    await expect(applyCaptureImportToProject({
      projectPath: input.projectPath,
      discovery: input.discovery,
      layoutId: "default",
    }, {
      preparedPublicationDependencies: {
        syncDirectory: async () => { throw new Error("injected destination directory sync failure"); },
      },
    })).rejects.toThrow(/directory sync failure/i);

    expect(await readFile(input.projectPath, "utf8")).toBe(serializeProject(project()));
    await expect(readFile(captureImportIntentPath(input.projectPath))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readdir(join(input.root, "assets", "imports"))).resolves.toEqual([]);
  });

  it("never overwrites a conflicting destination and removes its empty intent", async () => {
    const input = await setup();
    const capture = input.discovery.captures[0]!;
    const relativePath = `assets/imports/apple-iphone-en-01-${capture.digest.slice(0, 12)}.png`;
    await mkdir(join(input.root, "assets", "imports"), { recursive: true });
    await writeFile(join(input.root, relativePath), "later occupant");

    await expect(applyCaptureImportToProject({
      projectPath: input.projectPath,
      discovery: input.discovery,
      layoutId: "default",
    })).rejects.toThrow(/invalid entries|already exists|conflict|different bytes/i);

    await expect(readFile(join(input.root, relativePath), "utf8")).resolves.toBe("later occupant");
    expect(await readFile(input.projectPath, "utf8")).toBe(serializeProject(project()));
    await expect(readFile(captureImportIntentPath(input.projectPath))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cancels before Project commit and restores the original state", async () => {
    const input = await setup();
    const controller = new AbortController();

    await expect(applyCaptureImportToProject({
      projectPath: input.projectPath,
      discovery: input.discovery,
      layoutId: "default",
      signal: controller.signal,
    }, {
      boundary(boundary) {
        if (boundary === "resource-committed") controller.abort();
      },
    })).rejects.toThrow(/cancelled/i);

    expect(await readFile(input.projectPath, "utf8")).toBe(serializeProject(project()));
    await expect(readFile(captureImportIntentPath(input.projectPath))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readdir(join(input.root, "assets", "imports"))).resolves.toEqual([]);
  });

  it("fails closed on a pre-evidence stage and never deletes an identical later occupant", async () => {
    const input = await setup();
    let stagePath = "";

    await expect(applyCaptureImportToProject({
      projectPath: input.projectPath,
      discovery: input.discovery,
      layoutId: "default",
    }, {
      boundary(boundary, context) {
        if (boundary === "stage-created") {
          stagePath = context.stagePath!;
          throw new CaptureImportCrashSimulation(boundary);
        }
      },
    })).rejects.toBeInstanceOf(CaptureImportCrashSimulation);

    const bytes = await readFile(stagePath);
    await rm(stagePath);
    await writeFile(stagePath, bytes, { flag: "wx" });
    await expect(reconcileCaptureImport(input.projectPath)).rejects.toThrow(/recovery required/i);
    await expect(readFile(stagePath)).resolves.toEqual(bytes);
    await expect(readFile(captureImportIntentPath(input.projectPath))).resolves.toBeTruthy();
  });

  it("names the pre-evidence stage and finishes recovery once the user deletes it", async () => {
    const input = await setup();
    let stagePath = "";
    let intentPath = "";
    await expect(applyCaptureImportToProject({
      projectPath: input.projectPath,
      discovery: input.discovery,
      layoutId: "default",
    }, {
      boundary(boundary, context) {
        if (boundary === "stage-created") {
          stagePath = context.stagePath!;
          intentPath = context.intentPath;
          throw new CaptureImportCrashSimulation(boundary);
        }
      },
    })).rejects.toBeInstanceOf(CaptureImportCrashSimulation);

    const failure = await reconcileCaptureImport(input.projectPath).catch((error: Error) => error);
    expect((failure as Error).message).toContain(stagePath);
    expect((failure as Error).message).toContain(intentPath);

    await rm(stagePath);
    await reconcileCaptureImport(input.projectPath);
    await expect(readFile(intentPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(input.projectPath, "utf8")).toBe(serializeProject(project()));
  });

  it("reconciles pre-commit and post-commit crash boundaries idempotently", async () => {
    const beforeCommit = await setup();
    let resourcePath = "";
    await expect(applyCaptureImportToProject({
      projectPath: beforeCommit.projectPath,
      discovery: beforeCommit.discovery,
      layoutId: "default",
    }, {
      boundary(boundary, context) {
        if (boundary === "resource-committed") {
          resourcePath = context.resourcePath!;
          throw new CaptureImportCrashSimulation(boundary);
        }
      },
    })).rejects.toBeInstanceOf(CaptureImportCrashSimulation);
    await expect(readFile(join(beforeCommit.root, resourcePath))).resolves.toBeTruthy();
    await reconcileCaptureImport(beforeCommit.projectPath);
    await reconcileCaptureImport(beforeCommit.projectPath);
    await expect(readFile(join(beforeCommit.root, resourcePath))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(beforeCommit.projectPath, "utf8")).toBe(serializeProject(project()));

    const afterCommit = await setup();
    await expect(applyCaptureImportToProject({
      projectPath: afterCommit.projectPath,
      discovery: afterCommit.discovery,
      layoutId: "default",
    }, {
      boundary(boundary) {
        if (boundary === "project-committed") throw new CaptureImportCrashSimulation(boundary);
      },
    })).rejects.toBeInstanceOf(CaptureImportCrashSimulation);
    const committed = JSON.parse(await readFile(afterCommit.projectPath, "utf8")) as Project;
    const committedResource = committed.layouts[0]!.screens[1]!.elements[0]!;
    expect("assetUrl" in committedResource).toBe(true);
    const committedPath = "assetUrl" in committedResource && committedResource.assetUrl
      ? committedResource.assetUrl
      : "";
    await reconcileCaptureImport(afterCommit.projectPath);
    await reconcileCaptureImport(afterCommit.projectPath);
    await expect(readFile(join(afterCommit.root, committedPath))).resolves.toBeTruthy();
    await expect(readFile(captureImportIntentPath(afterCommit.projectPath))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("retains recovery and preserves a later destination occupant", async () => {
    const input = await setup();
    let relativePath = "";
    await expect(applyCaptureImportToProject({
      projectPath: input.projectPath,
      discovery: input.discovery,
      layoutId: "default",
    }, {
      boundary(boundary, context) {
        if (boundary === "resource-committed") {
          relativePath = context.resourcePath!;
          throw new CaptureImportCrashSimulation(boundary);
        }
      },
    })).rejects.toBeInstanceOf(CaptureImportCrashSimulation);
    const destination = join(input.root, relativePath);
    await rm(destination);
    await writeFile(destination, "later occupant", { flag: "wx" });

    await expect(reconcileCaptureImport(input.projectPath)).rejects.toThrow(/recovery required/i);
    await expect(readFile(destination, "utf8")).resolves.toBe("later occupant");
    await expect(readFile(captureImportIntentPath(input.projectPath))).resolves.toBeTruthy();
  });

  it("rejects a crafted intent before it can delete an unrelated owned resource", async () => {
    const input = await setup();
    const keepPath = join(input.root, "assets", "keep.txt");
    await mkdir(join(input.root, "assets"), { recursive: true });
    await writeFile(keepPath, "keep me");
    const keepBytes = await readFile(keepPath);
    const keepStat = await lstat(keepPath, { bigint: true });
    const canonicalProjectPath = await realpath(input.projectPath);
    const projectStat = await lstat(canonicalProjectPath, { bigint: true });
    const digest = createHash("sha256").update(keepBytes).digest("hex");
    await writeFile(captureImportIntentPath(input.projectPath), `${JSON.stringify({
      version: 1,
      operation: "capture-import",
      projectPath: canonicalProjectPath,
      projectDevice: projectStat.dev.toString(),
      projectInode: projectStat.ino.toString(),
      initialRevision: input.revision,
      expectedRevision: "f".repeat(64),
      phase: "prepared",
      resources: [{
        relativePath: "assets/keep.txt",
        digest,
        stageToken: "d".repeat(32),
        stageRelativePath: "assets/.unrelated.capture-stage",
        ownership: {
          device: keepStat.dev.toString(),
          inode: keepStat.ino.toString(),
          revision: digest,
        },
        created: true,
      }],
    }, null, 2)}\n`);

    await expect(reconcileCaptureImport(input.projectPath)).rejects.toThrow(/invalid capture import recovery/i);
    await expect(readFile(keepPath, "utf8")).resolves.toBe("keep me");
  });

  it("never removes a later stage occupant for an identical pre-existing resource", async () => {
    const input = await setup();
    const capture = input.discovery.captures[0]!;
    const relativePath = `assets/imports/apple-iphone-en-01-${capture.digest.slice(0, 12)}.png`;
    await mkdir(join(input.root, "assets", "imports"), { recursive: true });
    await writeFile(join(input.root, relativePath), capture.bytes);

    await expect(applyCaptureImportToProject({
      projectPath: input.projectPath,
      discovery: input.discovery,
      layoutId: "default",
    }, {
      boundary(boundary) {
        if (boundary === "stage-evidence") throw new CaptureImportCrashSimulation(boundary);
      },
    })).rejects.toBeInstanceOf(CaptureImportCrashSimulation);
    const intent = JSON.parse(await readFile(captureImportIntentPath(input.projectPath), "utf8")) as {
      resources: Array<{ stageRelativePath: string }>;
    };
    const laterStage = join(input.root, intent.resources[0]!.stageRelativePath);
    await writeFile(laterStage, "later stage occupant", { flag: "wx" });

    await expect(reconcileCaptureImport(input.projectPath)).rejects.toThrow(/recovery required/i);
    await expect(readFile(laterStage, "utf8")).resolves.toBe("later stage occupant");
  });

  it("surfaces a production-style intent directory sync failure before resource publication", async () => {
    const input = await setup();
    const error = new Error("injected intent fsync EIO") as NodeJS.ErrnoException;
    error.code = "EIO";

    await expect(applyCaptureImportToProject({
      projectPath: input.projectPath,
      discovery: input.discovery,
      layoutId: "default",
    }, {
      intentOpenDirectory: async () => { throw error; },
    })).rejects.toThrow(/intent fsync EIO/i);
    await expect(readdir(join(input.root, "assets"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("finishes a deterministic resource quarantine after a rollback crash", async () => {
    const input = await setup();
    await expect(applyCaptureImportToProject({
      projectPath: input.projectPath,
      discovery: input.discovery,
      layoutId: "default",
    }, {
      boundary(boundary) {
        if (boundary === "resource-committed") throw new CaptureImportCrashSimulation(boundary);
      },
    })).rejects.toBeInstanceOf(CaptureImportCrashSimulation);
    const intent = JSON.parse(await readFile(captureImportIntentPath(input.projectPath), "utf8")) as {
      resources: Array<{ destinationCleanupRelativePath: string }>;
    };
    let interrupted = false;
    await expect(reconcileCaptureImport(input.projectPath, {
      afterResourceQuarantine() {
        if (!interrupted) {
          interrupted = true;
          throw new CaptureImportCrashSimulation("resource-committed");
        }
      },
    })).rejects.toBeInstanceOf(CaptureImportCrashSimulation);
    const cleanupPath = join(input.root, intent.resources[0]!.destinationCleanupRelativePath);
    await expect(readFile(cleanupPath)).resolves.toBeTruthy();

    await reconcileCaptureImport(input.projectPath);

    await expect(readFile(cleanupPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(captureImportIntentPath(input.projectPath))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readdir(join(input.root, "assets", "imports"))).resolves.toEqual([]);
  });
});
