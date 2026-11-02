// SPDX-License-Identifier: Apache-2.0

export const APP_STORE_CONNECT_KEY_ID_ENV = "APP_STORE_CONNECT_KEY_ID";
export const APP_STORE_CONNECT_ISSUER_ID_ENV = "APP_STORE_CONNECT_ISSUER_ID";
export const APP_STORE_CONNECT_KEY_PATH_ENV = "APP_STORE_CONNECT_KEY_PATH";
export const GOOGLE_PLAY_SERVICE_ACCOUNT_ENV = "GOOGLE_PLAY_SERVICE_ACCOUNT_PATH";

const STORE_CREDENTIAL_ENV = new Set([
  APP_STORE_CONNECT_KEY_ID_ENV,
  APP_STORE_CONNECT_ISSUER_ID_ENV,
  APP_STORE_CONNECT_KEY_PATH_ENV,
  GOOGLE_PLAY_SERVICE_ACCOUNT_ENV,
]);

/** Windows environment names are case-insensitive, so the match is too. */
export function withoutStoreCredentials(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !STORE_CREDENTIAL_ENV.has(name.toUpperCase())),
  );
}
