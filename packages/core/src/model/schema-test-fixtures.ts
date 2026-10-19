// SPDX-License-Identifier: Apache-2.0
import { SCHEMA_VERSION } from "./index.js";

export function validProject() {
  return {
    meta: { name: "Sample", schemaVersion: SCHEMA_VERSION },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [{
      id: "default",
      name: "Default",
      mode: "isolated",
      screens: [
        {
          id: "s1",
          name: "Screen 1",
          platform: "apple",
          device: "iphone",
          locale: "en",
          artboard: { width: 1320, height: 2868 },
          background: { type: "solid", color: "#0A0A0A" },
          elements: [
            {
              id: "t1",
              type: "text",
              x: 100,
              y: 100,
              width: 1120,
              height: 300,
              content: "Hello",
              fontFamily: "Inter",
              size: 96,
              color: "#FFFFFF",
            },
          ],
        },
      ],
    }],
  };
}
