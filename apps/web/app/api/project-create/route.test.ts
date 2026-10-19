// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STORE_SPECS } from "@screenshot-studio/core/export";
import { resolveManagedProjectStorageConfig } from "@web/lib/managed-projects/managed-project-config.server.js";
import { ManagedProjectCreationService } from "@web/lib/managed-projects/managed-project-creation.server.js";
import { ManagedProjectRepository } from "@web/lib/managed-projects/managed-project-repository.server.js";
import { ProjectSessionRegistry } from "@web/lib/session/project-session.server.js";
import { handleProjectCreatePost } from "./handler.js";
import { POST } from "./route.js";

let root: string;
let repository: ManagedProjectRepository;
let registry: ProjectSessionRegistry;
let service: ManagedProjectCreationService;

const specs = DEFAULT_STORE_SPECS;

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/project-create", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "project-create-route-"));
  repository = new ManagedProjectRepository(resolveManagedProjectStorageConfig({
    SCREENSHOT_STUDIO_DATA_ROOT: root,
  }));
  let sessionNumber = 0;
  registry = new ProjectSessionRegistry({
    createSessionId: () => sessionNumber++ === 0 ? "created-session" : `created-session-${sessionNumber}`,
  });
  service = new ManagedProjectCreationService(repository, { storeSpecs: specs });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("POST /api/project-create", () => {
  it("creates an empty managed project and activates only its new session", async () => {
    const recordRecent = vi.fn(async () => undefined);
    const response = await handleProjectCreatePost(request({
      name: "New managed project", platform: "windows", device: "desktop", layoutMode: "connected", templateId: null,
    }), { service, registry, recentProjects: { record: recordRecent } });

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-project-id")).toMatch(/^project_[a-f0-9]{32}$/);
    expect(response.headers.get("set-cookie")).toContain(
      "screenshot_studio_project_session=created-session",
    );
    expect(response.headers.get("set-cookie")).toContain(
      "screenshot_studio_managed_project=project_",
    );
    expect(await response.json()).toMatchObject({
      project: {
        sessionId: "created-session",
        name: "New managed project",
        sourceKind: "managed-project",
        capabilities: { revealLocation: false },
      },
    });
    await expect(repository.list()).resolves.toHaveLength(1);
    expect(recordRecent).toHaveBeenCalledOnce();
    expect(recordRecent).toHaveBeenCalledWith(expect.objectContaining({
      descriptor: expect.objectContaining({ name: "New managed project" }),
    }));
  });

  it("creates a compatible starter project template through the same endpoint", async () => {
    const response = await handleProjectCreatePost(request({
      name: "Launch", platform: "android", device: "phone", layoutMode: "isolated", templateId: "product-launch",
    }), { service, registry });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ project: { name: "Launch" } });
  });

  it("rejects paths, unknown fields, malformed JSON, and oversized bodies before publication", async () => {
    const pathResponse = await handleProjectCreatePost(request({
      name: "Unsafe", platform: "apple", device: "iphone", layoutMode: "isolated", templateId: null,
      path: "/srv/unsafe",
    }), { service, registry });
    const malformed = await handleProjectCreatePost(new Request("http://localhost/api/project-create", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{",
    }), { service, registry });
    const oversized = await handleProjectCreatePost(request({
      name: "Large", platform: "apple", device: "iphone", layoutMode: "isolated", templateId: null,
    }, { "content-length": "20000" }), { service, registry });
    const invalidDevice = await handleProjectCreatePost(request({
      name: "Invalid pair", platform: "apple", device: "wear", layoutMode: "isolated", templateId: null,
    }), { service, registry });
    const missingDevice = await handleProjectCreatePost(request({
      name: "Missing device", platform: "apple", layoutMode: "isolated", templateId: null,
    }), { service, registry });

    expect(pathResponse.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(invalidDevice.status).toBe(400);
    expect(missingDevice.status).toBe(400);
    expect(pathResponse.headers.get("set-cookie")).toBeNull();
    await expect(repository.list()).resolves.toEqual([]);
  });

  it("cancels an unknown-length request stream after it exceeds the byte limit", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(16_385));
      },
      cancel() {
        cancelled = true;
      },
    });
    const streamedRequest = new Request("http://localhost/api/project-create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await handleProjectCreatePost(streamedRequest, { service, registry });

    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    await expect(repository.list()).resolves.toEqual([]);
  });

  it("cancels a declared oversized request stream before returning the byte-limit response", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const streamedRequest = new Request("http://localhost/api/project-create", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "20000" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await handleProjectCreatePost(streamedRequest, { service, registry });

    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    await expect(repository.list()).resolves.toEqual([]);
  });

  it("preserves the prior session and catalog when template compatibility fails", async () => {
    const previous = registry.openManagedRecord({
      id: "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      name: "Previous",
      projectDirectory: "/private/previous",
      projectPath: "/private/previous/app-store-screenshots.json",
      lifecycleRevision: 1,
    });
    const failed = request({
      name: "Unsupported", platform: "windows", device: "desktop", layoutMode: "isolated", templateId: "product-launch",
    }, { cookie: `screenshot_studio_project_session=${previous.descriptor.sessionId}` });

    const response = await handleProjectCreatePost(failed, { service, registry });

    expect(response.status).toBe(422);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(registry.get(previous.descriptor.sessionId)).toBe(previous);
    await expect(repository.list()).resolves.toEqual([]);
  });

  it("does not disclose server paths from scaffold or store-spec failures", async () => {
    const privatePath = `${root}/private-store-specs.json`;
    const failingService = new ManagedProjectCreationService(repository, {
      loadStoreSpecs: async () => { throw new Error(`cannot read ${privatePath}`); },
    });

    const response = await handleProjectCreatePost(request({
      name: "Path safe", platform: "apple", device: "iphone", layoutMode: "isolated", templateId: null,
    }), { service: failingService, registry });
    const body = await response.text();

    expect(response.status).toBe(422);
    expect(body).not.toContain(root);
    expect(body).not.toContain("private-store-specs.json");
  });

  it("fails before publication when a new session id cannot be reserved", async () => {
    const failingRegistry = new ProjectSessionRegistry({
      createSessionId: () => { throw new Error("injected session id failure"); },
    });

    const response = await handleProjectCreatePost(request({
      name: "No orphan", platform: "apple", device: "iphone", layoutMode: "isolated", templateId: null,
    }), { service, registry: failingRegistry });

    expect(response.status).toBe(500);
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(repository.list()).resolves.toEqual([]);
  });

  it("rejects non-JSON media and wires the Next route", async () => {
    const response = await handleProjectCreatePost(new Request("http://localhost/api/project-create", {
      method: "POST", headers: { "content-type": "text/plain" }, body: "plain",
    }), { service, registry });

    expect(response.status).toBe(415);
    expect(POST).toBeTypeOf("function");
  });
});
