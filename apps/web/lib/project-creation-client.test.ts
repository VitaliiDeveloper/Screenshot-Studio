// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import {
  createProject,
  type ProjectCreationTransport,
} from "./project-creation-client.js";

const input = {
  name: "Launch",
  platform: "android" as const,
  layoutMode: "connected" as const,
  templateId: "product-launch",
};

describe("createProject", () => {
  it("posts only strict creation input and returns a managed descriptor", async () => {
    const transport = vi.fn<ProjectCreationTransport>(async (submitted) => {
      expect(submitted).toEqual(input);
      expect(submitted).not.toHaveProperty("path");
      return Response.json({
        project: {
          sessionId: "created-session",
          name: "Launch",
          sourceKind: "managed-project",
          capabilities: {
            writeInPlace: true,
            revealLocation: false,
            watchExternalChanges: false,
            nativePicker: false,
            projectLocalResources: true,
            exportProjectArchive: true,
        deleteProjectPermanently: true,
          },
        },
      }, { status: 201 });
    });

    await expect(createProject(input, { transport })).resolves.toMatchObject({
      sessionId: "created-session", name: "Launch", sourceKind: "managed-project",
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("preserves API errors for retry and rejects malformed success responses", async () => {
    await expect(createProject(input, {
      transport: async () => Response.json({ error: "Starter unavailable", code: "invalid-scaffold" }, {
        status: 422,
      }),
    })).rejects.toEqual(expect.objectContaining({
      message: "Starter unavailable", code: "invalid-scaffold",
    }));
    await expect(createProject(input, {
      transport: async () => Response.json({ project: { name: "Missing identity" } }, { status: 201 }),
    })).rejects.toThrow(/invalid response/i);
  });
});
