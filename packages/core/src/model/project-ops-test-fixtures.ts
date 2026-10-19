// SPDX-License-Identifier: Apache-2.0
import type { Project } from "./schema.js";

export function sampleProject(): Project {
  return {
    meta: { name: "T", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [{
      id: "default", name: "Default", mode: "connected",
      screens: [
        {
          id: "hero",
          name: "Hero",
          platform: "apple",
          device: "iphone",
          locale: "en",
          direction: "ltr",
          artboard: { width: 1320, height: 2868 },
          background: { type: "solid", color: "#101827" },
          elements: [],
        },
        {
          id: "details",
          name: "Details",
          platform: "apple",
          device: "iphone",
          locale: "en",
          direction: "ltr",
          artboard: { width: 1320, height: 2868 },
          background: { type: "solid", color: "#101827" },
          elements: [],
        },
      ],
    }],
  };
}
