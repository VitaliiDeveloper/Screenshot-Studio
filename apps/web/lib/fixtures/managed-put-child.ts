// SPDX-License-Identifier: Apache-2.0
const [root, projectId, revision] = process.argv.slice(2);

async function main(): Promise<void> {
  if (!root || !projectId || !revision) throw new Error("root, project id, and revision are required");
  process.env.SCREENSHOT_STUDIO_DATA_ROOT = root;
  process.stdout.write("starting\n");
  const { PUT } = await import("../../app/api/project/route.js");
  const response = await PUT(new Request("http://localhost/api/project", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      cookie: `screenshot_studio_managed_project=${projectId}`,
      "x-project-id": projectId,
      "if-match": `"${revision}"`,
    },
    body: JSON.stringify({
      meta: { name: "Raced write", schemaVersion: 1 },
      fonts: [],
      preferredExportLayoutId: "primary",
      layouts: [{ id: "primary", name: "Primary", mode: "isolated", screens: [{
        id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
        artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#000000" }, elements: [],
      }] }],
    }),
  }));
  process.stdout.write(`status:${response.status}\n`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
