// SPDX-License-Identifier: Apache-2.0
import JSZip, { type JSZipObject } from "jszip";
import { PassThrough } from "node:stream";
import type { ProjectImportFile } from "./managed-project-import.server.js";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_EOCD_LENGTH = 22 + 65_535;

export type ProjectZipErrorCode = "invalid" | "limit";

export class ProjectZipError extends Error {
  constructor(message: string, readonly code: ProjectZipErrorCode, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProjectZipError";
  }
}

interface ZipLimits {
  maxFiles: number;
  maxBytes: number;
}

interface CentralEntry {
  name: string;
  size: number;
  directory: boolean;
}

function invalid(message: string): ProjectZipError {
  return new ProjectZipError(message, "invalid");
}

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (!utf8 && bytes.some((byte) => byte > 0x7f)) {
    throw invalid("ZIP entry names must be ASCII or explicitly UTF-8 encoded");
  }
  try {
    return new TextDecoder(utf8 ? "utf-8" : "ascii", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new ProjectZipError("ZIP contains an invalid entry name", "invalid", { cause: error });
  }
}

function findEocd(bytes: Uint8Array, view: DataView): number {
  const lowerBound = Math.max(0, bytes.byteLength - MAX_EOCD_LENGTH);
  for (let offset = bytes.byteLength - 22; offset >= lowerBound; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  throw invalid("ZIP end-of-central-directory record is missing");
}

function parseCentralDirectory(bytes: Uint8Array, limits: ZipLimits): CentralEntry[] {
  if (bytes.byteLength < 22) throw invalid("ZIP is truncated");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes, view);
  const commentLength = view.getUint16(eocd + 20, true);
  if (eocd + 22 + commentLength !== bytes.byteLength) {
    throw invalid("ZIP has malformed trailing data");
  }
  const disk = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const entriesOnDisk = view.getUint16(eocd + 8, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw invalid("Multi-disk ZIP archives are not supported");
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw invalid("ZIP64 archives are not supported");
  }
  if (entryCount === 0) throw invalid("ZIP contains no entries");
  if (entryCount > limits.maxFiles) {
    throw new ProjectZipError("ZIP exceeds the configured file limit", "limit");
  }
  if (centralOffset + centralSize !== eocd || centralOffset > bytes.byteLength) {
    throw invalid("ZIP central directory is malformed");
  }

  const entries: CentralEntry[] = [];
  const names = new Set<string>();
  let totalBytes = 0;
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocd || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw invalid("ZIP central directory entry is malformed");
    }
    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const entryCommentLength = view.getUint16(offset + 32, true);
    const startDisk = view.getUint16(offset + 34, true);
    const localOffset = view.getUint32(offset + 42, true);
    const end = offset + 46 + nameLength + extraLength + entryCommentLength;
    if (end > eocd || nameLength === 0) throw invalid("ZIP central directory entry is truncated");
    if ((flags & 1) !== 0) throw invalid("Encrypted ZIP entries are not supported");
    if (compression !== 0 && compression !== 8) throw invalid("ZIP compression method is not supported");
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      throw invalid("ZIP64 entries are not supported");
    }
    if (startDisk !== 0) throw invalid("Multi-disk ZIP entries are not supported");
    const name = decodeName(bytes.subarray(offset + 46, offset + 46 + nameLength), (flags & 0x800) !== 0);
    if (names.has(name)) throw invalid(`ZIP contains a duplicate entry: ${name}`);
    names.add(name);

    if (localOffset + 30 > centralOffset || view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
      throw invalid(`ZIP local entry is malformed: ${name}`);
    }
    const localFlags = view.getUint16(localOffset + 6, true);
    const localCompression = view.getUint16(localOffset + 8, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const localNameEnd = localOffset + 30 + localNameLength;
    const dataEnd = localNameEnd + localExtraLength + compressedSize;
    if (dataEnd > centralOffset || (localFlags & 1) !== 0 || localCompression !== compression) {
      throw invalid(`ZIP local entry disagrees with its central entry: ${name}`);
    }
    const localName = decodeName(bytes.subarray(localOffset + 30, localNameEnd), (localFlags & 0x800) !== 0);
    if (localName !== name) throw invalid(`ZIP entry names disagree: ${name}`);

    totalBytes += size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxBytes) {
      throw new ProjectZipError("ZIP exceeds the configured byte limit", "limit");
    }
    entries.push({ name, size, directory: name.endsWith("/") });
    offset = end;
  }
  if (offset !== eocd) throw invalid("ZIP central directory entry count is inconsistent");
  return entries;
}

function findZipObject(zip: JSZip, name: string): JSZipObject | undefined {
  return Object.values(zip.files).find((entry) => {
    const originalName = (entry as JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName;
    return entry.name === name || originalName === name;
  });
}

export async function readProjectZipFiles(
  bytes: Uint8Array,
  limits: ZipLimits,
): Promise<ProjectImportFile[]> {
  if (!Number.isSafeInteger(limits.maxFiles) || limits.maxFiles <= 0
    || !Number.isSafeInteger(limits.maxBytes) || limits.maxBytes <= 0) {
    throw new RangeError("ZIP limits must be positive safe integers");
  }
  const centralEntries = parseCentralDirectory(bytes, limits);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, { createFolders: false });
  } catch (error) {
    throw new ProjectZipError("ZIP payload could not be decoded", "invalid", { cause: error });
  }
  return centralEntries.flatMap((metadata): ProjectImportFile[] => {
    if (metadata.directory) return [];
    const entry = findZipObject(zip, metadata.name);
    if (!entry || entry.dir) throw invalid(`ZIP entry could not be decoded: ${metadata.name}`);
    return [{
      relativePath: metadata.name,
      declaredSize: metadata.size,
      async *open() {
        const source = entry.nodeStream("nodebuffer");
        const bridge = new PassThrough();
        source.on("error", (error) => bridge.destroy(error));
        source.pipe(bridge);
        let actualSize = 0;
        try {
          for await (const chunk of bridge) {
            const bytes = Buffer.from(chunk);
            actualSize += bytes.byteLength;
            if (actualSize > metadata.size || actualSize > limits.maxBytes) {
              throw new ProjectZipError(
                `ZIP entry expands beyond its declared size: ${metadata.name}`,
                "limit",
              );
            }
            yield bytes;
          }
          if (actualSize !== metadata.size) {
            throw invalid(`ZIP entry size disagrees with its central entry: ${metadata.name}`);
          }
        } finally {
          source.destroy();
          bridge.destroy();
        }
      },
    }];
  });
}
