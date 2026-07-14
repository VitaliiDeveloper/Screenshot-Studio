// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, tmpdir, totalmem } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { clearInterval, clearTimeout, setInterval, setTimeout } from "node:timers";
import { fileURLToPath, URL } from "node:url";
import { promisify } from "node:util";
import JSZip from "jszip";
import { PNG } from "pngjs";

const execFile = promisify(execFileCallback);
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const stagedPackage = join(repoRoot, "packages", "cli", "package");
const livingProject = join(repoRoot, "examples", "connected-launch");
const hostPrefix = "screenshot-studio-web-";
const expectedSize = { width: 1320, height: 2868 };
const defaultSamples = 5;

export const budgets = {
  large: { medianWallMs: 10_500, maxPeakRssMiB: 1_350 },
  repeat: { medianWallMs: 4_200, maxPeakRssMiB: 1_200 },
};

export function median(values) {
  const ordered = [...values].sort((first, second) => first - second);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

export function hasMaterialMonotonicGrowth(values, ratio = 1.15) {
  if (values.length < 3 || values.at(-1) < values[0] * ratio) return false;
  return values.every((value, index) => index === 0 || value >= values[index - 1] * 0.98);
}

function parseOptions(argv) {
  let baseline = false;
  let samples = defaultSamples;
  let reportPath;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") {
      continue;
    } else if (argument === "--baseline") {
      baseline = true;
    } else if (argument === "--samples") {
      samples = Number(argv[index + 1]);
      index += 1;
    } else if (argument === "--report") {
      reportPath = resolve(argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`Unknown export soak option: ${argument}`);
    }
  }
  if (!Number.isInteger(samples) || samples < 3) {
    throw new Error("--samples must be an integer of at least 3");
  }
  return { baseline, samples, reportPath };
}

async function runPnpm(args, cwd) {
  if (!process.env.npm_execpath) throw new Error("pnpm entrypoint is unavailable");
  return execFile(process.execPath, [process.env.npm_execpath, ...args], {
    cwd,
    timeout: 600_000,
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
  });
}

async function installPackedCli(workspace) {
  const consumer = join(workspace, "consumer");
  await mkdir(consumer, { recursive: true });
  await writeFile(join(consumer, "package.json"), '{"name":"export-soak","private":true}\n');
  const packed = await runPnpm([
    "--dir",
    stagedPackage,
    "pack",
    "--json",
    "--pack-destination",
    workspace,
  ], repoRoot);
  const details = JSON.parse(packed.stdout);
  const tarball = isAbsolute(details.filename)
    ? details.filename
    : resolve(stagedPackage, details.filename);
  const store = (await runPnpm(["store", "path"], repoRoot)).stdout.trim();
  await runPnpm([
    "--store-dir",
    store,
    "add",
    tarball,
    "--offline",
    "--ignore-scripts",
  ], consumer);
  const bin = join(consumer, "node_modules", ".bin", "screenshots");
  await chmod(bin, 0o755);
  return { bin, consumer };
}

