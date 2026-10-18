// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import {
  advanceProjectDeletionAttempt,
  createProjectDeletionCredentials,
  requestProjectDeletion,
  requestProjectDeletionStatus,
  retryProjectDeletion,
  settleProjectDeletion,
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
  it("creates opaque operation credentials from independent random byte ranges", () => {
    const randomBytes = vi.fn((length: number) => new Uint8Array(length).fill(length));
    expect(createProjectDeletionCredentials(randomBytes)).toEqual({
      operationId: `operation_${"10".repeat(16)}`,
      statusSecret: "20".repeat(32),
    });
    expect(randomBytes.mock.calls).toEqual([[16], [32]]);
  });

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

  it("polls only an admitted in-progress operation and stops at cleanup-pending", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({
        operationId: input.operationId,
        status: "in-progress",
      }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({
        operationId: input.operationId,
        status: "deleted-cleanup-pending",
      }, { status: 202 }));
    const wait = vi.fn(async () => undefined);

    await expect(settleProjectDeletion(
      { operationId: input.operationId, statusSecret: input.statusSecret },
      { operationId: input.operationId, status: "in-progress" },
      { fetcher, wait, maxAttempts: 3 },
    )).resolves.toEqual({
      operationId: input.operationId,
      status: "deleted-cleanup-pending",
    });
    expect(wait).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fails closed when status evidence expires or remains in progress", async () => {
    const credentials = { operationId: input.operationId, statusSecret: input.statusSecret };
    await expect(settleProjectDeletion(credentials, {
      operationId: input.operationId,
      status: "in-progress",
    }, {
      fetcher: vi.fn(async () => Response.json({ status: "expired-or-unknown" }, { status: 404 })),
      wait: async () => undefined,
      maxAttempts: 1,
    })).rejects.toThrow(/could not be verified/i);

    await expect(settleProjectDeletion(credentials, {
      operationId: input.operationId,
      status: "in-progress",
    }, {
      fetcher: vi.fn(async () => Response.json({
        operationId: input.operationId,
        status: "in-progress",
      }, { status: 202 })),
      wait: async () => undefined,
      maxAttempts: 1,
    })).rejects.toThrow(/still in progress/i);
  });

  it("never redispatches deletion after known admission when status evidence is unavailable", async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toBe("/api/project-delete/operation");
      return Response.json({ status: "expired-or-unknown" }, { status: 404 });
    });

    await expect(retryProjectDeletion(input, true, fetcher)).resolves.toEqual({
      kind: "unknown-after-admission",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("may redispatch the same idempotent operation only when admission was never observed", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ status: "expired-or-unknown" }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({
        operationId: input.operationId,
        status: "deleted-complete",
      }));

    await expect(retryProjectDeletion(input, false, fetcher)).resolves.toEqual({
      kind: "accepted",
      result: { operationId: input.operationId, status: "deleted-complete" },
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/project-delete/operation",
      "/api/project-delete",
    ]);
  });

  it("integrates admission, failed polling, and a status-only retry without a second delete", async () => {
    const attempt = { request: input, admitted: false };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({
        operationId: input.operationId,
        status: "in-progress",
      }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ status: "expired-or-unknown" }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ status: "expired-or-unknown" }, { status: 404 }));

    await expect(advanceProjectDeletionAttempt(attempt, false, {
      fetcher,
      wait: async () => undefined,
      maxAttempts: 1,
    })).rejects.toThrow(/could not be verified/i);
    expect(attempt.admitted).toBe(true);

    await expect(advanceProjectDeletionAttempt(attempt, true, { fetcher })).resolves.toEqual({
      kind: "unknown-after-admission",
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/project-delete",
      "/api/project-delete/operation",
      "/api/project-delete/operation",
    ]);
  });
});
