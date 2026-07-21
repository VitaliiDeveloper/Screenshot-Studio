// SPDX-License-Identifier: Apache-2.0
import type { Project } from "@screenshot-studio/core/model";
import type { RenderedBundleEntry, BundleExtraFile } from "./bundle-publisher.js";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export function buildWebSharePackage(
  project: Project,
  rendered: readonly RenderedBundleEntry[],
): { screenshots: RenderedBundleEntry[]; extraFiles: BundleExtraFile[] } {
  if (rendered.length === 0) throw new Error("Web Share requires at least one rendered screenshot");
  const screenshots = rendered.map(({ entry, png }) => ({
    entry: { ...entry, relativePath: `web-share/screenshots/${entry.relativePath}` },
    png,
  }));
  const figures = screenshots.map(({ entry }) => {
    const relative = entry.relativePath.slice("web-share/".length);
    return `<figure><img src="${relative}" alt="${escapeHtml(entry.screen.name)} — ${escapeHtml(entry.screen.device)}" loading="lazy"><figcaption>${escapeHtml(entry.screen.name)} · ${escapeHtml(entry.screen.locale)}</figcaption></figure>`;
  }).join("\n");
  const css = `:root{color-scheme:light dark;font-family:system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:#0f172a;color:#f8fafc}main{max-width:1400px;margin:auto;padding:clamp(1rem,4vw,4rem)}h1{font-size:clamp(2rem,6vw,5rem);margin:.2em 0}p{color:#cbd5e1}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:1.5rem;margin-top:3rem}figure{margin:0;background:#1e293b;border-radius:1rem;padding:1rem}img{display:block;width:100%;height:auto;border-radius:.6rem}figcaption{padding:.8rem .2rem .1rem;color:#cbd5e1}@media(prefers-reduced-motion:no-preference){figure{transition:transform .2s}figure:hover{transform:translateY(-2px)}}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(project.meta.name)} screenshot review"><meta property="og:image" content="og-image.png"><title>${escapeHtml(project.meta.name)}</title><link rel="stylesheet" href="assets/styles.css"></head><body><main><header><p>Screenshot Studio review</p><h1>${escapeHtml(project.meta.name)}</h1></header><section class="gallery" aria-label="Screenshots">${figures}</section></main></body></html>`;
  const manifest = JSON.stringify({
    format: "screenshot-studio-web-share",
    version: 1,
    project: project.meta.name,
    generatedAssets: screenshots.map(({ entry }) => entry.relativePath.slice("web-share/".length)),
  }, null, 2);
  return {
    screenshots,
    extraFiles: [
      { relativePath: "web-share/index.html", bytes: Buffer.from(html) },
      { relativePath: "web-share/assets/styles.css", bytes: Buffer.from(css) },
      { relativePath: "web-share/og-image.png", bytes: Buffer.from(rendered[0]!.png) },
      { relativePath: "web-share/manifest.json", bytes: Buffer.from(`${manifest}\n`) },
    ],
  };
}
