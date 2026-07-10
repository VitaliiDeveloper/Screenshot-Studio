// SPDX-License-Identifier: Apache-2.0
import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import JSZip from "jszip";
import { addDirectory } from "./package-archive.mjs";

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

await readFile(expectedServer);

const zip = new JSZip();
await addDirectory(zip, standaloneRoot);
await addDirectory(zip, join(webRoot, ".next", "static"), "apps/web/.next/static");
try {
  await addDirectory(zip, join(webRoot, "public"), "apps/web/public");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await writeFile(
  join(packageRoot, "runtime", "web.zip"),
  await zip.generateAsync({ type: "nodebuffer", compression: "STORE" }),
);

const sourceManifest = JSON.parse(await readFile(join(cliRoot, "package.json"), "utf8"));
const manifest = {
  name: sourceManifest.name,
  version: sourceManifest.version,
  description: "Code-first App Store and Google Play screenshot editor and exporter",
  license: sourceManifest.license,
  type: "module",
  bin: { screenshots: "./dist/index.js" },
  engines: { node: ">=22.13" },
  files: ["dist", "runtime", "README.md", "LICENSE", "NOTICE"],
  dependencies: {
    playwright: sourceManifest.dependencies.playwright,
    sharp: sourceManifest.dependencies.sharp,
  },
};
await writeFile(join(packageRoot, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await cp(join(cliRoot, "README.md"), join(packageRoot, "README.md"));
await cp(join(repoRoot, "LICENSE"), join(packageRoot, "LICENSE"));
await cp(join(repoRoot, "NOTICE"), join(packageRoot, "NOTICE"));
