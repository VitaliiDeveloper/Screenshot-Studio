// SPDX-License-Identifier: Apache-2.0

/** Reads a response body, failing before buffering more than `limit` bytes. */
export async function readCappedBody(response: Response, limit: number): Promise<Buffer> {
  const tooLarge = () => new Error(`Response is larger than ${limit} bytes`);
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw tooLarge();
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(read.value);
  }
  return Buffer.concat(chunks);
}
