// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { parseProject } from "@screenshot-studio/core/model";
import {
  collectRequiredProjectResourcePaths,
  isSensitiveProjectArchivePath,
  isSupportedProjectArchivePath,
} from "./project-archive-policy.js";

describe("project archive policy", () => {
  it.each([
    "app-store-screenshots.json",
    "AGENTS.md",
    "CLAUDE.md",
    "assets/decor/hero.png",
    "assets/fonts/inter.woff2",
    "screenshots/apple/iphone/en/01.png",
    "themes/launch.json",
    "templates/hero.json",
    "packs/house/screen-pack.json",
    "packs/house/assets/bg.png",
  ])("includes supported project path %s", (path) => {
    expect(isSupportedProjectArchivePath(path)).toBe(true);
  });

  it.each([
    "export/apple/iphone/en/01.png",
    ".env",
    ".env.local",
    ".git/config",
    "credentials.json",
    "assets/private.pem",
    "assets/signing.p12",
    "assets/cache.tmp",
    "assets/project.lock",
    "assets/project.lock.json",
    "assets/service-account.json",
    "staging/file.png",
    "catalog.json",
    "notes.txt",
    // A data root launched from the project folder still never enters its archive.
    ".screenshot-studio/store-credentials/google-play-service-account.json",
    ".screenshot-studio/store-credentials/app-store-connect.json",
  ])("excludes unsafe or unsupported project path %s", (path) => {
    expect(isSupportedProjectArchivePath(path)).toBe(false);
  });

  it.each([
    ".env",
    ".git/config",
    "export/.cache/frame.png",
    "credentials.json",
    "export/service-account.json",
    "notes/id_rsa",
    "assets/private.pem",
  ])("treats hidden or credential-bearing path %s as sensitive", (path) => {
    expect(isSensitiveProjectArchivePath(path)).toBe(true);
  });

  it.each([
    "export/apple/iphone/en/01.png",
    "export/app-store-screenshots-bundle.zip",
    "preview-sheet.png",
    "assets/cache.tmp",
    "catalog.json",
  ])("treats unsupported but harmless path %s as not sensitive", (path) => {
    expect(isSensitiveProjectArchivePath(path)).toBe(false);
  });

  it("collects every strict document resource without duplicates", () => {
    const project = parseProject({
      meta: { name: "Portable", appIcon: "assets/icon.png", schemaVersion: 1 },
      fonts: [
        { family: "Inter", source: "uploaded", path: "assets/fonts/inter.woff2", weight: 400 },
      ],
      preferredExportLayoutId: "primary",
      layouts: [{
        id: "primary",
        name: "Primary",
        mode: "isolated",
        screens: [{
          id: "hero",
          name: "Hero",
          platform: "apple",
          device: "iphone",
          locale: "en",
          artboard: { width: 660, height: 1434 },
          background: {
            type: "image",
            assetUrl: "assets/background.png",
            fit: "cover",
            color: "#000000",
          },
          elements: [{
            id: "shot",
            type: "screenshot",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            assetUrl: "screenshots/hero.png",
            fit: "cover",
            cornerRadius: 0,
          }, {
            id: "same",
            type: "image",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            assetUrl: "assets/background.png",
            fit: "contain",
            cornerRadius: 0,
          }],
        }],
      }],
    });

    expect(collectRequiredProjectResourcePaths(project)).toEqual([
      "assets/background.png",
      "assets/fonts/inter.woff2",
      "assets/icon.png",
      "screenshots/hero.png",
    ]);
  });
});
