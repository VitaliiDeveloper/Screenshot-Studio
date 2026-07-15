// SPDX-License-Identifier: Apache-2.0
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALLOWED_LICENSES,
  EXPECTED_PACK_FILES,
  isForbiddenRuntimeEntry,
  licenseTexts,
  reviewedPackageLicense,
  validatePackFiles,
} from "./release-audit.mjs";

describe("release package audit", () => {
  it("allows tslib's reviewed zero-clause BSD license", () => {
    expect(ALLOWED_LICENSES.has("0BSD")).toBe(true);
  });

  it("pins the packed file allowlist", () => {
    expect(() => validatePackFiles(EXPECTED_PACK_FILES)).not.toThrow();
    expect(() => validatePackFiles([...EXPECTED_PACK_FILES, "src/index.ts"])).toThrow(/Unexpected package files/);
  });

  it("rejects native or platform-labelled embedded runtime files", () => {
    expect(isForbiddenRuntimeEntry("node_modules/example/addon.node")).toBe(true);
    expect(isForbiddenRuntimeEntry("node_modules/example/lib-linux-x64.js")).toBe(true);
    expect(isForbiddenRuntimeEntry("node_modules/react/index.js")).toBe(false);
  });

  it.each([
    ["dfa", "1.2.0", "README.md"],
    ["fontkit", "2.0.4", "README.md"],
  ])("uses the reviewed full MIT notice for %s's identifier-only README", async (
    name,
    version,
    readmeName,
  ) => {
    const root = await mkdtemp(join(tmpdir(), `release-audit-${name}-license-`));
    try {
      await writeFile(join(root, readmeName), `# ${name}\n\n## License\n\nMIT\n`);

      const texts = await licenseTexts(root, {
        name,
        version,
        license: "MIT",
        author: "Devon Govett <devongovett@gmail.com>",
      });
      const notice = texts.join("\n");

      expect(notice).toContain(`${readmeName} license declaration: MIT`);
      expect(notice).toContain("Copyright (c) Devon Govett <devongovett@gmail.com>");
      expect(notice).toContain("Permission is hereby granted, free of charge");
      expect(notice).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
      await expect(licenseTexts(root, {
        name,
        version,
        license: "MIT",
        author: "Unexpected author",
      })).rejects.toThrow(/author metadata drifted/);
      await expect(licenseTexts(root, {
        name,
        version,
        license: "ISC",
        author: "Devon Govett <devongovett@gmail.com>",
      })).rejects.toThrow(/license metadata drifted/);
      await expect(licenseTexts(root, {
        name,
        version: `${version}-drifted`,
        license: "MIT",
        author: "Devon Govett <devongovett@gmail.com>",
      })).rejects.toThrow(/Missing license text/);
      await writeFile(join(root, readmeName), `# ${name}\n\n## License\n\nISC\n`);
      await expect(licenseTexts(root, {
        name,
        version,
        license: "MIT",
        author: "Devon Govett <devongovett@gmail.com>",
      })).rejects.toThrow(/README license declaration drifted/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("records brotli's shipped Google decoder under MIT and Apache-2.0", async () => {
    const root = await mkdtemp(join(tmpdir(), "release-audit-brotli-license-"));
    try {
      await writeFile(join(root, "readme.md"), "# brotli\n\n## License\n\nMIT\n");
      await mkdir(join(root, "dec"));
      await writeFile(join(root, "dec", "decode.js"), `/* Copyright 2013 Google Inc. All Rights Reserved.

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/
`);
      const manifest = {
        name: "brotli",
        version: "1.3.3",
        license: "MIT",
        author: "Devon Govett <devongovett@gmail.com>",
      };

      expect(reviewedPackageLicense(manifest)).toBe("(MIT AND Apache-2.0)");
      const notice = (await licenseTexts(root, manifest)).join("\n");
      expect(notice).toContain("Copyright (c) Devon Govett <devongovett@gmail.com>");
      expect(notice).toContain("Copyright 2013 Google Inc. All Rights Reserved.");
      expect(notice).toContain("Apache License\n                           Version 2.0");
      await expect(licenseTexts(root, { ...manifest, author: "Unexpected author" }))
        .rejects.toThrow(/author metadata drifted/);
      await expect(licenseTexts(root, { ...manifest, license: "ISC" }))
        .rejects.toThrow(/license metadata drifted/);
      await expect(licenseTexts(root, { ...manifest, version: "1.3.4" }))
        .rejects.toThrow(/Missing license text/);
      expect(reviewedPackageLicense({ ...manifest, version: "1.3.4" })).toBe("MIT");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not generalize the identifier-only fallback to unreviewed packages", async () => {
    const root = await mkdtemp(join(tmpdir(), "release-audit-unreviewed-license-"));
    try {
      await writeFile(join(root, "README.md"), "# unknown\n\n## License\n\nMIT\n");

      await expect(licenseTexts(root, {
        name: "unknown-package",
        version: "1.0.0",
        license: "MIT",
        author: "Unknown",
      })).rejects.toThrow(/Missing license text/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
