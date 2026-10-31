// SPDX-License-Identifier: Apache-2.0
import { createHash, generateKeyPairSync, verify, type KeyObject } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

export const APP_ID = "1234567890";
export const KEY_ID = "TESTKEY123";
export const ISSUER_ID = "57246542-96fe-1a63-e053-0824d011072a";

export interface MockVersion {
  id: string;
  versionString: string;
  appVersionState: string;
  /** IOS when omitted. */
  platform?: string;
}

export interface MockAppStoreConnect {
  origin: string;
  calls: string[];
  /** Every bearer token the API saw, decoded after its signature was checked. */
  tokens: Array<{ token: string; header: Record<string, unknown>; claims: Record<string, unknown> }>;
  versions: MockVersion[];
  versionQueries: URLSearchParams[];
  localizations: Array<{ id: string; locale: string }>;
  sets: Array<{ id: string; localization: string; displayType: string }>;
  screenshots: Map<string, string[]>;
  parts: Array<{ screenshot: string; authorization: string | undefined; contentType: string | undefined; bytes: Buffer }>;
  checksums: Map<string, string>;
  /** Screenshots whose processing ends in FAILED. */
  failProcessing: Set<string>;
  /** Screenshots whose processing never finishes. */
  neverComplete: Set<string>;
  fail: Array<{ method: string; path: string }>;
  /** An upload part (`<screenshot>/<part>`) that never gets a response. */
  stallUpload: string | undefined;
  /** A path whose 2xx response body is not JSON. */
  garble: string | undefined;
}


function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((done) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => done(Buffer.concat(chunks)));
  });
}

export function decode(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, "base64url").toString());
}

function authorized(asc: MockAppStoreConnect, publicKey: KeyObject, header: string | undefined): boolean {
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const [head = "", claims = "", signature = ""] = token.split(".");
  const raw = Buffer.from(signature, "base64url");
  // ES256 in JWS is raw r‖s (64 bytes), not DER; verifying it as such proves the client encodes it so.
  if (raw.length !== 64) return false;
  if (!verify("sha256", Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, raw)) return false;
  const decodedHeader = decode(head);
  const decodedClaims = decode(claims);
  if (!asc.tokens.some((seen) => seen.token === token)) asc.tokens.push({ token, header: decodedHeader, claims: decodedClaims });
  return decodedHeader.alg === "ES256" && decodedHeader.kid === KEY_ID && decodedHeader.typ === "JWT"
    && decodedClaims.iss === ISSUER_ID && decodedClaims.aud === "appstoreconnect-v1"
    && (decodedClaims.exp as number) - (decodedClaims.iat as number) <= 1200;
}

/**
 * A loopback App Store Connect API for upload tests: it checks each bearer token against a fresh P-256
 * key, keeps versions, localizations, sets and screenshots in memory, and records every call.
 */
