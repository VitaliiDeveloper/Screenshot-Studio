// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AppStoreUploadReport, UploadPlanResponse, UploadReport } from "@web/lib/store-upload";
import { missingStoreSetup, uploadBlocked, UploadPlanReview, UploadReportView } from "./StoreUploadDialog.js";

Object.assign(globalThis, { React });

const plan: Extract<UploadPlanResponse, { store: "google" }> = {
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
    const markup = renderToStaticMarkup(React.createElement(UploadPlanReview, { plan, onVersion: () => undefined }));
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

const applePlan: Extract<UploadPlanResponse, { store: "apple" }> = {
  store: "apple",
  identifier: "1234567890",
  layoutId: "default",
  revision: "r1",
  planHash: "b".repeat(64),
  credentialsConfigured: true,
  warnings: [],
  versions: [{ platform: "IOS", editable: [{ versionString: "1.2", state: "PREPARE_FOR_SUBMISSION" }], selected: "1.2" }],
  version: null,
  blocked: null,
  plan: {
    locales: [{
      platform: "IOS",
      locale: "en-US",
      projectLocale: "en",
      sets: [{ displayType: "APP_IPHONE_67", upload: [{ screenId: "hero", screenName: "Hero", sizeId: "iphone-69" }], replace: null }],
    }],
    skipped: [
      { screenId: "duo", platform: "apple", device: "iphone", sizeId: "duo-inner", reason: "No display type" },
      { screenId: "duo-2", platform: "apple", device: "iphone", sizeId: "duo-inner", reason: "No display type" },
    ],
  },
};

const render = (element: React.ReactElement) => renderToStaticMarkup(element);

describe("App Store upload plan review", () => {
  it("shows the version, each localization and display type with its size, the skipped entries and the set limit", () => {
    const markup = render(React.createElement(UploadPlanReview, { plan: applePlan, onVersion: () => undefined }));
    expect(markup).toContain("IOS</span>: version 1.2 (PREPARE_FOR_SUBMISSION)");
    expect(markup).toContain("IOS en-US");
    expect(markup).toContain("APP_IPHONE_67</span>: uploads 1 screenshot at iphone-69 (Hero), replacing every current screenshot in this set");
    expect(markup).toContain("Not uploaded, apple/iphone duo-inner: No display type (2)");
    expect(markup).toContain("at most 10 screenshots per display type");
    expect(markup).not.toContain('aria-label="App Store version"');
    expect(uploadBlocked(applePlan)).toBeNull();
  });

  it("asks for a version when a platform has several, and confirms only once one is picked", () => {
    const several = {
      ...applePlan,
      versions: [{ platform: "IOS", editable: [{ versionString: "1.2", state: "READY_FOR_REVIEW" }, { versionString: "1.3", state: "PREPARE_FOR_SUBMISSION" }], selected: null }],
    };
    const markup = render(React.createElement(UploadPlanReview, { plan: several, onVersion: () => undefined }));
    expect(markup).toContain("several editable versions: 1.2 (READY_FOR_REVIEW), 1.3 (PREPARE_FOR_SUBMISSION)");
    expect(markup).toContain('aria-label="App Store version"');
    expect(markup).toContain("Choose the version to upload to");
    expect(uploadBlocked(several)).toBe("Pick the App Store version to upload to.");
    const picked = { ...several, version: "1.3", versions: [{ ...several.versions[0]!, selected: "1.3" }] };
    expect(uploadBlocked(picked)).toBeNull();
  });

  it("explains a platform without an editable version and a missing key", () => {
    const none = {
      ...applePlan,
      versions: [{ platform: "IOS", editable: [], selected: null }],
      blocked: "IOS has no editable version; create one in App Store Connect first",
    };
    expect(render(React.createElement(UploadPlanReview, { plan: none, onVersion: () => undefined }))).toContain("create one in App Store Connect first");
    expect(uploadBlocked(none)).toContain("no editable version");
    const unconfigured = { ...applePlan, credentialsConfigured: false, versions: null };
    expect(render(React.createElement(UploadPlanReview, { plan: unconfigured, onVersion: () => undefined }))).toContain("once its API key is in Stores");
    expect(missingStoreSetup(unconfigured, null)).toContain("App Store Connect API key in Stores");
  });
});

describe("App Store upload report", () => {
  const report = (states: AppStoreUploadReport["locales"][number]["sets"][number]["state"][]): AppStoreUploadReport => ({
    store: "apple",
    appId: "1234567890",
    layoutId: "default",
    dryRun: false,
    versions: [{ platform: "IOS", versionString: "1.2", state: "PREPARE_FOR_SUBMISSION" }],
    locales: [{
      platform: "IOS",
      locale: "en-US",
      projectLocale: "en",
      sets: states.map((state, index) => ({
        displayType: `APP_SET_${index}`,
        upload: [],
        replace: [],
        state,
        ...(state === "partial" ? { error: "The screenshot set cannot be changed now." } : {}),
      })),
    }],
    skipped: [],
  });

  it("shows every set replaced without the non-atomic note", () => {
    const markup = render(React.createElement(UploadReportView, { report: report(["replaced", "replaced"]), warnings: [] }));
    expect(markup).toContain("Replaced 2 of 2 screenshot sets in app 1234567890 (IOS 1.2).");
    expect(markup).not.toContain("no atomic commit");
  });

  it("shows each set state and explains the non-atomic upload once a set is partial or failed", () => {
    for (const states of [["replaced", "partial", "untouched"], ["failed", "untouched"]] as const) {
      const markup = render(React.createElement(UploadReportView, { report: report([...states]), warnings: [] }));
      for (const [index, state] of states.entries()) expect(markup).toContain(`IOS en-US APP_SET_${index}: ${state}`);
      expect(markup).toContain("App Store Connect has no atomic commit");
    }
    expect(render(React.createElement(UploadReportView, { report: report(["replaced", "partial"]), warnings: [] })))
      .toContain("partial (The screenshot set cannot be changed now.)");
  });
});