async function createProject(destination, locales) {
  const project = JSON.parse(await readFile(join(livingProject, "app-store-screenshots.json"), "utf8"));
  const sourceScreens = project.screens;
  project.meta.name = `Export ${locales.length === 1 ? "Repeat" : "Large"} Soak`;
  project.locales = locales;
  project.screens = locales.flatMap((locale) => sourceScreens.map((source) => ({
    ...JSON.parse(JSON.stringify(source)),
    id: `${source.id}-${locale}`,
    locale,
  })));
  await mkdir(destination, { recursive: true });
  await cp(join(livingProject, "assets"), join(destination, "assets"), { recursive: true });
  const projectPath = join(destination, "app-store-screenshots.json");
  await writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`);
  return { projectPath, screenCount: project.screens.length };
}

async function processTreeRssKiB(rootPid) {
  const { stdout } = await execFile("ps", ["-axo", "pid=,ppid=,rss="], {
    maxBuffer: 10 * 1024 * 1024,
  });
  const processes = stdout.trim().split("\n").map((line) => {
    const [pid, parentPid, rss] = line.trim().split(/\s+/).map(Number);
    return { pid, parentPid, rss };
  }).filter((entry) => entry.pid && entry.parentPid >= 0 && entry.rss >= 0);
  const descendants = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of processes) {
      if (descendants.has(entry.parentPid) && !descendants.has(entry.pid)) {
        descendants.add(entry.pid);
        changed = true;
      }
    }
  }
  return processes
    .filter((entry) => descendants.has(entry.pid))
    .reduce((total, entry) => total + entry.rss, 0);
}

async function runMeasured(command, args, cwd) {
  const startedAt = performance.now();
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  let peakRssKiB = 0;
  let sampling = Promise.resolve();
  const sample = () => {
    sampling = sampling.then(async () => {
      try {
        peakRssKiB = Math.max(peakRssKiB, await processTreeRssKiB(child.pid));
      } catch {
        // The process can disappear between the exit event and the final sample.
      }
    });
  };
  sample();
  const interval = setInterval(sample, 100);
  const timeout = setTimeout(() => child.kill("SIGTERM"), 600_000);
  const { code, signal } = await new Promise((resolveClose, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, exitSignal) => resolveClose({ code: exitCode, signal: exitSignal }));
  });
  clearInterval(interval);
  clearTimeout(timeout);
  await sampling;

  if (code !== 0) {
    throw new Error(
      `Packed export exited with ${signal ? `signal ${signal}` : `code ${code}`}\n${stdout}\n${stderr}`.trim(),
    );
  }
  return {
    wallMs: Math.round(performance.now() - startedAt),
    peakRssMiB: Math.round((peakRssKiB / 1024) * 10) / 10,
  };
}

async function listFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((first, second) => first.name.localeCompare(second.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, path));
    else if (entry.isFile()) files.push({ path, relativePath: relative(root, path).split("\\").join("/") });
  }
  return files;
}

function assertOpaqueExactPng(bytes, relativePath) {
  const png = PNG.sync.read(bytes);
  if (png.width !== expectedSize.width || png.height !== expectedSize.height) {
    throw new Error(`${relativePath} has ${png.width}x${png.height}, expected 1320x2868`);
  }
  for (let index = 3; index < png.data.length; index += 4) {
    if (png.data[index] !== 255) throw new Error(`${relativePath} contains alpha`);
  }
}

async function validateOutputs(outDir, expectedPngCount) {
  const files = await listFiles(outDir);
  const pngFiles = files.filter((file) => file.relativePath.endsWith(".png"));
  const zipFile = files.find((file) => file.relativePath === "app-store-screenshots-bundle.zip");
  if (pngFiles.length !== expectedPngCount || !zipFile || files.length !== expectedPngCount + 1) {
    throw new Error(`Expected ${expectedPngCount} PNGs plus one ZIP, found ${files.length} files`);
  }
  for (const file of pngFiles) assertOpaqueExactPng(await readFile(file.path), file.relativePath);

  const zip = await JSZip.loadAsync(await readFile(zipFile.path));
  const zipEntries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.name)
    .sort();
  const pngPaths = pngFiles.map((file) => file.relativePath).sort();
  if (JSON.stringify(zipEntries) !== JSON.stringify(pngPaths)) {
    throw new Error("Bundle ZIP entries do not match exported PNG paths");
  }

  const manifest = {};
  for (const file of files) {
    manifest[file.relativePath] = createHash("sha256").update(await readFile(file.path)).digest("hex");
  }
  return manifest;
}

async function renderHostDirectories() {
  return (await readdir(tmpdir(), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(hostPrefix))
    .map((entry) => entry.name)
    .sort();
}

async function assertHostCleanup(expected) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const current = await renderHostDirectories();
    if (JSON.stringify(current) === JSON.stringify(expected)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error("Packed render-host temp directories leaked after process exit");
}

function summarizeSamples(samples, screenCount, manifest) {
  const wallTimes = samples.map((sample) => sample.wallMs);
  const rssValues = samples.map((sample) => sample.peakRssMiB);
  return {
    screenCount,
    samples,
    medianWallMs: median(wallTimes),
    maxPeakRssMiB: Math.max(...rssValues),
    monotonicMaterialRssGrowth: hasMaterialMonotonicGrowth(rssValues),
    outputManifestSha256: createHash("sha256")
      .update(JSON.stringify(manifest))
      .digest("hex"),
  };
}

async function runHarness({ name, project, samples, bin, consumer, outputRoot }) {
  const results = [];
  let referenceManifest;
  for (let index = 0; index < samples; index += 1) {
    const outDir = join(outputRoot, `${name}-${index + 1}`);
    const hostsBefore = await renderHostDirectories();
    const result = await runMeasured(bin, [
      "export",
      "--project",
      project.projectPath,
      "--out",
      outDir,
    ], consumer);
    await assertHostCleanup(hostsBefore);
    const manifest = await validateOutputs(outDir, project.screenCount);
    referenceManifest ??= manifest;
    if (JSON.stringify(manifest) !== JSON.stringify(referenceManifest)) {
      throw new Error(`${name} output hashes changed at sample ${index + 1}`);
    }
    results.push(result);
  }
  return summarizeSamples(results, project.screenCount, referenceManifest);
}

function assertBudgets(report) {
  if (!budgets) throw new Error("Export soak budgets are not ratified; run with --baseline");
  for (const name of ["large", "repeat"]) {
    const result = report[name];
    const budget = budgets[name];
    if (result.medianWallMs > budget.medianWallMs) {
      throw new Error(`${name} median wall time ${result.medianWallMs}ms exceeds ${budget.medianWallMs}ms`);
    }
    if (result.maxPeakRssMiB > budget.maxPeakRssMiB) {
      throw new Error(`${name} peak RSS ${result.maxPeakRssMiB}MiB exceeds ${budget.maxPeakRssMiB}MiB`);
    }
    if (result.monotonicMaterialRssGrowth) {
      throw new Error(`${name} samples show material monotonic RSS growth`);
    }
  }
}

function humanSummary(report) {
  return ["large", "repeat"].map((name) => {
    const result = report[name];
    return `${name}: ${result.screenCount} screens, median ${result.medianWallMs}ms, peak ${result.maxPeakRssMiB}MiB`;
  }).join("\n");
}

export async function main(argv = process.argv.slice(2)) {
  if (platform() === "win32") {
    throw new Error("Export soak RSS measurement requires a macOS or Linux release runner");
  }
  const options = parseOptions(argv);
  const workspace = await mkdtemp(join(tmpdir(), "screenshot-studio-soak-"));
  try {
    const { bin, consumer } = await installPackedCli(workspace);
    const largeProject = await createProject(join(workspace, "large-project"), ["en", "fr", "de", "ja"]);
    const repeatProject = await createProject(join(workspace, "repeat-project"), ["en"]);
    const outputRoot = join(workspace, "output");
    const large = await runHarness({
      name: "large",
      project: largeProject,
      samples: options.samples,
      bin,
      consumer,
      outputRoot,
    });
    const repeat = await runHarness({
      name: "repeat",
      project: repeatProject,
      samples: options.samples,
      bin,
      consumer,
      outputRoot,
    });
    const report = {
      schemaVersion: 1,
      mode: options.baseline ? "baseline" : "verify",
      environment: {
        platform: platform(),
        release: release(),
        arch: arch(),
        node: process.versions.node,
        cpu: cpus()[0]?.model ?? "unknown",
        logicalCpus: cpus().length,
        totalMemoryMiB: Math.round(totalmem() / 1024 / 1024),
      },
      sampleCount: options.samples,
      budgets,
      large,
      repeat,
    };
    if (!options.baseline) assertBudgets(report);
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (options.reportPath) {
      await mkdir(dirname(options.reportPath), { recursive: true });
      await writeFile(options.reportPath, json);
    }
    process.stderr.write(`${humanSummary(report)}\n`);
    process.stdout.write(json);
    return report;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
