// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareRenderHost } from "./packaged-render-host.js";

const packaged = existsSync(new URL("../runtime/web.zip", import.meta.url));

describe("prepareRenderHost", () => {
  // A pnpm wrapper may exit on SIGTERM without forwarding it, orphaning the dev server and hanging stop().
  // Binding all interfaces would let a LAN client spoof `Host: localhost` past the loopback guard.
  it.skipIf(packaged)("runs the source Next dev host directly with Node on loopback only", async () => {
    const host = await prepareRenderHost(4321);
    expect(host.command).toBe(process.execPath);
    expect(host.args[0]).toMatch(/next[\\/]dist[\\/]bin[\\/]next$/);
    expect(host.args.slice(1)).toEqual(["dev", "--webpack", "--hostname", "127.0.0.1", "--port", "4321"]);
  });
});
