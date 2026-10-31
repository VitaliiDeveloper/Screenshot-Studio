// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UploadPlanResponse, UploadReport } from "@web/lib/store-upload";
import { missingStoreSetup, UploadPlanReview, UploadReportView } from "./StoreUploadDialog.js";

Object.assign(globalThis, { React });

const plan: UploadPlanResponse = {
  store: "google",
  identifier: "com.example.app",
  layoutId: "default",
  revision: "r1",
  planHash: "a".repeat(64),
  credentialsConfigured: true,
  warnings: ["Text overflows on Hero"],
  plan: {
    locales: [{
      locale: "en-US",
      projectLocale: "en",
      slots: [
        { imageType: "phoneScreenshots", upload: [{ screenId: "hero", screenName: "Hero", sizeId: "s" }, { screenId: "two", screenName: "Two", sizeId: "s" }], replace: null },
        { imageType: "featureGraphic", upload: [{ screenId: "promo", screenName: "Promo", sizeId: "f" }], replace: null },
      ],
      untouchedSlots: ["tvScreenshots", "wearScreenshots"],
    }],
    untouchedLocales: null,
    skipped: [
      { screenId: "mac", platform: "apple", device: "mac", sizeId: "m" },
      { screenId: "mac2", platform: "apple", device: "mac", sizeId: "m" },
    ],
  },
};

describe("upload plan review", () => {
  it("shows per locale and slot what is uploaded and replaced, what is left alone, skipped and the limits", () => {
    const markup = renderToStaticMarkup(React.createElement(UploadPlanReview, { plan }));
    expect(markup).toContain("en-US");
    expect(markup).toContain("from project locale en");
    expect(markup).toContain("Phone screenshots</span>: uploads 2 images (Hero, Two), replacing every current image in this slot");
    expect(markup).toContain("Feature graphic</span>: uploads 1 image (Promo)");
    expect(markup).toContain("Left as they are: TV screenshots, Wear OS screenshots");
    expect(markup).toContain("Other store languages are left as they are.");
    expect(markup).toContain("Not uploaded, no store slot: apple/mac (2)");
    expect(markup).toContain("at most 8 screenshots");
    expect(markup).toContain("not only the sizes and locales checked for export");
    expect(markup).toContain("Text overflows on Hero");
  });

  it("points at Stores when the identifier or key is missing", () => {
    expect(missingStoreSetup(plan, null)).toBeNull();
    expect(missingStoreSetup({ ...plan, credentialsConfigured: false }, null)).toContain("service account key in Stores");
    expect(missingStoreSetup(null, { message: "no package name", code: "missing-identifier" })).toBe("no package name");
    expect(missingStoreSetup(null, { message: "boom", code: "plan-stale" })).toBeNull();
  });

  it("reports the committed result per locale and slot", () => {
    const report: UploadReport = {
      store: "google",
      packageName: "com.example.app",
      layoutId: "default",
      dryRun: false,
      committed: true,
      locales: plan.plan.locales.map((locale) => ({
        ...locale,
        slots: locale.slots.map((slot) => ({ ...slot, replace: [{ id: "1" }, { id: "2" }, { id: "3" }] })),
      })),
      untouchedLocales: ["de-DE"],
      skipped: [],
    };
    const markup = renderToStaticMarkup(React.createElement(UploadReportView, { report, warnings: [] }));
    expect(markup).toContain("Committed one edit to com.example.app: 3 images in 1 language.");
    expect(markup).toContain("en-US Phone screenshots: uploaded 2, replaced 3");
  });
});
