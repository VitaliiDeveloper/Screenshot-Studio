#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

// Source-checkout entry; the published package runs the bundled dist/index.js instead. tsx runs
// in-process with its disk cache off: agent sandboxes may block writes to the OS temp directory,
// and the tsx CLI's IPC pipe cannot listen there.
process.env.TSX_DISABLE_CACHE = "1";
const { register } = await import("tsx/esm/api");
// Pinned, so a tsconfig.json above an agent's project folder never changes how the CLI compiles.
register({ tsconfig: fileURLToPath(new URL("../tsconfig.json", import.meta.url)) });
const { runCli } = await import("../src/index.ts");
runCli();
