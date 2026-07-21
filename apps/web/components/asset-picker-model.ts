// SPDX-License-Identifier: Apache-2.0

export async function insertAssetAfterCaching(
  path: string,
  cacheAsset: (path: string) => Promise<boolean>,
  insert: (path: string) => void,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (!await cacheAsset(path)) {
    throw new Error("The editor could not load this image. Try choosing it again.");
  }
  if (isCurrent()) insert(path);
}
