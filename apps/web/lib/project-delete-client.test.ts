// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import {
  requestProjectDeletion,
  requestProjectDeletionStatus,
} from "./project-delete-client.js";

const input = {
  projectId: "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  projectRevision: "1".repeat(64),
  lifecycleRevision: 3,
  confirmation: "Delete me",
  backup: { kind: "none" as const, acknowledged: true as const },
  operationId: "operation_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  statusSecret: "2".repeat(64),
};

describe("project deletion client", () => {
  it("sends destructive credentials only in an exact no-store POST body", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({
      operationId: input.operationId,
      status: "deleted-complete",
    }));

    await expect(requestProjectDeletion(input, fetcher)).resolves.toEqual({
      operationId: input.operationId,
      status: "deleted-complete",
    });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("/api/project-delete");
    expect(url).not.toContain(input.statusSecret);
    expect(init).toMatchObject({ method: "POST", cache: "no-store" });
    expect(new Headers(init?.headers).get("if-match")).toBe(`"${input.projectRevision}"`);
    expect(new Headers(init?.headers).get("x-project-id")).toBe(input.projectId);
    expect(JSON.parse(String(init?.body))).toEqual({
      operationId: input.operationId,
      statusSecret: input.statusSecret,
      expectedLifecycleRevision: 3,
      confirmation: "Delete me",
      backup: { kind: "none", acknowledged: true },
    });
  });

  it("recovers uncertain completion through a body-only operation POST", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({
      operationId: input.operationId,
      status: "deleted-cleanup-pending",
    }, { status: 202 }));

    await expect(requestProjectDeletionStatus({
      operationId: input.operationId,
      statusSecret: input.statusSecret,
    }, fetcher)).resolves.toEqual({
      operationId: input.operationId,
      status: "deleted-cleanup-pending",
    });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("/api/project-delete/operation");
    expect(url).not.toContain(input.operationId);
    expect(url).not.toContain(input.statusSecret);
    expect(JSON.parse(String(init?.body))).toEqual({
      operationId: input.operationId,
      statusSecret: input.statusSecret,
    });
  });

  it("returns expired-or-unknown and rejects malformed or redacted errors", async () => {
    await expect(requestProjectDeletionStatus({
      operationId: input.operationId,
      statusSecret: input.statusSecret,
    }, vi.fn(async () => Response.json({ status: "expired-or-unknown" }, { status: 404 }))))
      .resolves.toEqual({ status: "expired-or-unknown" });

    await expect(requestProjectDeletion(input, vi.fn(async () => Response.json({
      error: "Permanent deletion rejected",
    }, { status: 409 })))).rejects.toThrow("Permanent deletion rejected");
    await expect(requestProjectDeletion(input, vi.fn(async () => Response.json({
      operationId: input.operationId,
      status: "restored",
    })))).rejects.toThrow(/invalid response/i);
  });
});
