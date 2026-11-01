// SPDX-License-Identifier: Apache-2.0
import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import JSZip from "jszip";
import {
  addDirectory,
  isPortableRenderHostPath,
  PACKAGE_LINKS_MANIFEST,
} from "./package-archive.mjs";
import { generateThirdPartyNotices } from "./release-audit.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliRoot = join(repoRoot, "packages", "cli");
const packageRoot = join(cliRoot, "package");
const webRoot = join(repoRoot, "apps", "web");
const standaloneRoot = join(webRoot, ".next", "standalone");
const expectedServer = join(standaloneRoot, "apps", "web", "server.js");

await rm(packageRoot, { recursive: true, force: true });
await mkdir(join(packageRoot, "dist"), { recursive: true });
await mkdir(join(packageRoot, "runtime"), { recursive: true });

await build({
  entryPoints: [join(cliRoot, "src", "index.ts")],
  outfile: join(packageRoot, "dist", "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  external: ["playwright", "sharp"],
});
await chmod(join(packageRoot, "dist", "index.js"), 0o755);
await cp(join(cliRoot, "src", "project-agent-guide.md"), join(packageRoot, "dist", "project-agent-guide.md"));
await cp(join(repoRoot, "store-specs.json"), join(packageRoot, "runtime", "store-specs.json"));
// Editor agent runs find the skill beside the store specs; only its instructions ship, not the bootstrap.
for (const file of ["SKILL.md", "references/art-direction.md", "references/critic.md"]) {
  await cp(join(repoRoot, "skills", "screenshot-studio", file), join(packageRoot, "runtime", "skills", "screenshot-studio", file));
}

await readFile(expectedServer);

const zip = new JSZip();
const archiveOptions = { include: isPortableRenderHostPath };
const links = await addDirectory(zip, standaloneRoot, "", archiveOptions);
links.push(...await addDirectory(zip, join(webRoot, ".next", "static"), "apps/web/.next/static"));
try {
  links.push(...await addDirectory(zip, join(webRoot, "public"), "apps/web/public"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const portableLinks = links
  .filter((link) => isPortableRenderHostPath(link.path) && isPortableRenderHostPath(link.target))
  .sort((first, second) => first.path.localeCompare(second.path));
zip.file(PACKAGE_LINKS_MANIFEST, `${JSON.stringify({ version: 1, links: portableLinks }, null, 2)}\n`, {
  createFolders: false,
  date: new Date("2000-01-01T00:00:00.000Z"),
});
await writeFile(
  join(packageRoot, "runtime", "web.zip"),
  await zip.generateAsync({ type: "nodebuffer", compression: "STORE" }),
);
await generateThirdPartyNotices({
  sourceMapPath: join(packageRoot, "dist", "index.js.map"),
  webArchivePath: join(packageRoot, "runtime", "web.zip"),
  outputPath: join(packageRoot, "THIRD_PARTY_NOTICES.md"),
});

const sourceManifest = JSON.parse(await readFile(join(cliRoot, "package.json"), "utf8"));
const manifest = {
  name: sourceManifest.name,
  version: sourceManifest.version,
  description: sourceManifest.description,
  license: sourceManifest.license,
  type: "module",
  repository: sourceManifest.repository,
  homepage: sourceManifest.homepage,
  bugs: sourceManifest.bugs,
  keywords: sourceManifest.keywords,
  publishConfig: sourceManifest.publishConfig,
  bin: { screenshots: "./dist/index.js", "ss-studio": "./dist/index.js" },
  engines: { node: ">=22.13" },
  files: ["dist", "runtime", "README.md", "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"],
  dependencies: {
    playwright: sourceManifest.dependencies.playwright,
    sharp: sourceManifest.dependencies.sharp,
  },
};
await writeFile(join(packageRoot, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await cp(join(cliRoot, "README.md"), join(packageRoot, "README.md"));
await cp(join(repoRoot, "LICENSE"), join(packageRoot, "LICENSE"));
await cp(join(repoRoot, "NOTICE"), join(packageRoot, "NOTICE"));
