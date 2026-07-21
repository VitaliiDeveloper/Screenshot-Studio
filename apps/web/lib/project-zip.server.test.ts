// SPDX-License-Identifier: Apache-2.0
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { ProjectZipError, readProjectZipFiles } from "@web/lib/project-zip.server.js";

async function zipBytes(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, contents] of Object.entries(files)) zip.file(path, contents);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

function eocdOffset(bytes: Uint8Array): number {
  for (let offset = bytes.byteLength - 22; offset >= 0; offset -= 1) {
    if (new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error("EOCD missing");
}

describe("readProjectZipFiles", () => {
  it("returns lazy file streams after validating central-directory bounds", async () => {
    const bytes = await zipBytes({
      "app-store-screenshots.json": "{}",
      "assets/icon.png": "image",
    });

    const files = await readProjectZipFiles(bytes, { maxFiles: 10, maxBytes: 100 });

    expect(files.map(({ relativePath, declaredSize }) => ({ relativePath, declaredSize }))).toEqual([
      { relativePath: "app-store-screenshots.json", declaredSize: 2 },
      { relativePath: "assets/icon.png", declaredSize: 5 },
    ]);
    const chunks = [];
    for await (const chunk of files[1]!.open()) chunks.push(chunk);
    expect(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString()).toBe("image");
  });

  it("rejects declared expansion before exposing a decompression stream", async () => {
    const bytes = await zipBytes({ "app-store-screenshots.json": "x".repeat(200) });

    await expect(readProjectZipFiles(bytes, { maxFiles: 10, maxBytes: 100 }))
      .rejects.toMatchObject({ code: "limit" });
  });

  it("stops a forged entry when actual inflation exceeds its admitted size", async () => {
    const bytes = await zipBytes({ "app-store-screenshots.json": "x".repeat(200) });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const centralOffset = view.getUint32(eocdOffset(bytes) + 16, true);
    view.setUint32(centralOffset + 24, 1, true);
    view.setUint32(22, 1, true);
    const [file] = await readProjectZipFiles(bytes, { maxFiles: 10, maxBytes: 100 });

    const consume = async () => {
      for await (const _chunk of file!.open()) {
        // Consume the guarded stream.
      }
    };
    await expect(consume()).rejects.toMatchObject({ code: "limit" });
  });

  it("rejects encrypted and multi-disk archives", async () => {
    const encrypted = await zipBytes({ "app-store-screenshots.json": "{}" });
    const encryptedView = new DataView(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength);
    const centralOffset = encryptedView.getUint32(eocdOffset(encrypted) + 16, true);
    encryptedView.setUint16(centralOffset + 8, encryptedView.getUint16(centralOffset + 8, true) | 1, true);
    encryptedView.setUint16(6, encryptedView.getUint16(6, true) | 1, true);

    await expect(readProjectZipFiles(encrypted, { maxFiles: 10, maxBytes: 100 }))
      .rejects.toBeInstanceOf(ProjectZipError);

    const multiDisk = await zipBytes({ "app-store-screenshots.json": "{}" });
    new DataView(multiDisk.buffer, multiDisk.byteOffset, multiDisk.byteLength)
      .setUint16(eocdOffset(multiDisk) + 4, 1, true);
    await expect(readProjectZipFiles(multiDisk, { maxFiles: 10, maxBytes: 100 }))
      .rejects.toMatchObject({ code: "invalid" });
  });

  it("rejects unsupported compression and malformed trailing data", async () => {
    const unsupported = await zipBytes({ "app-store-screenshots.json": "{}" });
    const view = new DataView(unsupported.buffer, unsupported.byteOffset, unsupported.byteLength);
    const centralOffset = view.getUint32(eocdOffset(unsupported) + 16, true);
    view.setUint16(centralOffset + 10, 99, true);
    view.setUint16(8, 99, true);
    await expect(readProjectZipFiles(unsupported, { maxFiles: 10, maxBytes: 100 }))
      .rejects.toMatchObject({ code: "invalid" });

    const valid = await zipBytes({ "app-store-screenshots.json": "{}" });
    const trailing = new Uint8Array(valid.byteLength + 1);
    trailing.set(valid);
    await expect(readProjectZipFiles(trailing, { maxFiles: 10, maxBytes: 100 }))
      .rejects.toMatchObject({ code: "invalid" });
  });

  it("rejects duplicate raw names before JSZip can overwrite an entry", async () => {
    const manifest = "app-store-screenshots.json";
    const replacement = "x".repeat(manifest.length);
    const bytes = await zipBytes({ [manifest]: "one", [replacement]: "two" });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocd = eocdOffset(bytes);
    let central = view.getUint32(eocd + 16, true);
    central += 46 + view.getUint16(central + 28, true)
      + view.getUint16(central + 30, true) + view.getUint16(central + 32, true);
    const local = view.getUint32(central + 42, true);
    const encodedManifest = new TextEncoder().encode(manifest);
    bytes.set(encodedManifest, central + 46);
    bytes.set(encodedManifest, local + 30);

    await expect(readProjectZipFiles(bytes, { maxFiles: 10, maxBytes: 100 }))
      .rejects.toMatchObject({ code: "invalid" });
  });
});
