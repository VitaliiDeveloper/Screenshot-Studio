// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { insertAssetAfterCaching } from "./asset-picker-model";

describe("asset picker model", () => {
  it("waits for the shared image cache before inserting an asset", async () => {
    let finishCaching!: (cached: boolean) => void;
    const cacheAsset = vi.fn(() => new Promise<boolean>((resolve) => { finishCaching = resolve; }));
    const insert = vi.fn();

    const operation = insertAssetAfterCaching("assets/imported/hero.png", cacheAsset, insert);
    await vi.waitFor(() => expect(cacheAsset).toHaveBeenCalledWith("assets/imported/hero.png"));
    expect(insert).not.toHaveBeenCalled();
    finishCaching(true);
    await operation;

    expect(insert).toHaveBeenCalledWith("assets/imported/hero.png");
  });

  it("does not persist an asset reference when image decoding fails", async () => {
    const insert = vi.fn();

    await expect(insertAssetAfterCaching(
      "assets/imported/broken.png",
      async () => false,
      insert,
    )).rejects.toThrow(/could not load/i);
    expect(insert).not.toHaveBeenCalled();
  });

  it("does not insert after the picker is closed while caching", async () => {
    let current = true;
    const insert = vi.fn();
    const cacheAsset = vi.fn(async () => {
      current = false;
      return true;
    });

    await insertAssetAfterCaching("assets/imported/hero.png", cacheAsset, insert, () => current);

    expect(insert).not.toHaveBeenCalled();
  });
});
