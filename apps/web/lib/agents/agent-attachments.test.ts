// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { attachmentProblem, MAX_AGENT_ATTACHMENT_BYTES, sniffAttachmentType } from "./agent-attachments.js";

const bytes = (...values: number[]) => Uint8Array.from(values);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50);

describe("agent attachment types", () => {
  it("detects PNG, JPEG and WebP by their leading bytes", () => {
    expect(sniffAttachmentType(PNG)).toBe("png");
    expect(sniffAttachmentType(bytes(0xff, 0xd8, 0xff, 0xe1, 0, 0))).toBe("jpeg");
    expect(sniffAttachmentType(WEBP)).toBe("webp");
  });

  it("refuses everything else, however the file was named", () => {
    expect(sniffAttachmentType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffAttachmentType(new TextEncoder().encode("GIF89a......"))).toBeNull();
    // A RIFF container that is not WebP (WAV), and a truncated PNG signature.
    expect(sniffAttachmentType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45))).toBeNull();
    expect(sniffAttachmentType(PNG.slice(0, 5))).toBeNull();
    expect(sniffAttachmentType(new Uint8Array())).toBeNull();
  });

  it("limits the size and rejects empty files", () => {
    expect(attachmentProblem(PNG.length, PNG)).toBeNull();
    expect(attachmentProblem(MAX_AGENT_ATTACHMENT_BYTES, PNG)).toBeNull();
    expect(attachmentProblem(MAX_AGENT_ATTACHMENT_BYTES + 1, PNG)).toMatch(/larger than 10 MB/);
    expect(attachmentProblem(0, new Uint8Array())).toMatch(/empty/);
    expect(attachmentProblem(10, new TextEncoder().encode("not an image"))).toMatch(/PNG, JPEG and WebP/);
  });
});
