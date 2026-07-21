// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { initialMediaElementSize, insertAssetAfterCaching } from "@web/components/asset-picker-model";

describe("asset picker model", () => {
  it("waits for the shared image cache before inserting an asset", async () => {
    let finishCaching!: (cached: { width: number; height: number } | null) => void;
    const cacheAsset = vi.fn(() => new Promise<{ width: number; height: number } | null>((resolve) => { finishCaching = resolve; }));
    const insert = vi.fn();

    const operation = insertAssetAfterCaching("assets/imported/hero.png", cacheAsset, insert);
    await vi.waitFor(() => expect(cacheAsset).toHaveBeenCalledWith("assets/imported/hero.png"));
    expect(insert).not.toHaveBeenCalled();
    finishCaching({ width: 1290, height: 2796 });
    await operation;

    expect(insert).toHaveBeenCalledWith(
      "assets/imported/hero.png",
      { width: 1290, height: 2796 },
    );
  });

  it("does not persist an asset reference when image decoding fails", async () => {
    const insert = vi.fn();

    await expect(insertAssetAfterCaching(
      "assets/imported/broken.png",
      async () => null,
      insert,
    )).rejects.toThrow(/could not load/i);
    expect(insert).not.toHaveBeenCalled();
  });

  it("does not insert after the picker starts closing while caching", async () => {
    const active = true;
    let closing = false;
    const insert = vi.fn();
    const cacheAsset = vi.fn(async () => {
      closing = true;
      return { width: 1290, height: 2796 };
    });

    await insertAssetAfterCaching(
      "assets/imported/hero.png",
      cacheAsset,
      insert,
      () => active && !closing,
    );

    expect(insert).not.toHaveBeenCalled();
  });

  it("preserves a portrait screenshot aspect ratio without creating an excessively tall layer", () => {
    const size = initialMediaElementSize({ width: 1290, height: 2796 });

    expect(size.height).toBe(600);
    expect(size.width / size.height).toBeCloseTo(1290 / 2796);
  });

  it("uses the standard insertion width for landscape and square images", () => {
    expect(initialMediaElementSize({ width: 1600, height: 900 })).toEqual({
      width: 300,
      height: 168.75,
    });
    expect(initialMediaElementSize({ width: 512, height: 512 })).toEqual({
      width: 300,
      height: 300,
    });
  });
});
