// SPDX-License-Identifier: Apache-2.0

/** Image types an agent request may carry; Codex's `--image` only takes images. */
export type AgentAttachmentType = "png" | "jpeg" | "webp";

export interface AgentAttachment {
  type: AgentAttachmentType;
  bytes: Uint8Array;
}

export const MAX_AGENT_ATTACHMENTS = 5;
export const MAX_AGENT_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const AGENT_ATTACHMENT_ACCEPT = "image/png,image/jpeg,image/webp";
/** The type check reads this many leading bytes. */
export const SNIFF_BYTES = 12;

export const ATTACHMENT_EXTENSIONS: Record<AgentAttachmentType, string> = { png: "png", jpeg: "jpg", webp: "webp" };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const startsWith = (bytes: Uint8Array, at: number, expected: readonly number[]) =>
  expected.every((value, index) => bytes[at + index] === value);
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/** The type the bytes declare. File names and MIME types are client claims and never consulted. */
export function sniffAttachmentType(bytes: Uint8Array): AgentAttachmentType | null {
  if (startsWith(bytes, 0, PNG_SIGNATURE)) return "png";
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, 0, ascii("RIFF")) && startsWith(bytes, 8, ascii("WEBP"))) return "webp";
  return null;
}

/** Why one attachment is refused, or null. The editor and the session route share this verdict. */
export function attachmentProblem(size: number, head: Uint8Array): string | null {
  if (size === 0) return "The file is empty";
  if (size > MAX_AGENT_ATTACHMENT_BYTES) return `The file is larger than ${MAX_AGENT_ATTACHMENT_BYTES / 1024 / 1024} MB`;
  return sniffAttachmentType(head) ? null : "Only PNG, JPEG and WebP images can be attached";
}
