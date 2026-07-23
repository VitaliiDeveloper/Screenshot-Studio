// SPDX-License-Identifier: Apache-2.0
export const PROJECT_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"] as const;

export interface ProjectImageAsset {
  path: string;
  name: string;
  source: "assets" | "screenshots";
}

export function filterProjectImageAssets(
  assets: readonly ProjectImageAsset[],
  query: string,
): ProjectImageAsset[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...assets];
  return assets.filter((asset) => asset.path.toLocaleLowerCase().includes(normalized));
}