export async function startAppStoreConnectMock(): Promise<{ asc: MockAppStoreConnect; privatePem: string; close: () => Promise<void> }> {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const asc: MockAppStoreConnect = {
    origin: "",
    calls: [],
    tokens: [],
    versions: [{ id: "ver-1", versionString: "1.2", appVersionState: "PREPARE_FOR_SUBMISSION" }],
    versionQueries: [],
    localizations: [{ id: "loc-en", locale: "en-US" }, { id: "loc-de", locale: "de-DE" }, { id: "loc-fr", locale: "fr-FR" }],
    sets: [{ id: "set-en", localization: "loc-en", displayType: "APP_IPHONE_61" }, { id: "set-en-ipad", localization: "loc-en", displayType: "APP_IPAD_PRO_3GEN_129" }],
    screenshots: new Map([["set-en", ["old-a", "old-b"]], ["set-en-ipad", ["old-ipad"]]]),
    parts: [],
    checksums: new Map(),
    failProcessing: new Set(),
    neverComplete: new Set(),
    fail: [],
    stallUpload: undefined,
    garble: undefined,
  };
  let created = 0;
  const reads = new Map<string, number>();
  const uploads = new Map<string, Buffer[]>();
  const server = createServer(async (request, response) => {
    const body = await readBody(request);
    const url = new URL(request.url!, "http://mock");
    const path = url.pathname;
    const reply = (status: number, payload?: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(payload === undefined ? "" : JSON.stringify(payload));
    };
    const upload = /^\/upload\/([^/]+)\/(\d+)$/.exec(path);
    if (upload) {
      asc.calls.push(`PUT upload ${upload[1]} part ${upload[2]}`);
      if (asc.stallUpload === `${upload[1]}/${upload[2]}`) return;
      asc.parts.push({ screenshot: upload[1]!, authorization: request.headers.authorization, contentType: request.headers["content-type"], bytes: body });
      (uploads.get(upload[1]!) ?? uploads.set(upload[1]!, []).get(upload[1]!)!)[Number(upload[2])] = body;
      return reply(200);
    }
    if (!authorized(asc, publicKey, request.headers.authorization)) {
      return reply(401, { errors: [{ status: "401", code: "NOT_AUTHORIZED", title: "Authentication credentials are missing or invalid.", detail: "Provide a properly configured and signed bearer token, and make sure that it has not expired." }] });
    }
    const call = `${request.method} ${path.replace(/^\/v1/, "")}`;
    asc.calls.push(call);
    if (asc.fail.some((fail) => fail.method === request.method && path.endsWith(fail.path))) {
      return reply(409, { errors: [{ status: "409", code: "STATE_ERROR", title: "The request cannot be fulfilled.", detail: "The screenshot set cannot be changed now." }] });
    }
    if (asc.garble && path.endsWith(asc.garble)) {
      response.writeHead(200, { "content-type": "text/html" });
      return response.end("<html>garbled-body-fragment</html>");
    }
    const json = body.length > 0 ? JSON.parse(body.toString()) : undefined;
    if (request.method === "GET" && path === `/v1/apps/${APP_ID}/appStoreVersions`) {
      asc.versionQueries.push(url.searchParams);
      const platform = url.searchParams.get("filter[platform]");
      const states = url.searchParams.get("filter[appVersionState]")!.split(",");
      return reply(200, { data: asc.versions
        .filter((version) => (version.platform ?? "IOS") === platform && states.includes(version.appVersionState))
        .map(({ id, versionString, appVersionState }) => ({ type: "appStoreVersions", id, attributes: { versionString, appVersionState, platform } })) });
    }
    const localizations = /^\/v1\/appStoreVersions\/([^/]+)\/appStoreVersionLocalizations$/.exec(path);
    if (request.method === "GET" && localizations) {
      // ver-1 keeps the plain ids; any other version gets its own localizations.
      const prefix = localizations[1] === "ver-1" ? "" : `${localizations[1]}-`;
      return reply(200, { data: asc.localizations.map(({ id, locale }) => ({ type: "appStoreVersionLocalizations", id: `${prefix}${id}`, attributes: { locale } })) });
    }
    const sets = /^\/v1\/appStoreVersionLocalizations\/([^/]+)\/appScreenshotSets$/.exec(path);
    if (request.method === "GET" && sets) {
      return reply(200, { data: asc.sets.filter(({ localization }) => localization === sets[1])
        .map(({ id, displayType }) => ({ type: "appScreenshotSets", id, attributes: { screenshotDisplayType: displayType } })) });
    }
    if (request.method === "POST" && path === "/v1/appScreenshotSets") {
      const id = `set-new-${asc.sets.length}`;
      asc.sets.push({ id, localization: json.data.relationships.appStoreVersionLocalization.data.id, displayType: json.data.attributes.screenshotDisplayType });
      asc.screenshots.set(id, []);
      return reply(201, { data: { type: "appScreenshotSets", id } });
    }
    const shots = /^\/v1\/appScreenshotSets\/([^/]+)\/appScreenshots$/.exec(path);
    if (request.method === "GET" && shots) {
      return reply(200, { data: (asc.screenshots.get(shots[1]!) ?? []).map((id) => ({ type: "appScreenshots", id })) });
    }
    if (request.method === "POST" && path === "/v1/appScreenshots") {
      created += 1;
      const id = `shot-${created}`;
      const setId = json.data.relationships.appScreenshotSet.data.id as string;
      asc.screenshots.get(setId)!.push(id);
      const size = json.data.attributes.fileSize as number;
      const half = Math.ceil(size / 2);
      return reply(201, { data: { type: "appScreenshots", id, attributes: {
        fileName: json.data.attributes.fileName,
        fileSize: size,
        assetDeliveryState: { state: "AWAITING_UPLOAD" },
        uploadOperations: [
          { method: "PUT", url: `${asc.origin}/upload/${id}/0`, offset: 0, length: half, requestHeaders: [{ name: "Content-Type", value: "image/png" }] },
          { method: "PUT", url: `${asc.origin}/upload/${id}/1`, offset: half, length: size - half, requestHeaders: [{ name: "Content-Type", value: "image/png" }] },
        ],
      } } });
    }
    const shot = /^\/v1\/appScreenshots\/([^/]+)$/.exec(path);
    if (shot && request.method === "PATCH") {
      asc.checksums.set(shot[1]!, json.data.attributes.sourceFileChecksum);
      const checksum = createHash("md5").update(Buffer.concat(uploads.get(shot[1]!) ?? [])).digest("hex");
      if (json.data.attributes.uploaded !== true || json.data.attributes.sourceFileChecksum !== checksum) {
        return reply(422, { errors: [{ status: "422", title: "Invalid commit", detail: "The upload was not marked uploaded with the parts' MD5 checksum." }] });
      }
      return reply(200, { data: { type: "appScreenshots", id: shot[1], attributes: { assetDeliveryState: { state: "UPLOAD_COMPLETE" } } } });
    }
    if (shot && request.method === "GET") {
      const count = (reads.get(shot[1]!) ?? 0) + 1;
      reads.set(shot[1]!, count);
      const state = count === 1 || asc.neverComplete.has(shot[1]!) ? { state: "UPLOAD_COMPLETE" } : asc.failProcessing.has(shot[1]!)
        ? { state: "FAILED", errors: [{ code: "IMAGE_INCORRECT_DIMENSIONS", description: "The dimensions of one or more screenshots are wrong." }] }
        : { state: "COMPLETE" };
      return reply(200, { data: { type: "appScreenshots", id: shot[1], attributes: { assetDeliveryState: state } } });
    }
    if (shot && request.method === "DELETE") {
      for (const ids of asc.screenshots.values()) if (ids.includes(shot[1]!)) ids.splice(ids.indexOf(shot[1]!), 1);
      return reply(204);
    }
    return reply(404, { errors: [{ status: "404", title: "No mock", detail: `${request.method} ${path}` }] });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  asc.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    asc,
    privatePem,
    close: async () => {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    },
  };
}
