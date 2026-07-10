import { chmod, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import JSZip from "jszip";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliRoot = join(repoRoot, "packages", "cli");
const packageRoot = join(cliRoot, "package");
const webRoot = join(repoRoot, "apps", "web");
const standaloneRoot = join(webRoot, ".next", "standalone");
const hostAssembly = join(packageRoot, ".render-host");
const expectedServer = join(hostAssembly, "apps", "web", "server.js");

async function addDirectory(zip, root, directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((first, second) => first.name < second.name ? -1 : first.name > second.name ? 1 : 0);
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await addDirectory(zip, root, path);
    } else if (entry.isFile()) {
      zip.file(relative(root, path).split("\\").join("/"), await readFile(path));
    }
  }
}

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

await cp(standaloneRoot, hostAssembly, { recursive: true, dereference: true });
await cp(
  join(webRoot, ".next", "static"),
  join(hostAssembly, "apps", "web", ".next", "static"),
  { recursive: true, dereference: true },
);
try {
  await cp(join(webRoot, "public"), join(hostAssembly, "apps", "web", "public"), {
    recursive: true,
    dereference: true,
  });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await readFile(expectedServer);

const zip = new JSZip();
await addDirectory(zip, hostAssembly, hostAssembly);
await writeFile(
  join(packageRoot, "runtime", "web.zip"),
  await zip.generateAsync({ type: "nodebuffer", compression: "STORE" }),
);
await rm(hostAssembly, { recursive: true, force: true });

const sourceManifest = JSON.parse(await readFile(join(cliRoot, "package.json"), "utf8"));
const manifest = {
  name: sourceManifest.name,
  version: sourceManifest.version,
  description: "Code-first App Store and Google Play screenshot editor and exporter",
  license: sourceManifest.license,
  type: "module",
  bin: { screenshots: "./dist/index.js" },
  engines: { node: ">=22.13" },
  files: ["dist", "runtime", "README.md", "LICENSE"],
  dependencies: {
    playwright: sourceManifest.dependencies.playwright,
    sharp: sourceManifest.dependencies.sharp,
  },
};
await writeFile(join(packageRoot, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await cp(join(cliRoot, "README.md"), join(packageRoot, "README.md"));
await cp(join(repoRoot, "LICENSE"), join(packageRoot, "LICENSE"));
