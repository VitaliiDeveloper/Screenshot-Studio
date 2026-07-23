// SPDX-License-Identifier: Apache-2.0

export interface CachedAssetDimensions {
  width: number;
  height: number;
}

const DEFAULT_MEDIA_WIDTH = 300;
const MAX_DEFAULT_MEDIA_HEIGHT = 600;

export function initialMediaElementSize(
  dimensions: CachedAssetDimensions,
): CachedAssetDimensions {
  const scale = Math.min(
    DEFAULT_MEDIA_WIDTH / dimensions.width,
    MAX_DEFAULT_MEDIA_HEIGHT / dimensions.height,
  );
  return {
    width: dimensions.width * scale,
    height: dimensions.height * scale,
  };
}

export async function insertAssetAfterCaching(
  path: string,
  cacheAsset: (path: string) => Promise<CachedAssetDimensions | null>,
  insert: (path: string, dimensions: CachedAssetDimensions) => void,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const dimensions = await cacheAsset(path);
  if (!dimensions) {
    throw new Error("The editor could not load this image. Try choosing it again.");
  }
  if (isCurrent()) insert(path, dimensions);
}
